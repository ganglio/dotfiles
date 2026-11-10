// Registers every model installed in the local Ollama server as the "ollama" provider.
//
// Models are read from Ollama itself (GET /api/tags, then POST /api/show for each one), so
// `ollama pull` / `ollama rm` is all it takes: no pi config to edit. The list is fetched
// when pi starts and again whenever pi refreshes the provider's models.
//
// Server address: OLLAMA_HOST (same variable the ollama CLI uses), else http://127.0.0.1:11434.
// Optional: OLLAMA_CONTEXT_LENGTH caps the context window pi assumes. Set it to the same
// value the server runs with, because Ollama silently truncates prompts beyond its own limit.
//
// Tools: Ollama rejects any request that carries tools for a model without the "tools"
// capability, and pi has no per-model switch for them. So while such a model is selected,
// pi runs chat-only (all tools off); they come back when you switch to a model that has them.
//
// If Ollama is not running, startup is not delayed (2 s timeout) and the provider is simply
// empty until the next refresh.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TIMEOUT_MS = 2000;
// Ids of discovered models whose capabilities are known and do not include "tools".
const toolless = new Set<string>();
const DEFAULT_CONTEXT = 32768;
const MAX_OUTPUT_TOKENS = 16384;

function serverOrigin(): string {
  const raw = process.env.OLLAMA_HOST?.trim();
  if (!raw) return "http://127.0.0.1:11434";
  const hadScheme = /^https?:\/\//i.test(raw);
  const url = new URL(hadScheme ? raw : `http://${raw}`);
  // 0.0.0.0 is a bind address, not somewhere a client can connect to.
  if (url.hostname === "0.0.0.0") url.hostname = "127.0.0.1";
  if (!hadScheme && !url.port) url.port = "11434";
  return url.origin;
}

function withTimeout(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

interface ShowResponse {
  capabilities?: string[];
  model_info?: Record<string, unknown>;
}

async function describe(origin: string, name: string, signal?: AbortSignal) {
  try {
    const res = await fetch(`${origin}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: name }),
      signal: withTimeout(signal),
    });
    if (!res.ok) return {};
    return (await res.json()) as ShowResponse;
  } catch {
    return {};
  }
}

async function discover(signal?: AbortSignal) {
  const origin = serverOrigin();
  try {
    const res = await fetch(`${origin}/api/tags`, { signal: withTimeout(signal) });
    if (!res.ok) return [];
    const { models } = (await res.json()) as { models?: Array<{ name: string }> };
    const names = (models ?? []).map((m) => m.name).sort();
    const cap = Number(process.env.OLLAMA_CONTEXT_LENGTH) || undefined;

    const described = await Promise.all(
      names.map(async (name) => ({ name, info: await describe(origin, name, signal) })),
    );

    // Unknown capabilities count as "supports tools": better to try than to disable them.
    toolless.clear();
    for (const { name, info } of described) {
      if (info.capabilities && !info.capabilities.includes("tools")) toolless.add(name);
    }

    return described
      // Embedding-only models cannot chat. Models whose capabilities are unknown are kept.
      .filter(({ info }) => !info.capabilities || info.capabilities.includes("completion"))
      .map(({ name, info }) => {
        const entry = Object.entries(info.model_info ?? {}).find(([key]) => key.endsWith(".context_length"));
        const trained = typeof entry?.[1] === "number" ? entry[1] : DEFAULT_CONTEXT;
        const contextWindow = cap ? Math.min(trained, cap) : trained;
        return {
          id: name,
          name,
          reasoning: info.capabilities?.includes("thinking") ?? false,
          input: info.capabilities?.includes("vision") ? ["text", "image"] : ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow,
          maxTokens: Math.min(MAX_OUTPUT_TOKENS, contextWindow),
        };
      });
  } catch {
    // Not running, wrong address, or too slow: no models rather than a failed startup.
    return [];
  }
}

export default async function (pi: ExtensionAPI) {
  pi.registerProvider("ollama", {
    name: "Ollama",
    baseUrl: `${serverOrigin()}/v1`,
    apiKey: "ollama", // Ollama ignores it; pi wants a value to make the models available.
    api: "openai-completions",
    models: await discover(),
    async refreshModels({ signal }: { signal?: AbortSignal }) {
      return discover(signal);
    },
  });

  // `saved` holds the tool selection to restore while a tool-less model is active.
  let saved: string[] | undefined;

  function syncTools(model: { provider: string; id: string } | undefined, ctx: ExtensionContext) {
    const lacksTools = model?.provider === "ollama" && toolless.has(model.id);
    if (lacksTools) {
      if (!saved) {
        saved = pi.getActiveTools();
        if (ctx.hasUI) {
          ctx.ui.notify(`${model!.id} does not support tools: chat-only, read/bash/edit/write are off.`, "warning");
        }
      }
      pi.setActiveTools([]);
    } else if (saved) {
      pi.setActiveTools(saved);
      saved = undefined;
    }
  }

  // Restoring a session does not fire model_select, so start-up reads ctx.model directly.
  pi.on("session_start", (_event, ctx) => syncTools(ctx.model, ctx));
  pi.on("model_select", (event, ctx) => syncTools(event.model, ctx));
}
