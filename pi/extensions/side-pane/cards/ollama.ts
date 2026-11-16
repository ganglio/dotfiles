// Card: the models Ollama has loaded in memory.
//
// Options (side-pane.json): host (default: OLLAMA_HOST, else http://127.0.0.1:11434), title.

import { truncateToWidth } from "@earendil-works/pi-tui";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Ollama",
  description: "Size, GPU share, context length and time until unload of each loaded model. Collapsed: the first model, or \"idle\".",
  needs: "a running Ollama server",
};

// Same rules as the ollama CLI: OLLAMA_HOST may lack a scheme or a port, or be 0.0.0.0.
function ollamaOrigin(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return "http://127.0.0.1:11434";
  const hadScheme = /^https?:\/\//i.test(value);
  const url = new URL(hadScheme ? value : `http://${value}`);
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (!hadScheme && !url.port) url.port = "11434";
  return url.origin;
}

interface Loaded {
  name: string;
  size: number; // bytes in memory
  vram?: number; // bytes of that on the GPU
  context?: number; // tokens, when the server reports it
  expires?: number; // ms since epoch
}

const card: CardFactory = (config) => {
  const origin = ollamaOrigin(typeof config.host === "string" ? config.host : process.env.OLLAMA_HOST);
  let reachable: boolean | undefined; // undefined until the first refresh has finished
  let models: Loaded[] = [];

  const gb = (bytes: number) => `${(bytes / 1e9).toFixed(1)} GB`;
  const ctx = (tokens?: number) => (tokens ? `${Math.round(tokens / 1024)}k ctx` : "");
  const gpu = (m: Loaded) => {
    if (m.vram === undefined || m.size <= 0) return "";
    const pct = Math.round((m.vram / m.size) * 100);
    return pct === 0 ? "CPU" : `${pct}% GPU`;
  };
  const unload = (m: Loaded) => {
    if (!m.expires || Number.isNaN(m.expires)) return "";
    const left = m.expires - Date.now();
    if (left > 365 * 86400_000) return "stays loaded";
    if (left <= 0) return "unloading";
    return `unloads in ${Math.max(1, Math.ceil(left / 60_000))}m`;
  };

  return {
    title: typeof config.title === "string" ? config.title : "Ollama",
    needs: "a running Ollama server",
    available: () => reachable === true,

    async refresh() {
      try {
        const res = await fetch(`${origin}/api/ps`, { signal: AbortSignal.timeout(2000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { models?: Array<Record<string, unknown>> };
        models = (body.models ?? []).map((m) => ({
          name: String(m.name ?? m.model ?? "?"),
          size: Number(m.size) || 0,
          vram: m.size_vram === undefined ? undefined : Number(m.size_vram),
          context: typeof m.context_length === "number" ? m.context_length : undefined,
          expires: typeof m.expires_at === "string" ? Date.parse(m.expires_at) : undefined,
        }));
        reachable = true;
      } catch {
        reachable = false; // not running or not answering: the card disappears
        models = [];
      }
    },

    render(width, theme) {
      if (models.length === 0) return [theme.fg("dim", "No model loaded")];
      const lines: string[] = [];
      models.forEach((m, i) => {
        if (i > 0) lines.push("");
        lines.push(theme.fg("accent", truncateToWidth(m.name, width, "…")));
        for (const detail of [[gb(m.size), gpu(m)], [ctx(m.context), unload(m)]]) {
          const text = detail.filter(Boolean).join(" · ");
          if (text) lines.push(theme.fg("muted", truncateToWidth(text, width, "…")));
        }
      });
      return lines;
    },

    summary(theme) {
      if (models.length === 0) return theme.fg("dim", "idle");
      const m = models[0];
      const more = models.length > 1 ? ` +${models.length - 1}` : "";
      return [m.name, gb(m.size), ctx(m.context)].filter(Boolean).join(" · ") + theme.fg("dim", more);
    },
  };
};

export default card;
