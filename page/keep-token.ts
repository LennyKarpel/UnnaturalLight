// From another computer the app is opened with ?token=… (printed by the
// server). Keep it for this tab before the app starts (same key as
// ../shared/server-socket.ts), and take it off the address bar. A classic
// script, not a module, so it runs before the app's modules; its own file,
// not inline in ../index.html, because the page's Content-Security-Policy
// runs no inline scripts (see ../server/access.ts).
{
  try {
    const params = new URLSearchParams(location.search);
    const token = params.get("token");
    if (token) {
      sessionStorage.setItem("unnaturallight.token", token);
      // Kept: now off the address bar (so it isn't on screen, in the history or in a copied link). A reload still has it.
      params.delete("token");
      const query = params.toString();
      history.replaceState(history.state, "", `${location.pathname}${query ? `?${query}` : ""}${location.hash}`);
    }
  } catch {
    // storage unavailable
  }
}
