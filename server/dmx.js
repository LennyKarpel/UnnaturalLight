// Enttec DMX USB Pro output from the server (one device per universe).
// Protocol: https://www.enttec.com/docs/dmx_usb_pro_api_spec.pdf
//
// Each universe remembers the serial number of the device it was connected
// to (server/data/dmx.json), so after a restart or an unplug / replug the
// same device comes back on the same universe without asking.

import fs from "node:fs";
import path from "node:path";
import { SerialPort } from "serialport";

const ENTTEC_START = 0x7e;
const ENTTEC_END = 0xe7;
const LABEL_SEND_DMX = 0x06;
const BAUD = 57600;
const CHANNEL_COUNT = 512;
/** How often missing remembered devices are looked for. */
const RESCAN_MS = 2000;

/** FTDI, the Enttec Pro's USB chip (other FTDI devices show up too). */
const VENDOR_IDS = new Set(["0403"]);

/** macOS lists both /dev/tty.* and /dev/cu.*; cu.* doesn't wait for carrier detect. */
const calloutPath = (p) => p.replace(/^\/dev\/tty\./, "/dev/cu.");

/** USB serial devices that look like a DMX USB Pro. */
export async function listDevices() {
  const ports = await SerialPort.list();
  return ports
    .filter((p) => VENDOR_IDS.has((p.vendorId ?? "").toLowerCase()) || /enttec/i.test(p.manufacturer ?? ""))
    .map((p) => ({ path: calloutPath(p.path), serial: p.serialNumber ?? p.path, manufacturer: p.manufacturer ?? "" }));
}

class Universe {
  /** @param {number} number 1-based */
  constructor(number) {
    this.number = number;
    this.frame = new Uint8Array(CHANNEL_COUNT);
    /** @type {SerialPort | null} */
    this.port = null;
    /** Device serial this universe sends to (kept while unplugged). */
    this.serial = null;
    this.path = null;
    this.error = null;
    this.fake = false;
    /** A frame is on its way to the device (send the next one only after it has gone). */
    this.busy = false;
  }

  get connected() {
    return this.fake || this.port != null;
  }

  async open(device) {
    const port = new SerialPort({ path: device.path, baudRate: BAUD, dataBits: 8, stopBits: 1, parity: "none", autoOpen: false });
    await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
    port.on("close", () => {
      if (this.port === port) {
        this.port = null;
        this.busy = false;
      }
    });
    port.on("error", (err) => {
      this.error = err.message;
    });
    this.port = port;
    this.serial = device.serial;
    this.path = device.path;
    this.error = null;
  }

  async close() {
    const port = this.port;
    this.port = null;
    if (port?.isOpen) await new Promise((resolve) => port.close(() => resolve()));
  }

  send() {
    if (this.fake) {
      this.logFake();
      return;
    }
    // One frame at a time: if the device takes frames slower than the frame
    // loop makes them, skip frames rather than queue them (a queue of old
    // frames is what makes the lights trail the console).
    if (!this.port?.isOpen || this.busy) return;
    const dataLen = CHANNEL_COUNT + 1; // start code + 512 channels
    const packet = Buffer.alloc(5 + dataLen);
    packet[0] = ENTTEC_START;
    packet[1] = LABEL_SEND_DMX;
    packet[2] = dataLen & 0xff;
    packet[3] = (dataLen >> 8) & 0xff;
    packet[4] = 0x00; // DMX start code
    packet.set(this.frame, 5);
    packet[4 + dataLen] = ENTTEC_END;
    const port = this.port;
    this.busy = true;
    port.write(packet);
    port.drain(() => {
      if (this.port === port) this.busy = false;
    });
  }

