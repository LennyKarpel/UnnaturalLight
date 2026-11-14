// What the page header's Help menu opens (./page.ts wires the menu): the user
// guide in its own tab (./help.html), and the About box.

import { el, button } from "../shared/html.ts";
import { serverUrl } from "../shared/server-socket.ts";
import { isRecord } from "../shared/guards.ts";

/** The user guide's sections the app links to (USER-GUIDE.md headings, as anchors). */
export const GUIDE_SECTIONS = { keys: "9-reference-keys-and-mouse" } as const;

/** Open the user guide in its own tab (the same one each time), at `section` when given. */
export function openGuide(section?: string) {
  const url = new URL("page/help.html", location.href);
  if (section) url.hash = section;
  window.open(url, "unnaturallight-guide")?.focus();
}

/** What GET /about answers (../server/server.ts), or null when the show server can't be reached. */
type About = { version: string; node: string; three: string };

async function fetchAbout(): Promise<About | null> {
  try {
    const res = await fetch(serverUrl("/about"), { cache: "no-store" });
    const json: unknown = res.ok ? await res.json() : null;
    if (!isRecord(json)) return null;
    const text = (v: unknown) => (typeof v === "string" ? v : "");
    return { version: text(json.version), node: text(json.node), three: text(json.three) };
  } catch {
    return null;
  }
}

let dlg: HTMLDialogElement | null = null;

/** The About box: what the app is, its version, and what the show server runs on. */
export async function showAbout() {
  const about = await fetchAbout();
  dlg?.remove();
  const d = el("dialog", "ask about");
  dlg = d;
  const form = el("form", "");
  form.method = "dialog";
  const facts = el("dl", "about-facts");
  const fact = (term: string, value: string | undefined) => facts.append(el("dt", "", term), el("dd", "", value || "—"));
  fact("Version", about?.version);
  fact("Show server", about ? `Node.js ${about.node}` : "not connected");
  fact("3D", about ? `three.js ${about.three}` : undefined);
  const guide = button("quiet", "User guide");
  guide.addEventListener("click", () => { d.close(); openGuide(); });
  const close = button("primary", "Close");
  close.type = "submit";
  const actions = el("div", "ask-actions");
  actions.append(guide, close);
  form.append(
    el("h2", "", "UnnaturalLight"),
    el("p", "", "A lighting console and a 3D stage visualizer that work together, run by a show server that sends DMX."),
    facts,
    el("p", "about-credits", "Fixture models from the Open Fixture Library (open-fixture-library.org)."),
    actions,
  );
  d.append(form);
  d.addEventListener("close", () => d.remove(), { once: true });
  document.body.append(d);
  d.showModal();
  close.focus();
}
