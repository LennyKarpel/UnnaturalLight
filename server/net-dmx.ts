// Network DMX output from the server: Art-Net and sACN (ANSI E1.31), next to
// (or instead of) the Enttec DMX USB Pro(s) in server/dmx.ts.
//
// One network output per universe, chosen in the page header's DMX menu (or
// by hand) and kept in server/data/network.json, e.g.
//
//   {
//     "interface": "192.168.1.10",
//     "outputs": [
//       { "universe": 1, "protocol": "artnet", "host": "192.168.1.50" },
//       { "universe": 2, "protocol": "sacn" },
//       { "universe": 3, "protocol": "artnet", "netUniverse": 7 }
//     ]
//   }
//
//   universe     the console's universe (1-based)
//   protocol     "artnet" or "sacn"
//   netUniverse  universe number on the wire (default: Art-Net universe - 1,
//                as Art-Net counts from 0; sACN the same number)
//   host         where to send: a node's IP (unicast). Default: broadcast
//                (Art-Net) or the universe's multicast group (sACN)
//   priority     sACN only, 0–200 (default 100)
//   interface    optional, top level: this computer's IP on the lighting
//                network (picks the network card for broadcast / multicast)
//
// A frame goes out when it changes, and at least once a second otherwise
// (nodes treat a silent source as gone after a few seconds). sACN outputs
// say goodbye ("stream terminated") when removed and when the server stops,
// so a backup source takes over at once.
//
// discover() finds Art-Net nodes (ArtPoll); many sACN-only devices answer it too.

import crypto from "node:crypto";
import dgram from "node:dgram";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CHANNEL_COUNT, fillFrames } from "./dmx.ts";
import { errorMessage, isRecord } from "../shared/guards.ts";
import { clamp } from "../shared/numbers.ts";
import { writeJsonFile } from "./files.ts";

const ARTNET_PORT = 6454;
const SACN_PORT = 5568;
const KEEPALIVE_MS = 1000;
/** How long discover() listens for ArtPollReply. */
const DISCOVER_MS = 1500;
const SOURCE_NAME = "UnnaturalLight";
const SACN_TERMINATED = 0x40;

export type Protocol = "artnet" | "sacn";
/** A universe's network output as the console sets it (network.json without `universe`). */
export type NetOutputSetting = { protocol: Protocol; netUniverse?: number; host?: string; priority?: number };
/** An Art-Net node found by discover(). */
export type ArtNetNode = { ip: string; name: string; ports: { port: number; netUniverse: number }[] };

/** One network output, checked and filled in. */
type NetOutput = {
  universe: number;
  protocol: Protocol;
  netUniverse: number;
  host: string | null;
  priority: number;
  address: string;
  port: number;
  sequence: number;
  lastFrame: Buffer | null;
  sentAt: number;
};

function artnetHeader(opcode: number, size: number): Buffer {
  const p = Buffer.alloc(size);
  p.write("Art-Net\0", 0, "ascii");
  p.writeUInt16LE(opcode, 8);
  p.writeUInt16BE(14, 10); // protocol version
  return p;
}

/** Art-Net 4 ArtDmx: 18-byte header + 512 channels. */
function artnetPacket(netUniverse: number, sequence: number, frame: ArrayLike<number>): Buffer {
  const p = artnetHeader(0x5000, 18 + CHANNEL_COUNT);
  p[12] = sequence;
  p[13] = 0; // physical port
  p[14] = netUniverse & 0xff; // SubUni
  p[15] = (netUniverse >> 8) & 0x7f; // Net
  p.writeUInt16BE(CHANNEL_COUNT, 16);
  p.set(frame, 18);
  return p;
}

/** ArtPoll: every node answers with an ArtPollReply. */
function artPollPacket(): Buffer {
  const p = artnetHeader(0x2000, 14);
  p[12] = 0; // flags: just reply to this poll
  p[13] = 0; // diagnostics priority
  return p;
}

