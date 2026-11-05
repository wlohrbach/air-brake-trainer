// Browser version: stands in for the trainer server inside each page. The page's API calls go to the air brake engine
// the outer page runs, and the live updates it would get over SignalR come from there too.
"use strict";
(() => {
  const host = window.parent;
  const handlers = {};

  window.signalR = {
    HubConnectionBuilder: class {
      withUrl() { return this; }
      withAutomaticReconnect() { return this; }
      build() { return { on: (name, f) => { handlers[name] = f; }, start: async () => { } }; }
    }
  };
  // Called by the outer page ten times a second, like the server's hub messages.
  window.__live = live => {
    if (live.airbrake) handlers.airbrake?.(live.airbrake);
    if (live.trainer) handlers.trainer?.(live.trainer);
  };

  const json = (status, text) => new Response(text, { status, headers: { "Content-Type": "application/json" } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.includes("api/auth/status")) return json(200, JSON.stringify({
      user: { displayName: "Browser version", railroadCode: "Local", canManageUsers: false },
      features: { liveDisplay: false, evaluation: false, instruction: true }
    }));
    const m = path.match(/api\/airbrake\/?(.*)$/);
    if (!m) return realFetch(url, options);
    const reply = await host.engine.call(options.method || "GET", m[1], options.body || "");
    const i = reply.indexOf("\n");
    return json(+reply.slice(0, i), reply.slice(i + 1));
  };

  // The viewer shows no pop-up dialogs: messages go to the outer page's notice bar, and confirmations go ahead.
  window.alert = message => host.notify(String(message));
  window.confirm = () => true;

  // The outer page has the navigation; sign-in and the other pages don't exist here.
  document.head.insertAdjacentHTML("beforeend", "<style>#userbar { display:none !important; }</style>");
})();
