// The user guide page (help.html): ../USER-GUIDE.md as HTML, with a
// contents list beside it. Opened in its own tab from the app's Help menu
// (./page.ts), at a section when the address ends in #its-heading.

import { marked } from "marked";
import { elById } from "../shared/query.ts";
import { el } from "../shared/html.ts";
import { errorMessage } from "../shared/guards.ts";

const guide = elById("guide");
const toc = elById("helpToc");

/** A heading's anchor as GitHub makes it ("9. Reference: keys and mouse" → "9-reference-keys-and-mouse"), so the guide's own #links work here and on GitHub. */
function headingId(text: string): string {
  return text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, "").replace(/ /g, "-");
}

async function show() {
  const res = await fetch("../USER-GUIDE.md", { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  // The guide is the app's own file, and the page's Content-Security-Policy runs no script that gets into it.
  guide.innerHTML = marked.parse(await res.text(), { async: false, gfm: true });

  const used = new Map<string, number>();
  for (const h of guide.querySelectorAll<HTMLHeadingElement>("h1, h2, h3, h4")) {
    const base = headingId(h.textContent ?? "");
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n}` : base;
  }
  for (const a of guide.querySelectorAll<HTMLAnchorElement>("a[href^='http']")) {
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  }
  for (const h of guide.querySelectorAll<HTMLHeadingElement>("h2")) {
    const link = el("a", "", h.textContent);
    link.href = `#${h.id}`;
    toc.append(link);
  }
  const title = guide.querySelector("h1");
  if (title) document.title = title.textContent ?? document.title;
  // The section asked for (the elements didn't exist when the page loaded).
  if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
}

show().catch((err) => {
  guide.replaceChildren(el("p", "help-status", `Couldn't load the user guide (${errorMessage(err)}). Is the show server running?`));
});