/** sACN data packet: root, framing and DMP layers + start code + 512 channels (638 bytes). */
function sacnPacket(cid: Buffer, netUniverse: number, priority: number, sequence: number, frame: ArrayLike<number>, options = 0): Buffer {
  const len = 126 + CHANNEL_COUNT;
  const p = Buffer.alloc(len);
  // Root layer
  p.writeUInt16BE(0x0010, 0); // preamble size
  p.writeUInt16BE(0x0000, 2); // postamble size
  p.write("ASC-E1.17\0\0\0", 4, "ascii");
  p.writeUInt16BE(0x7000 | (len - 16), 16);
  p.writeUInt32BE(0x00000004, 18); // VECTOR_ROOT_E131_DATA
  cid.copy(p, 22);
  // Framing layer
  p.writeUInt16BE(0x7000 | (len - 38), 38);
  p.writeUInt32BE(0x00000002, 40); // VECTOR_E131_DATA_PACKET
  p.write(SOURCE_NAME, 44, 63, "utf8");
  p[108] = priority;
  p.writeUInt16BE(0, 109); // sync address
  p[111] = sequence;
  p[112] = options;
  p.writeUInt16BE(netUniverse, 113);
  // DMP layer
  p.writeUInt16BE(0x7000 | (len - 115), 115);
  p[117] = 0x02; // VECTOR_DMP_SET_PROPERTY
  p[118] = 0xa1; // address & data type
  p.writeUInt16BE(0x0000, 119); // first property address
  p.writeUInt16BE(0x0001, 121); // address increment
  p.writeUInt16BE(CHANNEL_COUNT + 1, 123); // property count (start code + channels)
  p[125] = 0x00; // DMX start code
  p.set(frame, 126);
  return p;
}

/** ArtPollReply → { ip, name, ports: [{ port, netUniverse }] } (output ports only), or null. */
function parsePollReply(m: Buffer): ArtNetNode | null {
  if (m.length < 207 || m.toString("ascii", 0, 8) !== "Art-Net\0" || m.readUInt16LE(8) !== 0x2100) return null;
  const ip = [...m.subarray(10, 14)].join(".");
  const text = (from: number, size: number) => m.toString("utf8", from, from + size).replace(/\0.*$/s, "").trim();
  const name = text(26, 18) || text(44, 64) || ip;
  const net = m[18] & 0x7f;
  const sub = m[19] & 0x0f;
  const count = Math.min(4, m[173]);
  const bindIndex = m.length > 211 ? m[211] : 0;
  const ports: ArtNetNode["ports"] = [];
  for (let i = 0; i < count; i++) {
    if (!(m[174 + i] & 0x80)) continue; // not a DMX output port
    ports.push({ port: Math.max(0, bindIndex - 1) * 4 + i + 1, netUniverse: (net << 8) | (sub << 4) | (m[190 + i] & 0x0f) });
  }
  return { ip, name, ports };
}

const sacnGroup = (u: number) => `239.255.${(u >> 8) & 0xff}.${u & 0xff}`;

/** Broadcast address of each IPv4 network card (or just `iface`'s). */
function broadcastAddresses(iface: string | null): string[] {
  const out: string[] = [];
  for (const a of Object.values(os.networkInterfaces()).flat()) {
    if (!a || a.family !== "IPv4" || a.internal || (iface && a.address !== iface)) continue;
    const ip = a.address.split(".").map(Number);
    const mask = a.netmask.split(".").map(Number);
    out.push(ip.map((b, i) => (b | (~mask[i] & 0xff))).join("."));
  }
  return out;
}

/** Check and fill in one output (see the top of this file). */
function normalize(raw: unknown, maxUniverses: number, iface: string | null): { output: NetOutput; error?: undefined } | { output?: undefined; error: string } {
  const o = isRecord(raw) ? raw : {};
  const universe = o.universe;
  if (typeof universe !== "number" || !Number.isInteger(universe) || universe < 1 || universe > maxUniverses) {
    return { error: `"universe" must be 1–${maxUniverses}` };
  }
  const protocol = o.protocol;
  if (protocol !== "artnet" && protocol !== "sacn") return { error: `"protocol" must be "artnet" or "sacn"` };
  const artnet = protocol === "artnet";
  const netUniverse = o.netUniverse ?? (artnet ? universe - 1 : universe);
  const [min, max] = artnet ? [0, 0x7fff] : [1, 63999];
  if (typeof netUniverse !== "number" || !Number.isInteger(netUniverse) || netUniverse < min || netUniverse > max) {
    return { error: `"netUniverse" must be ${min}–${max}` };
  }
  let host: string | null = null;
  if (o.host != null) {
    if (typeof o.host !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(o.host)) return { error: `"host" must be an IPv4 address` };
    host = o.host;
  }
  const priority = typeof o.priority === "number" && Number.isInteger(o.priority) ? clamp(o.priority, 0, 200) : 100;
  return {
    output: {
      universe,
      protocol,
      netUniverse,
      host,
      priority,
      address: host ?? (artnet ? (iface && broadcastAddresses(iface)[0]) || "255.255.255.255" : sacnGroup(netUniverse)),
      port: artnet ? ARTNET_PORT : SACN_PORT,
      sequence: 0,
      lastFrame: null,
      sentAt: 0,
    },
  };
}

