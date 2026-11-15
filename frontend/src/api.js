// Thin client for the FastAPI server. In dev, Vite proxies /api to port 8000.
// To point at another host, set VITE_API_URL (e.g. http://localhost:8000) in frontend/.env.
const BASE = import.meta.env.VITE_API_URL ?? "";

export async function errorFrom(res) {
  try {
    const body = await res.json();
    if (typeof body.detail === "string") return body.detail;
    return "Some of the values in that request were invalid.";
  } catch {
    return `The request failed (HTTP ${res.status}).`;
  }
}

async function json(path, options) {
  const res = await fetch(BASE + path, options);
  if (!res.ok) throw new Error(await errorFrom(res));
  return res.json();
}

const post = (path, body) =>
  json(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// Reads newline-delimited JSON events: {type:"status"|"progress"} while working,
// then one {type:"result"} (resolved) or {type:"error"} (thrown).
async function stream(path, body, onEvent) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await errorFrom(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "result") result = event;
      else onEvent?.(event);
    }
  }
  if (!result) throw new Error("The server stopped before it finished. Check the API terminal for details.");
  return result;
}

const qs = (o) =>
  new URLSearchParams(Object.entries(o).map(([k, v]) => [k, String(v)])).toString();

export const api = {
  health: () => json("/api/health"),
  generate: (body, onEvent) => stream("/api/generate", body, onEvent),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return json("/api/upload", { method: "POST", body: form });
  },
  detect: (sceneId, body, onEvent) => stream(`/api/scenes/${sceneId}/detect`, body, onEvent),
  click: (sceneId, body) => post(`/api/scenes/${sceneId}/click`, body),
  deleteLayer: (sceneId, layerId) =>
    json(`/api/scenes/${sceneId}/layers/${layerId}`, { method: "DELETE" }),

  imageUrl: (sceneId) => `${BASE}/api/scenes/${sceneId}/image`,
  layerUrl: (sceneId, layerId, opts) =>
    `${BASE}/api/scenes/${sceneId}/layers/${layerId}/png?${qs(opts)}`,
  exportUrl: (sceneId, format, opts) =>
    `${BASE}/api/scenes/${sceneId}/export/${format}?${qs(opts)}`,
};
