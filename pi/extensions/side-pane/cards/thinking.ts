// Card: what the model is thinking, streamed live, so it can stay out of the chat.
//
// Pair it with "hideThinkingBlock": true in pi's settings.json (or Ctrl+T): the chat then shows
// one short label where the thinking was, and the text lives here.
//
// Options (side-pane.json):
//   maxLines  how many rows of the newest thinking to show (3-60, default 12)
//   scope     "run" (default): everything thought since you last sent a prompt
//             "message": only the latest assistant message
//             "all": the whole session
//   title

import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clampInt } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Thinking",
  description:
    "The model's reasoning as it streams, newest lines last. Options: maxLines (default 12), scope (run, message or all). Collapsed: the latest line of thought.",
  needs: "a model that produces thinking",
};

// Keeps a runaway session from growing without bound: older thinking is dropped first.
const MAX_CHARS = 60_000;

type Scope = "run" | "message" | "all";

const card: CardFactory = (config, env) => {
  const maxLines = clampInt(config.maxLines, 12, 3, 60);
  const scope: Scope = config.scope === "message" || config.scope === "all" ? config.scope : "run";

  // The thinking of each assistant message, one string per thinking block.
  let messages: string[][] = [];
  let streaming = false;
  let seen = false; // true once any thinking exists: until then the card is not drawn

  // ---- live: pi's streaming events -------------------------------------------------------------

  const current = () => {
    if (messages.length === 0) messages.push([]);
    return messages[messages.length - 1];
  };

  // A new prompt from the user starts a new run.
  env.on("before_agent_start", () => {
    if (scope === "run") messages = [];
    streaming = false;
    env.repaint();
  });

  env.on("message_start", (event) => {
    if (event?.message?.role !== "assistant") return;
    if (scope === "message") messages = [];
    messages.push([]);
  });

  env.on("message_update", (event) => {
    const e = event?.assistantMessageEvent;
    if (!e || typeof e.type !== "string" || !e.type.startsWith("thinking_")) return;
    const blocks = current();
    const i = typeof e.contentIndex === "number" ? e.contentIndex : blocks.length;
    if (e.type === "thinking_start") {
      blocks[i] = blocks[i] ?? "";
      streaming = true;
      seen = true;
    } else if (e.type === "thinking_delta") {
      blocks[i] = (blocks[i] ?? "") + String(e.delta ?? "");
      streaming = true;
      seen = true;
    } else if (e.type === "thinking_end") {
      // The finished block is authoritative: it replaces whatever the deltas added up to.
      if (typeof e.content === "string") blocks[i] = e.content;
      streaming = false;
    }
    trim();
    env.repaint();
  });

  env.on("agent_end", () => {
    streaming = false;
    env.repaint();
  });

  function trim() {
    let total = messages.reduce((n, blocks) => n + blocks.reduce((m, b) => m + (b?.length ?? 0), 0), 0);
    for (const blocks of messages) {
      for (let i = 0; i < blocks.length && total > MAX_CHARS; i++) {
        const cut = Math.min(blocks[i]?.length ?? 0, total - MAX_CHARS);
        blocks[i] = (blocks[i] ?? "").slice(cut);
        total -= cut;
      }
    }
  }

  // ---- after /reload or a resume: rebuild from the session --------------------------------------

  (function rebuild() {
    try {
      let list: string[][] = [];
      for (const raw of env.sessionEntries()) {
        const m = (raw as { type?: string; message?: any }).message;
        if ((raw as { type?: string }).type !== "message" || !m) continue;
        if (m.role === "user" && scope === "run") list = [];
        if (m.role === "assistant" && Array.isArray(m.content)) {
          const blocks = m.content
            .filter((b: any) => b?.type === "thinking")
            .map((b: any) => (b.redacted ? "[redacted]" : String(b.thinking ?? "")));
          if (scope === "message") list = [];
          list.push(blocks);
        }
      }
      messages = list;
      seen = messages.some((blocks) => blocks.some((b) => b.trim() !== ""));
    } catch {
      // an unexpected session shape only means an empty card
    }
  })();

  // ---- drawing ---------------------------------------------------------------------------------

  // Plain text, tabs and control characters made harmless.
  const clean = (text: string) => text.replace(/\r/g, "").replace(/\t/g, "  ").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");

  // Every row of thinking, wrapped to `width`, with a blank row between messages.
  function rows(width: number): string[] {
    const out: string[] = [];
    for (const blocks of messages) {
      const text = blocks.filter((b) => b && b.trim() !== "").join("\n\n");
      if (text === "") continue;
      if (out.length > 0) out.push("");
      for (const line of clean(text).split("\n")) out.push(...(line === "" ? [""] : wrapTextWithAnsi(line, width)));
    }
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
    return out;
  }

  return {
    title: typeof config.title === "string" ? config.title : "Thinking",
    needs: "a model that produces thinking",
    available: () => seen,
    follow: true, // a card that is taller than its rows stays at the newest thinking

    async refresh() {},

    render(width, theme, height) {
      const all = rows(width);
      if (all.length === 0) return [theme.fg("dim", streaming ? "thinking…" : "No thinking yet.")];

      // With a height from the pane (fill, or a resized card) every row is returned: the pane
      // scrolls, following the newest. Without one: the newest maxLines rows, and a note for the rest.
      const limit = Math.max(3, maxLines);
      const hidden = height === undefined ? Math.max(0, all.length - limit) : 0;
      const shown = hidden > 0 ? all.slice(-(limit - 1)) : all;
      const lines = shown.map((line) => theme.fg("muted", line));
      if (hidden > 0) lines.unshift(theme.fg("dim", `… ${hidden + 1} earlier lines`));

      // A caret at the end of the last row while the text is still coming in.
      if (streaming) {
        const last = shown[shown.length - 1] ?? "";
        if (visibleWidth(last) < width) lines[lines.length - 1] = theme.fg("muted", last) + theme.fg("accent", "▍");
        else lines.push(theme.fg("accent", "▍"));
      }
      return lines;
    },

    // Collapsed: the latest line of thought, marked while it is still streaming.
    summary(theme) {
      const all = rows(200).filter((l) => l.trim() !== "");
      const last = all[all.length - 1];
      if (!last) return streaming ? theme.fg("accent", "thinking…") : undefined;
      return (streaming ? theme.fg("accent", "▍") : "") + theme.fg("muted", last.trim());
    },
  };
};

export default card;