/** "Art-Net 0 → 192.168.1.50", "sACN 2 (multicast)" */
function label(o: NetOutput): string {
  const name = o.protocol === "artnet" ? "Art-Net" : "sACN";
  return `${name} ${o.netUniverse} ${o.host ? `→ ${o.host}` : o.protocol === "artnet" ? "(broadcast)" : "(multicast)"}`;
}

/**
 * A UDP socket on the Art-Net port (node replies to ArtPoll always come to
 * it); if another Art-Net program has the port, any port (no discovery).
 */
async function openSocket(iface: string | null): Promise<{ socket: dgram.Socket; canDiscover: boolean }> {
  const open = (port: number) => new Promise<dgram.Socket>((resolve, reject) => {
    const s = dgram.createSocket({ type: "udp4", reuseAddr: true });
    s.once("error", reject);
    s.bind(port, () => {
      s.off("error", reject);
      s.setBroadcast(true);
      s.setMulticastTTL(8);
      if (iface) s.setMulticastInterface(iface);
      resolve(s);
    });
  });
  try {
    return { socket: await open(ARTNET_PORT), canDiscover: true };
  } catch (err) {
    console.error(`    network DMX: Art-Net port ${ARTNET_PORT} is in use (${errorMessage(err)}): node search is off`);
    return { socket: await open(0), canDiscover: false };
  }
}