  /** --fake-dmx: print the non-zero channels when they change (at most once a second). */
  logFake() {
    const now = Date.now();
    if (now - (this.loggedAt ?? 0) < 1000) return;
    const text = [...this.frame].map((v, i) => (v ? `${i + 1}=${v}` : "")).filter(Boolean).join(" ");
    if (text === this.logged) return;
    this.logged = text;
    this.loggedAt = now;
    console.log(`    DMX U${this.number}: ${text || "(all 0)"}`);
  }
}

/**
 * @param {{ dataDir: string, maxUniverses: number, fake?: boolean, onChange: () => void }} opts
 */
export function createDmx({ dataDir, maxUniverses, fake = false, onChange }) {
  const universes = Array.from({ length: maxUniverses }, (_, i) => new Universe(i + 1));
  const savedFile = path.join(dataDir, "dmx.json");

  function save() {
    const map = {};
    for (const u of universes) if (u.serial && !u.fake) map[u.number] = u.serial;
    fs.writeFileSync(savedFile, `${JSON.stringify(map, null, 2)}\n`);
  }

  try {
    const map = JSON.parse(fs.readFileSync(savedFile, "utf8"));
    for (const u of universes) if (typeof map[u.number] === "string") u.serial = map[u.number];
  } catch {
    // No devices remembered yet.
  }

  /** Connect universe n: its remembered device, else the first free one found. */
  async function connect(n) {
    const u = universes[n - 1];
    if (!u) throw new Error(`No universe ${n}`);
    if (u.connected) return;
    if (fake) {
      u.fake = true;
      u.path = "(fake output)";
      onChange();
      return;
    }
    const devices = await listDevices();
    const taken = new Set(universes.filter((x) => x !== u && x.serial).map((x) => x.serial));
    const device = devices.find((d) => d.serial === u.serial) ?? devices.find((d) => !taken.has(d.serial));
    if (!device) {
      throw new Error(devices.length ? "Every DMX USB Pro found is already on another universe" : "No DMX USB Pro found — is it plugged in?");
    }
    try {
      await u.open(device);
    } catch (err) {
      u.error = err.message;
      onChange();
      throw err;
    }
    save();
    onChange();
  }

  /** Disconnect universe n and forget its device. */
  async function disconnect(n) {
    const u = universes[n - 1];
    if (!u) return;
    u.fake = false;
    u.serial = null;
    u.path = null;
    u.error = null;
    await u.close();
    save();
    onChange();
  }

  // Bring back remembered devices (at start, and after an unplug / replug).
  let scanning = false;
  async function rescan() {
    if (scanning || fake) return;
    const missing = universes.filter((u) => u.serial && !u.port);
    if (!missing.length) return;
    scanning = true;
    try {
      const devices = await listDevices();
      for (const u of missing) {
        const device = devices.find((d) => d.serial === u.serial);
        if (!device) continue;
        try {
          await u.open(device);
          onChange();
        } catch (err) {
          u.error = err.message;
        }
      }
    } finally {
      scanning = false;
    }
  }
  void rescan();
  setInterval(() => void rescan(), RESCAN_MS);

  // Track unplugs (the port closes on its own).
  let lastConnected = universes.map((u) => u.connected).join();
  setInterval(() => {
    const now = universes.map((u) => u.connected).join();
    if (now !== lastConnected) {
      lastConnected = now;
      onChange();
    }
  }, 500);

  return {
    connect,
    disconnect,
    /** @param {Map<number, number>} byChannel continuous channel numbers (513 = universe 2/1) */
    write(byChannel, universeCount) {
      for (const u of universes) u.frame.fill(0);
      for (const [channel, level] of byChannel) {
        const n = Math.floor((channel - 1) / CHANNEL_COUNT) + 1;
        if (n <= universeCount) universes[n - 1].frame[(channel - 1) % CHANNEL_COUNT] = level;
      }
      for (const u of universes) u.send();
    },
    status() {
      return universes.map((u) => ({
        universe: u.number,
        connected: u.connected,
        remembered: Boolean(u.serial) || u.fake,
        path: u.path,
        error: u.error,
      }));
    },
  };
}
