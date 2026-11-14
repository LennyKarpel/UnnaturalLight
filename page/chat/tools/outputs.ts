/** The chat's DMX output tools: universes, a DMX USB Pro, Art-Net and sACN. */

import { type ToolDef, api, number, NO_ARGS } from "./common.ts";

const UNIVERSE = { type: "integer", minimum: 1, description: "The show's universe (default 1)" };

export const OUTPUT_TOOLS: ToolDef[] = [
  {
    name: "get_outputs",
    description: "The show's DMX universes and where each one goes: a DMX USB Pro on the show computer (connected or not) and / or an Art-Net or sACN network output.",
    schema: NO_ARGS,
    describe: () => "Looked at the DMX outputs",
    run: () => api().outputs(),
  },
  {
    name: "set_universes",
    description: "How many DMX universes the show uses (512 channels each). Fewer is refused while a fixture or patch uses a universe that would go.",
    schema: { type: "object", properties: { count: { type: "integer", minimum: 1 } }, required: ["count"], additionalProperties: false },
    describe: (a) => `Use ${a.count} universe${Number(a.count) === 1 ? "" : "s"}`,
    run: (a) => ({ universes: api().setUniverses(number(a.count, api().outputs().maxUniverses, "count")) }),
  },
  {
    name: "find_artnet_nodes",
    description: "Look for Art-Net nodes on the show computer's network (takes a few seconds): each node's address, name and ports with their Art-Net universes.",
    schema: NO_ARGS,
    describe: () => "Looked for Art-Net nodes",
    run: async () => {
      const nodes = await api().findArtNetNodes();
      return nodes.length ? nodes : "No Art-Net nodes answered";
    },
  },
  {
    name: "set_output",
    description:
      "Where a universe's DMX goes: connect or disconnect its DMX USB Pro (plugged into the show computer), and / or send it over the network (Art-Net to a node's address or broadcast, or sACN multicast) or stop that. The lights follow straight away.",
    schema: {
      type: "object",
      properties: {
        universe: UNIVERSE,
        usb_pro: { type: "boolean", description: "true connects the DMX USB Pro, false disconnects it" },
        network: { type: "string", enum: ["artnet", "sacn", "off"] },
        host: { type: "string", description: "Art-Net: the node's IP address (default: broadcast)" },
        net_universe: { type: "integer", minimum: 0, description: "The network's universe number (default: Art-Net universe − 1, sACN the same number)" },
      },
      additionalProperties: false,
    },
    describe: (a) => {
      const u = a.universe ?? 1;
      const what = [
        a.usb_pro != null && (a.usb_pro ? "connect the DMX USB Pro" : "disconnect the DMX USB Pro"),
        a.network != null && (a.network === "off" ? "stop the network output" : `${a.network === "sacn" ? "sACN" : "Art-Net"}${a.host ? ` → ${a.host}` : ""}`),
      ].filter(Boolean);
      return `Universe ${u}: ${what.join(", ") || "no change"}`;
    },
    run: async (a) => {
      if (a.usb_pro == null && a.network == null) throw new Error("Give usb_pro and / or network");
      const u = a.universe == null ? 1 : number(a.universe, api().outputs().universes, "universe");
      if (a.usb_pro != null) await api().usbPro(u, a.usb_pro === true);
      if (a.network != null) {
        if (a.network === "off") await api().network(u, null);
        else if (a.network === "artnet" || a.network === "sacn") {
          await api().network(u, {
            protocol: a.network,
            ...(a.host ? { host: String(a.host) } : {}),
            ...(a.net_universe != null ? { netUniverse: Number(a.net_universe) } : {}),
          });
        } else throw new Error("network must be artnet, sacn or off");
      }
      return api().outputs().outputs[u - 1];
    },
  },
];