export function createNetDmx({ dataDir, maxUniverses, onChange }: { dataDir: string; maxUniverses: number; onChange: () => void }) {
  const file = path.join(dataDir, "network.json");
  let iface: string | null = null;
  /** universe → output */
  const outputs = new Map<number, NetOutput>();
  const frames = Array.from({ length: maxUniverses }, () => new Uint8Array(CHANNEL_COUNT));
  /** Source id, new each start (sACN receivers only need it to stay put while running). */
  const cid = crypto.randomBytes(16);
  let socket: dgram.Socket | null = null;
  let canDiscover = false;
  /** ip:bindIndex → node, while a search runs */
  let heard: Map<string, ArtNetNode> | null = null;

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    iface = typeof raw.interface === "string" ? raw.interface : null;
    for (const o of raw.outputs ?? []) {
      const { output, error } = normalize(o, maxUniverses, iface);
      if (output) outputs.set(output.universe, output);
      else console.error(`    network DMX: skipping ${JSON.stringify(o)} (${error})`);
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") console.error(`    network DMX: can't read ${file}: ${e.message}`);
  }

  const ready = openSocket(iface).then((opened) => {
    ({ socket, canDiscover } = opened);
    opened.socket.on("error", (err) => console.error(`    network DMX: ${err.message}`));
    opened.socket.on("message", (m, from) => {
      if (!heard) return;
      const node = parsePollReply(m);
      if (node?.ports.length) heard.set(`${node.ip}:${m[211] ?? 0}`, { ...node, ip: node.ip === "0.0.0.0" ? from.address : node.ip });
    });
  });

  function save() {
    const list = [...outputs.values()]
      .sort((a, b) => a.universe - b.universe)
      .map((o) => ({
        universe: o.universe,
        protocol: o.protocol,
        netUniverse: o.netUniverse,
        ...(o.host ? { host: o.host } : {}),
        ...(o.protocol === "sacn" && o.priority !== 100 ? { priority: o.priority } : {}),
      }));
    writeJsonFile(file, { ...(iface ? { interface: iface } : {}), outputs: list });
  }

  function send(o: NetOutput, frame: Uint8Array, options = 0) {
    if (!socket) return;
    // Art-Net sequence 0 means "not used", so it runs 1–255.
    o.sequence = o.protocol === "artnet" ? (o.sequence % 255) + 1 : (o.sequence + 1) & 0xff;
    const packet = o.protocol === "artnet"
      ? artnetPacket(o.netUniverse, o.sequence, frame)
      : sacnPacket(cid, o.netUniverse, o.priority, o.sequence, frame, options);
    socket.send(packet, o.port, o.address);
  }

  /** sACN: tell receivers this source is gone (three times, as E1.31 asks). */
  function terminate(o: NetOutput) {
    if (!socket || o.protocol !== "sacn") return;
    const frame = o.lastFrame ?? new Uint8Array(CHANNEL_COUNT);
    for (let i = 0; i < 3; i++) send(o, frame, SACN_TERMINATED);
  }

  return {
    /** For the start banner: one line per output. */
    describe(): string[] {
      return [...outputs.values()].sort((a, b) => a.universe - b.universe).map((o) => `U${o.universe}: ${label(o)}`);
    },
    /** "Art-Net 0 → 192.168.1.50" for universe u, or null. */
    label(u: number): string | null {
      const o = outputs.get(u);
      return o ? label(o) : null;
    },
    /**
     * Send universe u over the network (`output` as in network.json, without
     * `universe`), or stop that (null).
     */
    set(u: number, output: NetOutputSetting | null) {
      let next: NetOutput | null = null;
      if (output) {
        const { output: o, error } = normalize({ ...output, universe: u }, maxUniverses, iface);
        if (!o) throw new Error(error);
        next = o;
      }
      const old = outputs.get(u);
      if (old) terminate(old);
      if (next) outputs.set(u, next);
      else outputs.delete(u);
      save();
      onChange();
    },
    /** Look for Art-Net nodes: [{ ip, name, ports: [{ port, netUniverse }] }]. */
    async discover(): Promise<ArtNetNode[]> {
      await ready;
      if (!canDiscover) throw new Error(`Can't search: another program is using the Art-Net port (${ARTNET_PORT})`);
      if (heard) {
        // A search is already running: wait for it.
        await new Promise((r) => setTimeout(r, DISCOVER_MS));
      } else {
        heard = new Map();
        const poll = artPollPacket();
        for (const address of [...broadcastAddresses(iface), "255.255.255.255"]) socket?.send(poll, ARTNET_PORT, address);
        await new Promise((r) => setTimeout(r, DISCOVER_MS));
      }
      const nodes = [...((heard as Map<string, ArtNetNode> | null)?.values() ?? [])];
      heard = null;
      // Several replies (one per 4 ports) from one node: merge them.
      const byIp = new Map<string, ArtNetNode>();
      for (const n of nodes) {
        const prev = byIp.get(n.ip);
        if (prev) prev.ports.push(...n.ports);
        else byIp.set(n.ip, { ...n, ports: [...n.ports] });
      }
      return [...byIp.values()]
        .map((n) => ({ ...n, ports: n.ports.sort((a, b) => a.port - b.port) }))
        .sort((a, b) => a.name.localeCompare(b.name) || a.ip.localeCompare(b.ip));
    },
    /**
     * @param byChannel continuous channel numbers (513 = universe 2/1)
     * @param universeCount how many universes the show uses
     */
    write(byChannel: Map<number, number>, universeCount: number) {
      if (!socket || !outputs.size) return;
      fillFrames(frames, byChannel, universeCount);
      const now = Date.now();
      for (const o of outputs.values()) {
        const frame = frames[o.universe - 1];
        const changed = !o.lastFrame || !o.lastFrame.equals(frame);
        if (!changed && now - o.sentAt < KEEPALIVE_MS) continue;
        send(o, frame);
        o.lastFrame = Buffer.from(frame);
        o.sentAt = now;
      }
    },
    /** Stopping: say goodbye on sACN, then call `done` once it has gone out. */
    close(done: () => void) {
      const s = socket;
      if (!s) {
        done();
        return;
      }
      for (const o of outputs.values()) terminate(o);
      // Sends are queued: give them a moment to go out before closing.
      setTimeout(() => s.close(done), 50);
    },
  };
}
