// The air brake engine on a background thread, so a long train at 10x doesn't stall the page: it answers the pages'
// calls and runs the train on ten times a second, sending the live view back each time.
import { dotnet } from "./framework/dotnet.js";

const { getAssemblyExports, getConfig } = await dotnet.create();
const api = (await getAssemblyExports(getConfig().mainAssemblyName)).BrowserApi;

let last = performance.now();
setInterval(() => {
  const now = performance.now();
  api.Tick((now - last) / 1000);
  last = now;
  postMessage({ type: "live", live: api.Live() });
}, 100);

onmessage = e => {
  const { id, method, path, body } = e.data;
  postMessage({ type: "reply", id, reply: api.Call(method, path, body || "") });
};

postMessage({ type: "ready" });
