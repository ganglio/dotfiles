// A side pane made of cards, listed in side-pane.json.
//
//   ╭─ Recent commits ─────────────╮
//   │ a1b2c3d            2 days ago │
//   │ Roberto Torella               │
//   │ fix: handle empty cwd when …  │
//   ╰───────────────────────────────╯
//
// Files in this folder:
//   index.ts       this file: the pane, its layout, commands and events
//   cards/         one file per card type. Drop a file in, /reload, and it is a card (see below)
//   viewer.ts      the file viewer: selection, comments, proposals (opened from the Files card or /file)
//   review.ts      the review model behind it: ranges, the prompt for the agent, applying edits
//   registry.ts    discovers the files in cards/
//   config.ts      reads and writes side-pane.json
//   config-ui.ts   the visual card editor, /pane config
//   types.ts, helpers.ts   what a card is written against
//
// Cards. Every file in cards/ is a card type, named after the file: cards/git-log.ts is
// { "type": "git-log" }. Nothing to register: add a file, run /reload. See cards/README.md.
// Which cards are shown and in what order is set in side-pane.json ("cards" is the list from top
// to bottom; an entry with "enabled": false is kept but hidden), or visually with /pane config.
//
// Layout. In pi's fullscreen mode (the default) the pane is a dock: a real column next to the
// chat. Pi's fullscreen screen has one root layout component; the dock wraps it in a horizontal
// stack [ pi's root | pane ], so the chat, the editor and the footer are laid out in the columns
// that remain. This is the approach pi-split-view uses, with its own code. It relies on one
// private field of pi's TUI (the current layout root), so a pi update could break it; if the dock
// cannot be set up, the pane falls back to an overlay.
//
// In regular (non-fullscreen) mode there is no layout to wrap, so the pane is an overlay anchored
// top-right: it is drawn over the chat and does NOT shrink it (text under it is hidden).
//
// The pane hides itself on narrow terminals (minTerminalWidth), and `/pane` toggles it by hand.
// A card with "resizable": true can be resized by dragging its top or bottom edge, and a card whose
// body is taller than its rows scrolls (wheel, scrollbar); see cards/README.md.
// Drag the pane's left edge (the blank column or the cards' left border) to make it wider or
// narrower; the chat keeps at least MIN_CHAT_COLUMNS. The width is saved to side-pane.json, and so
// is the viewer's height ("viewerHeight"), so the next run opens with the same sizes.
//
// File viewer. The Files card (cards/files.ts) lists the working directory; clicking a file, or
// /file <path>, splits the main area: the file above (viewer.ts), the chat below; drag the chat's
// top edge to give either more room. Drag over text to select it and comment on it; "Send" hands the selections, the
// comments and the file's path to the agent, which answers each comment with the propose_edit
// tool below instead of editing. The proposals show inline, and "Use edit" is the only thing that
// writes the file. Needs the dock, so pi's fullscreen mode. /file close and /file send are the
// keyboard routes. The model behind it (ranges, the prompt, applying edits) is in review.ts.
// The viewer's Edit button runs $VISUAL / $EDITOR in the viewer's box (embedded-editor.ts, through
// tmux); ctrl+] hands the keyboard back to the chat while the editor keeps running.
//
// Collapsing: every card has a caret at the top right of its header (▾ open, ▸ collapsed).
// Click the header row to collapse or open the card (mouse needs pi's fullscreen mode, the
// default). A collapsed card is one row: its title plus a one-line summary of its content.
//
//   ├─ Recent commits · a1b2c3d Roberto ─ ▸ ─┤
//
// Scrolling: when the cards are taller than the pane (the window in the dock, maxHeight for the
// overlay, which pi would otherwise cut off), the pane draws a window of its content. Scroll it
// with the mouse wheel over the pane; ▲ N more / ▼ N more rows say how much is out of view, and
// clicking one pages that way. At the start or end the wheel passes through and scrolls the chat.
//
// Commands: /pane [on|off|toggle|reload|config|collapse|expand|card <n>|scroll up|down|top|bottom]
// What you collapse lasts until pi restarts or the config is reloaded; set "collapsed": true on a
// card to make it start collapsed.
//
// Configuration: side-pane.json in pi's agent directory (linked from the dotfiles). Every key is
// optional. Edit it, then `/pane reload` (or `/reload`).
//
//   {
//     "enabled": true,              start with the pane shown
//     "layout": "auto",             "auto" = dock in fullscreen, overlay otherwise;
//                                   "dock" = the same, but warn when it falls back;
//                                   "overlay" = always an overlay
//     "width": "30%",               columns, or a percentage of the terminal width
//     "viewerHeight": "60%",        how tall the file viewer is (rows, or a percentage of the window);
//                                   dragging the chat's top edge sets it. Unset: the chat gets 11 rows
//     "minWidth": 34,               never narrower than this many columns
//     "maxHeight": "75%",           rows, or a percentage of the terminal height (overlay only;
//                                   the dock uses the whole height of the window)
//     "minTerminalWidth": 110,      hide the pane when the terminal is narrower than this
//     "hideFooter": true,           hide pi's own footer (model, folder, context). false = hide it
//                                   only while the pane shows a "session" card, which has the same
//     "syntaxHighlight": true,      colour the file viewer's text by language
//     "refreshSeconds": 10,         how often the cards refresh (also after every agent turn)
//     "shortcut": "ctrl+shift+g",   optional key that toggles the pane
//     "cards": [ { "type": "git-log", "count": 3 }, { "type": "ollama", "enabled": false } ]
//   }
//
// Every card entry accepts "type", "title", "enabled", "collapsed" and "fill", plus the options of
// its own type (documented at the top of its file in cards/). "fill": true makes an open card grow
// to take the rows the others leave free; several such cards share those rows evenly. Cards that
// can show more when they have room (working tree, agent edits, thinking) use it; the others are
// padded. In the overlay the pane grows to its maxHeight.
//
// Dependencies: a card whose dependency is not met is not drawn at all, and when no card is
// available the whole pane disappears. They come back by themselves, at the next refresh.

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { HStack, isViewportTUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveCards, saveLayout } from "./config";
import { createCardsEditor } from "./config-ui";
import type { EditorRow } from "./config-ui";
import { discoverCards } from "./registry";
import type { CardType } from "./registry";
import type { Card, CardConfig, CardEnv, SessionInfo } from "./types";
import { tmuxAvailable } from "./embedded-editor";
import { MeasurementSafeVStack, box, chatBody, ruleLine } from "./frame";
import { createViewer } from "./viewer";
import type { Viewer } from "./viewer";

// ----------------------------------------------------------------------- pane

interface Pane {
  toggle(): boolean; // returns the new state
  set(on: boolean): void;
  // 1-based, in the order of the config (hidden cards count too). Returns a message to show the
  // user when the number is wrong, or when the card is hidden right now.
  toggleCard(n: number): string | undefined;
  setAllCollapsed(collapsed: boolean): void;
  // The visual card editor (/pane config).
  configure(ctx: ExtensionCommandContext): Promise<void>;
  // The file viewer (/file): open a file, close it, send the comments on it to the agent.
  openFile(path: string): void;
  closeFile(): void;
  sendReview(): void;
  scroll(where: "up" | "down" | "top" | "bottom"): void;
  reload(): string | undefined; // returns a config error, if any
}

const CARET_OPEN = "▾"; // ▾
const CARET_CLOSED = "▸"; // ▸

const WIDGET_KEY = "side-pane";
// The chat keeps at least this many columns, whatever the pane's width settings say.
const MIN_CHAT_COLUMNS = 50;

export default async function (pi: ExtensionAPI) {
  // Every file in cards/ is a card type. Discovered once per load: /reload picks up new files.
  const found = await discoverCards(join(dirname(fileURLToPath(import.meta.url)), "cards"));
  const cardTypes: Map<string, CardType> = found.types;
  const discoveryErrors: string[] = found.errors;

  // Events cards can subscribe to with env.on(). Pi gets one handler per event, which fans out to the
  // cards of the current session. The handlers never return anything, so pi's own flow is untouched.
  const CARD_EVENTS = [
    "before_agent_start",
    "agent_start",
    "agent_end",
    "turn_start",
    "turn_end",
    "message_start",
    "message_update",
    "message_end",
    "tool_execution_start",
    "tool_execution_end",
    "tool_call",
    "tool_result",
    "model_select",
    "thinking_level_select",
  ];
  const listeners = new Map<string, Set<(event: any) => void>>();
  for (const name of CARD_EVENTS) {
    (pi as any).on(name, (event: unknown) => {
      for (const handler of listeners.get(name) ?? []) {
        try {
          handler(event);
        } catch {
          // a card's bug is not the pane's
        }
      }
    });
  }

  let pane: Pane | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let dispose: (() => void) | undefined;
  let refreshAll: (() => Promise<void>) | undefined;
  let repaint: (() => void) | undefined;
  let teardown: (() => void) | undefined;
  let activeViewer: Viewer | undefined; // the viewer of the running session, for the propose_edit tool

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    refreshAll = undefined;
    repaint = undefined;
    listeners.clear();
    teardown?.(); // puts pi's own layout back and removes the overlay and the widget
    teardown = undefined;
    dispose?.();
    dispose = undefined;
    pane = undefined;
  }

  // Files the agent wrote or edited, for the agent-files card. It is fed by tool events (so it
  // is live) and rebuilt from the session when pi starts, reloads or resumes.
  const touched = new Map<string, { count: number; at: number }>();
  let pathBase = process.cwd();

  function touch(path: string, at: number) {
    const abs = resolve(pathBase, path);
    touched.set(abs, { count: (touched.get(abs)?.count ?? 0) + 1, at });
  }

  // Walks the session: a successful write/edit is a toolCall in an assistant message whose
  // toolResult (same id) is not an error.
  function rebuildTouched(ctx: { sessionManager: { getBranch(): unknown[] } }) {
    try {
      const pending = new Map<string, string>();
      for (const raw of ctx.sessionManager.getBranch()) {
        const entry = raw as { type?: string; timestamp?: string; message?: any };
        const m = entry.message;
        if (entry.type !== "message" || !m) continue;
        if (m.role === "assistant" && Array.isArray(m.content)) {
          for (const block of m.content) {
            if (block?.type === "toolCall" && (block.name === "write" || block.name === "edit") && typeof block.arguments?.path === "string") {
              pending.set(block.id, block.arguments.path);
            }
          }
        } else if (m.role === "toolResult" && !m.isError && pending.has(m.toolCallId)) {
          touch(pending.get(m.toolCallId)!, Date.parse(entry.timestamp ?? "") || 0);
        }
      }
    } catch {
      // an unexpected session shape only means an emptier list
    }
  }

  // Command and optional shortcut. Both act on whichever session is running.
  const first = loadConfig().config;
  pi.registerCommand("pane", {
    description: "Side pane: /pane [on|off|toggle|reload|config|collapse|expand|card <n>|scroll up|down|top|bottom]",
    getArgumentCompletions: (prefix: string) =>
      ["on", "off", "toggle", "reload", "config", "collapse", "expand", "card", "scroll up", "scroll down", "scroll top", "scroll bottom"]
        .filter((a) => a.startsWith(prefix))
        .map((a) => ({ value: a, label: a })),
    handler: async (args, ctx) => {
      if (!pane) return void ctx.ui.notify("The side pane runs in the interactive terminal UI only.", "warning");
      const arg = (args ?? "").trim();
      const usage = "Usage: /pane [on|off|toggle|reload|config|collapse|expand|card <n>|scroll up|down|top|bottom]";
      const scrolling = /^scroll\s+(up|down|top|bottom)$/.exec(arg);
      if (scrolling) return void pane.scroll(scrolling[1] as "up" | "down" | "top" | "bottom");
      if (arg === "config") return void (await pane.configure(ctx));
      if (arg === "reload") {
        const error = pane.reload();
        return void ctx.ui.notify(error ?? "Side pane config reloaded.", error ? "warning" : "info");
      }
      if (arg === "collapse" || arg === "expand") return void pane.setAllCollapsed(arg === "collapse");
      const card = /^card\s+(\d+)$/.exec(arg);
      if (card) {
        const error = pane.toggleCard(parseInt(card[1], 10));
        return void (error && ctx.ui.notify(error, "warning"));
      }
      if (arg === "on" || arg === "off") pane.set(arg === "on");
      else if (arg === "" || arg === "toggle") pane.toggle();
      else return void ctx.ui.notify(usage, "warning");
    },
  });
  pi.registerCommand("file", {
    description: "File viewer: /file <path> opens a file, /file close, /file send",
    handler: async (args, ctx) => {
      if (!pane) return void ctx.ui.notify("The file viewer runs in the interactive terminal UI only.", "warning");
      const arg = (args ?? "").trim();
      if (arg === "close") return void pane.closeFile();
      if (arg === "send") return void pane.sendReview();
      if (arg === "") return void ctx.ui.notify("Usage: /file <path> | close | send", "warning");
      pane.openFile(resolve(ctx.cwd, arg));
    },
  });

  // The agent's answer to a review comment. It changes nothing on disk: the viewer shows the
  // proposal and the user decides between keeping the original and taking it.
  pi.registerTool({
    name: "propose_edit",
    label: "Propose edit",
    description:
      "Propose a replacement for the text a user selected in a review comment. This does not change any file: the user chooses between keeping the original and your proposal.",
    promptSnippet: "Propose a replacement for the text selected in a review comment",
    parameters: Type.Object({
      comment: Type.Number({ description: "The number of the comment this answers" }),
      replacement: Type.String({ description: "The complete text that should replace exactly the selected text" }),
      note: Type.Optional(Type.String({ description: "A short explanation of the change" })),
    }),
    async execute(_toolCallId, params) {
      const text = activeViewer
        ? activeViewer.propose(params.comment, params.replacement, params.note)
        : "No review is open in the file viewer, so there is nothing to propose an edit for.";
      return { content: [{ type: "text", text }], details: {} };
    },
  });

  if (first.shortcut) {
    pi.registerShortcut(first.shortcut, {
      description: "Toggle the side pane",
      handler: async () => void pane?.toggle(),
    });
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    stop(); // a reload starts a new session: never leave two panes behind

    const loaded = loadConfig();
    if (loaded.error && ctx.hasUI) ctx.ui.notify(loaded.error, "warning");
    if (ctx.hasUI) for (const message of discoveryErrors) ctx.ui.notify(`side-pane: ${message}`, "warning");
    if (ctx.hasUI && !tmuxAvailable()) ctx.ui.notify("side-pane: tmux was not found, so the file viewer's Edit button is not shown. Install tmux to edit files in the viewer.", "error");
    let config = loaded.config;
    // One entry per card of the config, in order: its config, the live card and whether it is collapsed.
    interface Entry {
      cfg: CardConfig;
      card: Card;
      collapsed: boolean;
      dispose: () => void; // drops the card's event subscriptions
      // A body taller than its rows scrolls: the first row in view, whether it follows the end
      // (cards with `follow`), and how many rows the body had at the last draw (0 = it fit).
      scrollTop: number;
      stick: boolean;
      overflow: number;
    }
    let entries: Entry[] = [];
    // Header row of each drawn card (for clicks) and the rows of its body (for forwarding mouse input).
    let headerRows: { row: number; card: number; bodyRows: number; open: boolean }[] = [];
    // Scrolling. `scroll` is the first content row in view; the rest is set on every render.
    let scroll = 0;
    let viewRows = 0; // rows the pane occupies on screen
    let contentRows = 0; // rows all the cards need
    let above = 0; // content rows out of view above / below (0 = no ▲ / ▼ row)
    let below = 0;
    let enabled = config.enabled;
    let requestRender: (() => void) | undefined;
    let busy = false;

    pathBase = ctx.cwd;
    touched.clear();
    rebuildTouched(ctx);
    repaint = () => requestRender?.();

    // Indices of the cards that are switched on and whose dependency is met. Others are not drawn.
    const drawn = () => entries.flatMap((e, i) => (e.cfg.enabled !== false && e.card.available?.() !== false ? [i] : []));

    // The most rows pi will give the pane: its own arithmetic for maxHeight (floor of the
    // percentage), limited to the screen below the pane's top margin of 1.
    const paneRows = () => {
      const rows = process.stdout.rows || 24;
      const wanted = typeof config.maxHeight === "number" ? config.maxHeight : Math.floor((rows * parseFloat(config.maxHeight)) / 100);
      return Math.max(1, Math.min(wanted, rows - 1));
    };

    // Moves the window by n rows. false = it could not move (nothing to scroll, or at the end).
    function scrollBy(n: number): boolean {
      const next = Math.max(0, Math.min(Math.max(0, contentRows - viewRows), scroll + n));
      const moved = next !== scroll;
      scroll = next;
      return moved;
    }

    const env: CardEnv = {
      async git(args, timeoutMs = 3000) {
        try {
          const r = await pi.exec("git", ["--no-optional-locks", ...args], { cwd: ctx.cwd, timeout: timeoutMs });
          return r.code === 0 ? r.stdout : undefined;
        } catch {
          return undefined; // git missing or too slow
        }
      },
      cwd: ctx.cwd,
      touched,
      on() {}, // each card gets its own, see buildEntry
      repaint: () => coalescedRepaint(),
      session: () => {
        let context: SessionInfo["context"];
        try {
          const u = ctx.getContextUsage();
          if (u) context = { tokens: u.tokens, window: u.contextWindow, percent: u.percent };
        } catch {
          // the session is gone
        }
        return { provider: ctx.model?.provider, model: ctx.model?.id, thinkingLevel: ctx.thinkingLevel as string | undefined, context };
      },
      openFile: (path) => openFile(path),
      openedFile: () => (viewer.isOpen() ? viewer.path() : undefined),
      sessionEntries: () => {
        try {
          return ctx.sessionManager.getBranch() as unknown[];
        } catch {
          return [];
        }
      },
    };

    // Redraws at most about 15 times a second, however often cards ask (a streamed token each).
    let repaintTimer: ReturnType<typeof setTimeout> | undefined;
    function coalescedRepaint() {
      if (repaintTimer) return;
      repaintTimer = setTimeout(() => {
        repaintTimer = undefined;
        requestRender?.();
      }, 66);
    }

    // ---- the file viewer ------------------------------------------------------------------------
    // Opening a file splits the main area: the viewer on top, the chat below (see composeDock).

    const viewer: Viewer = createViewer(
      {
        theme: () => ctx.ui.theme,
        requestRender: () => requestRender?.(),
        syntax: () => config.syntaxHighlight,
        focus: (component) => {
          const tui = tuiRef;
          if (!tui) return;
          // Remember who had the keyboard (pi's input) so it can be handed back.
          if (component) {
            if (!focusBefore) focusBefore = tui.getFocusedComponent?.() ?? null;
            tui.setFocus(component);
          } else if (focusBefore !== undefined) {
            tui.setFocus(focusBefore);
            focusBefore = undefined;
          }
        },
        release: (component) => {
          const tui = tuiRef;
          if (!tui || tui.getFocusedComponent?.() !== component) return;
          if (focusBefore !== undefined) tui.setFocus(focusBefore);
          focusBefore = undefined;
        },
        bodyRows: () => Math.max(1, windowRows - chatRows(windowRows) - 2), // minus the box's top and bottom edges
        layoutChanged: () => {
          composeDock();
          requestRender?.();
        },
        close: () => closeFile(),
        notify: (message, level) => ctx.ui.notify(message, level),
        askComment: (title, initial) => (initial === undefined ? ctx.ui.input(title, "") : ctx.ui.editor(title, initial)),
        choose: (title, options) => ctx.ui.select(title, options),
        send: (text) => pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" }),
      },
      ctx.cwd,
    );
    activeViewer = viewer;

    // Rows the chat gets while a file is open, out of `windowRows`: what is left under the viewer's
    // height (set by dragging, or "viewerHeight" in side-pane.json), 11 rows when nothing is set.
    // Both always keep at least MIN_PART_ROWS.
    const MIN_PART_ROWS = 8;
    let draggedViewerRows: number | undefined; // while a drag is going on
    let windowRows = 0; // the height the main area had at the last layout pass
    const chatRows = (height: number) => {
      windowRows = height;
      const h = config.viewerHeight;
      const viewerRows = draggedViewerRows ?? (h === undefined ? undefined : typeof h === "number" ? h : Math.floor((height * parseFloat(h)) / 100));
      const wanted = viewerRows === undefined ? 11 : height - viewerRows;
      return Math.max(MIN_PART_ROWS, Math.min(wanted, height - MIN_PART_ROWS));
    };

    let focusBefore: Component | null | undefined; // who had the keyboard before the editor took it

    // The chat box's top edge is the handle between the viewer and the chat: press and drag it.
    let chatGrab: { rows: number } | undefined;
    const chatEdgeMouse = (event: any) => {
      if (event.button !== "left") return undefined;
      if (event.type === "press") {
        chatGrab = { rows: chatEntry?.basis === undefined || chatEntry.basis === "auto" ? 11 : chatEntry.basis };
        return { handled: true, capture: true, render: true };
      }
      if (!chatGrab) return undefined;
      if (event.type === "drag") {
        // While a drag is captured, y stays measured from the edge's row at the press: negative above it.
        draggedViewerRows = windowRows - (chatGrab.rows - event.y);
        return { handled: true, render: true };
      }
      if (event.type === "release" || event.type === "click") {
        chatGrab = undefined;
        if (draggedViewerRows !== undefined) {
          const viewerRows = windowRows - chatRows(windowRows); // what the drag came to, after the limits
          draggedViewerRows = undefined;
          config.viewerHeight = `${Math.ceil((viewerRows / windowRows) * 10000) / 100}%`;
          const error = saveLayout({ viewerHeight: config.viewerHeight });
          if (error) ctx.ui.notify(error, "warning");
        }
        return { handled: true, render: true };
      }
      return undefined;
    };

    function openFile(path: string) {
      if (layoutMode !== "dock") return void ctx.ui.notify("The file viewer needs pi's fullscreen mode.", "warning");
      viewer.open(path);
      composeDock(); // the viewer is part of the layout now
      requestRender?.();
    }

    function closeFile() {
      viewer.close();
      composeDock();
      requestRender?.();
    }

    // A card that only shows a message: a type nobody provides, or a factory that threw.
    const noteCard = (title: string, message: (theme: Theme, width: number) => string[]): Card => ({
      title,
      async refresh() {},
      render: (width, theme) => message(theme, width),
    });

    function buildEntry(cfg: CardConfig): Entry {
      const type = cardTypes.get(cfg.type);
      const subscriptions: Array<() => void> = [];
      const cardEnv: CardEnv = {
        ...env,
        on(event, handler) {
          const handlers = listeners.get(event) ?? new Set();
          listeners.set(event, handlers);
          handlers.add(handler);
          subscriptions.push(() => handlers.delete(handler));
        },
      };
      let card: Card;
      try {
        card = type
          ? type.factory(cfg, cardEnv)
          : noteCard("Unknown card", (theme, width) => [
              theme.fg("warning", truncateToWidth(`No card type "${cfg.type}".`, width, "…")),
              theme.fg("dim", truncateToWidth(`Available: ${[...cardTypes.keys()].join(", ")}`, width, "…")),
            ]);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        card = noteCard(cfg.type, (theme, width) => [theme.fg("error", truncateToWidth(`card error: ${message}`, width, "…"))]);
      }
      return {
        cfg,
        card,
        collapsed: cfg.collapsed === true,
        dispose: () => subscriptions.forEach((off) => off()),
        scrollTop: 0,
        stick: card.follow === true,
        overflow: 0,
      };
    }

    // A card is someone else's code: when it throws, show that instead of breaking the whole pane.
    function guard<T>(fn: () => T, fallback: T): T {
      try {
        return fn();
      } catch {
        return fallback;
      }
    }

    // The header is always the first row. Open: a box. Collapsed: that one row, closed with ├ ┤.
    // `bodyRows`, for a card with "fill", is the exact number of body rows it is given.
    function frame(entry: Entry, width: number, theme: Theme, bodyRows?: number): string[] {
      const { card, collapsed: isCollapsed } = entry;
      const border = (s: string) => theme.fg("border", s);
      const inner = Math.max(1, width - 4);

      // header = cap ─ label ─────  caret  ─ cap   (7 columns of frame around label and fill)
      const room = Math.max(1, width - 7);
      // After the title: the card's summary while it is collapsed, its subtitle while it is open.
      // The subtitle gets the columns the title leaves (" title · subtitle " around it).
      const subRoom = room - visibleWidth(card.title) - 5;
      const tail = isCollapsed
        ? guard(() => card.summary?.(theme), undefined)
        : subRoom >= 4
          ? guard(() => card.subtitle?.(theme, subRoom), undefined)
          : undefined;
      const label = truncateToWidth(
        ` ${theme.fg("accent", card.title)}${tail ? theme.fg("dim", " · ") + tail : ""} `,
        room,
        "…",
      );
      const fill = "─".repeat(Math.max(0, room - visibleWidth(label)));
      const [left, right] = isCollapsed ? ["├", "┤"] : ["╭", "╮"];
      const caret = theme.fg("accent", isCollapsed ? CARET_CLOSED : CARET_OPEN);
      const out: string[] = [border(left + "─") + label + border(fill) + " " + caret + " " + border("─" + right)];
      if (isCollapsed) return out;

      let body = guard(() => card.render(inner, theme, bodyRows), [theme.fg("error", "card error: it could not be drawn")]);
      // Taller than its rows: a window of it, with a scrollbar in the right border.
      let thumb: [number, number] | undefined; // first and last body row of the thumb
      entry.overflow = 0;
      if (bodyRows !== undefined) {
        const total = body.length;
        if (total > bodyRows) {
          const maxTop = total - bodyRows;
          const top = card.follow === true && entry.stick ? maxTop : Math.max(0, Math.min(entry.scrollTop, maxTop));
          entry.scrollTop = top;
          entry.overflow = total;
          const size = Math.max(1, Math.round((bodyRows * bodyRows) / total));
          const at = maxTop === 0 ? 0 : Math.round((top / maxTop) * (bodyRows - size));
          thumb = [at, at + size - 1];
          body = body.slice(top, top + bodyRows);
        } else {
          entry.scrollTop = 0;
          while (body.length < bodyRows) body.push("");
        }
      }
      body.forEach((line, i) => {
        const bar = thumb && i >= thumb[0] && i <= thumb[1] ? theme.fg("accent", "┃") : border("│");
        out.push(border("│") + " " + truncateToWidth(line, inner, "…", true) + " " + bar);
      });
      out.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
      return out;
    }

    // ---- the pane's content: used by both containers, the dock and the overlay ------------------

    // Draws the cards into at most `room` rows. When they need more, it draws a window of them
    // (see the scrolling notes at the top of the file).
    function renderPane(width: number, room: number, theme: Theme): string[] {
      const lines: string[] = [];
      const headers: { row: number; card: number; bodyRows: number; open: boolean }[] = []; // in content rows

      // Every drawn card at its natural size first. A card with its own height (set by dragging, or
      // "height" in side-pane.json) is drawn at that size, unless it has "fill".
      const order = drawn();
      const isFill = (i: number) => entries[i].cfg.fill === true && !entries[i].collapsed;
      const own = (i: number) => (typeof entries[i].cfg.height === "number" ? (entries[i].cfg.height as number) : undefined);
      const frames = order.map((i) =>
        !isFill(i) && !entries[i].collapsed && own(i) !== undefined ? frame(entries[i], width, theme, own(i)) : frame(entries[i], width, theme),
      );

      const fillers = order.flatMap((i, k) => (isFill(i) ? [k] : []));
      if (fillers.some((k) => own(order[k]) !== undefined)) {
        // Some fill cards have been sized: their heights are shares of what the fixed cards leave.
        const fixed = frames.reduce((n, f, k) => (fillers.includes(k) ? n : n + f.length), 0);
        const avail = Math.max(fillers.length * 3, room - fixed - fillers.length * 2); // body rows to share
        const known = fillers.map((k) => own(order[k])).filter((h): h is number => h !== undefined);
        const mean = known.reduce((n, h) => n + h, 0) / known.length;
        const weights = fillers.map((k) => own(order[k]) ?? mean);
        const sum = weights.reduce((n, w) => n + w, 0);
        const rows = weights.map((w) => Math.max(3, Math.floor((avail * w) / sum)));
        let left = avail - rows.reduce((n, r) => n + r, 0);
        for (let n = 0; left > 0 && n < rows.length; n = (n + 1) % rows.length, left--) rows[n]++;
        fillers.forEach((k, n) => (frames[k] = frame(entries[order[k]], width, theme, rows[n])));
      } else {
        // Rows left over go, evenly, to the open cards with "fill" (the first ones get the odd rows).
        // A collapsed card is one row and never grows. With no free rows, nothing changes.
        const free = room - frames.reduce((n, f) => n + f.length, 0);
        if (free > 0 && fillers.length > 0) {
          fillers.forEach((k, n) => {
            const extra = Math.floor(free / fillers.length) + (n < free % fillers.length ? 1 : 0);
            frames[k] = frame(entries[order[k]], width, theme, frames[k].length - 2 + extra);
          });
        }
      }

      order.forEach((i, position) => {
        headers.push({ row: lines.length, card: i, bodyRows: entries[i].collapsed ? 0 : frames[position].length - 2, open: !entries[i].collapsed });
        lines.push(...frames[position]);
      });

      contentRows = lines.length;
      if (lines.length <= room) {
        scroll = 0;
        viewRows = lines.length;
        above = below = 0;
        headerRows = headers;
        return lines;
      }
      viewRows = room;
      scroll = Math.max(0, Math.min(scroll, lines.length - room));
      const view = lines.slice(scroll, scroll + room);
      above = scroll;
      below = lines.length - (scroll + room);
      // A ▲ / ▼ row replaces the edge row on that side, so it hides one more content row.
      const note = (arrow: string, hiddenRows: number) => {
        const label = ` ${arrow} ${hiddenRows} more `;
        const pad = Math.max(0, width - visibleWidth(label));
        const left = Math.floor(pad / 2);
        return " ".repeat(left) + theme.fg("accent", label) + " ".repeat(pad - left);
      };
      if (above > 0) view[0] = note("▲", above + 1);
      if (below > 0) view[room - 1] = note("▼", below + 1);
      headerRows = headers
        .map((h) => ({ row: h.row - scroll, card: h.card, bodyRows: h.bodyRows, open: h.open }))
        .filter((h) => h.row >= (above > 0 ? 1 : 0) && h.row < room - (below > 0 ? 1 : 0));
      return view;
    }

    // Resizing by dragging a card's top or bottom edge (cards with "resizable": true). `start` holds
    // the body rows of every open card when the press happened.
    const MIN_BODY_ROWS = 3;
    let drag: { card: number; edge: "top" | "bottom"; y0: number; start: Map<number, number>; moved: boolean } | undefined;
    let swallowClick = false; // the click that follows a drag's release is not a click on the header

    function resize(d: NonNullable<typeof drag>, dy: number) {
      const grow = d.edge === "top" ? -dy : dy; // dragging the top edge up, or the bottom edge down, adds rows
      const entry = entries[d.card];
      const startOf = (i: number) => d.start.get(i) ?? (typeof entries[i].cfg.height === "number" ? (entries[i].cfg.height as number) : MIN_BODY_ROWS);
      if (entry.cfg.fill !== true) {
        entry.cfg.height = Math.max(MIN_BODY_ROWS, Math.min(300, startOf(d.card) + grow));
        return;
      }
      // A fill card takes its rows from the nearest fill card on the other side of the edge.
      const fillers = drawn().filter((i) => entries[i].cfg.fill === true && !entries[i].collapsed);
      const at = fillers.indexOf(d.card);
      const partner = fillers[d.edge === "top" ? at - 1 : at + 1];
      if (partner === undefined || at < 0) return;
      for (const i of fillers) entries[i].cfg.height = startOf(i); // from now on their heights are shares
      const sx = startOf(d.card);
      const sp = startOf(partner);
      const g = Math.max(MIN_BODY_ROWS - sx, Math.min(grow, sp - MIN_BODY_ROWS));
      entry.cfg.height = sx + g;
      entries[partner].cfg.height = sp - g;
    }

    function saveSizes() {
      const error = saveCards(entries.map((e) => e.cfg));
      if (error) ctx.ui.notify(error, "warning");
    }

    // Mouse input, with x and y local to the container. `bodyX` is where a card's body starts in x.
    function paneMouse(event: { type: string; button: string; x?: number; y: number; wheelDelta?: number }, bodyX = 0) {
      if (drag) {
        if (event.type === "drag") {
          if (event.y !== drag.y0) drag.moved = true;
          resize(drag, event.y - drag.y0);
          return { handled: true, render: true };
        }
        if (event.type === "release" || event.type === "click") {
          const d = drag;
          drag = undefined;
          swallowClick = true;
          if (d.moved) saveSizes();
          else if (d.edge === "top") entries[d.card].collapsed = !entries[d.card].collapsed; // it was a click on the header
          return { handled: true, render: true };
        }
        return { handled: true };
      }
      if (event.type === "press") swallowClick = false;
      if (event.type === "click" && swallowClick) {
        swallowClick = false;
        return { handled: true };
      }
      if (event.type === "press" && event.button === "left") {
        const edge = headerRows.find(
          (h) => h.open && entries[h.card].cfg.resizable === true && (event.y === h.row || event.y === h.row + h.bodyRows + 1),
        );
        if (edge) {
          drag = {
            card: edge.card,
            edge: event.y === edge.row ? "top" : "bottom",
            y0: event.y,
            start: new Map(headerRows.filter((h) => h.open).map((h) => [h.card, h.bodyRows])),
            moved: false,
          };
          return { handled: true, capture: true, render: true };
        }
      }

      // Over a card's body: the card gets the event first (a file tree scrolls and opens files).
      const over = headerRows.find((h) => event.y > h.row && event.y <= h.row + h.bodyRows);
      if (over) {
        const card = entries[over.card].card;
        const result = guard(
          () =>
            card.handleMouse?.({
              type: event.type,
              button: event.button,
              x: (event.x ?? 0) - bodyX,
              y: event.y - over.row - 1,
              wheelDelta: event.wheelDelta,
            }),
          undefined,
        );
        if (result?.handled) return { handled: true, render: true };
        // A body taller than its rows scrolls with the wheel (and does not hand the wheel on at its ends).
        const entry = entries[over.card];
        if (event.type === "wheel" && entry.overflow > 0) {
          const delta = Math.max(-6, Math.min(6, Math.round(event.wheelDelta ?? 0)));
          const maxTop = entry.overflow - over.bodyRows;
          entry.scrollTop = Math.max(0, Math.min(maxTop, entry.scrollTop + delta));
          if (entry.card.follow === true) entry.stick = entry.scrollTop >= maxTop;
          return { handled: true, render: true };
        }
      }
      if (event.type === "wheel") {
        // Not overflowing, or already at the end: unhandled, so the chat scrolls instead.
        const delta = Math.max(-6, Math.min(6, Math.round(event.wheelDelta ?? 0)));
        return delta !== 0 && scrollBy(delta) ? { handled: true, render: true } : undefined;
      }
      if (event.type !== "click" || event.button !== "left") return undefined;
      // Clicking the ▲ / ▼ row pages that way.
      if (above > 0 && event.y === 0) return scrollBy(-(viewRows - 2)), { handled: true, render: true };
      if (below > 0 && event.y === viewRows - 1) return scrollBy(viewRows - 2), { handled: true, render: true };
      // A click on a card's header row collapses or opens that card.
      const hit = headerRows.find((h) => h.row === event.y);
      if (!hit) return undefined;
      entries[hit.card].collapsed = !entries[hit.card].collapsed;
      return { handled: true, render: true };
    }

    // ---- container 1: a dock, a real column next to the chat -----------------------------------
    //
    // Pi's fullscreen layout has one root component. The dock wraps that root in a horizontal
    // stack, [ pi's own root | the pane ], so the chat, the editor and the footer all lay out in
    // the columns that are left. Pi's own root is captured once and put back on shutdown.

    let tuiRef: any; // pi's TUI, handed to the widget factory below
    let baseRoot: Component | undefined; // pi's own layout root
    let composedRoot: Component | undefined; // the root we installed (to notice when pi replaces it)
    let dockEntry: { basis?: number | "auto"; minSize?: number; maxSize?: number } | undefined;
    let chatEntry: { basis?: number | "auto"; minSize?: number; maxSize?: number } | undefined; // the chat, while a file is open
    let layoutMode: "dock" | "overlay" | undefined;
    let warnedLayout = false;

    // How many columns the dock takes of a terminal `total` columns wide. The width the user set by
    // dragging the pane's left edge wins over the configured one, for the rest of the session.
    let draggedWidth: number | undefined;
    let dockCols = 0; // the width the dock has right now
    const dockWidth = (total: number) => {
      const wanted = draggedWidth ?? (typeof config.width === "number" ? config.width : Math.floor((total * parseFloat(config.width)) / 100));
      return Math.max(config.minWidth, Math.min(wanted, total - MIN_CHAT_COLUMNS));
    };

    // The stack asks this on every layout pass. It also sets the dock's width: the entry is
    // given the same minimum, maximum and basis, so it is exactly `cols` wide.
    function dockVisible(viewport: { width: number }): boolean {
      const show = enabled && viewport.width >= config.minTerminalWidth && drawn().length > 0;
      const cols = show ? dockWidth(viewport.width) : 0;
      dockCols = cols;
      if (dockEntry && show) {
        dockEntry.basis = cols;
        dockEntry.minSize = cols;
        dockEntry.maxSize = cols;
      }
      return show;
    }

    // Mouse input over the dock. Its left edge (the blank column and the cards' left border) is a
    // handle: press there and drag to make the pane wider or narrower. Everything else is the pane's.
    const GRAB_COLUMNS = 2;
    let grab: number | undefined; // the column of the handle that was pressed, while dragging
    let grabCols = 0; // the dock's width when it was pressed
    function dockMouse(event: any) {
      const x = event.x ?? 0;
      if (event.button === "left" && event.type === "press" && x >= 0 && x < GRAB_COLUMNS) {
        grab = x;
        grabCols = dockCols;
        return { handled: true, capture: true, render: true };
      }
      if (grab !== undefined && event.type === "drag") {
        // While a drag is captured, `x` stays measured from where the dock's left edge was at the
        // press (negative: the pointer is left of it), however the dock has moved since.
        const total = tuiRef?.terminal?.columns || process.stdout.columns || 120;
        const wanted = grabCols - (x - grab);
        draggedWidth = Math.max(config.minWidth, Math.min(wanted, total - MIN_CHAT_COLUMNS));
        return { handled: true, render: true };
      }
      if (grab !== undefined && (event.type === "release" || event.type === "click")) {
        grab = undefined;
        if (draggedWidth !== undefined) {
          // Keep it as a percentage, rounded up so the same width comes back at this terminal size.
          const total = tuiRef?.terminal?.columns || process.stdout.columns || 120;
          config.width = `${Math.ceil((draggedWidth / total) * 10000) / 100}%`;
          draggedWidth = undefined;
          const error = saveLayout({ width: config.width });
          if (error) ctx.ui.notify(error, "warning");
        }
        return { handled: true, render: true };
      }
      return paneMouse(event, 3); // 1 gutter + frame + space
    }

    const dockView: Component = {
      render: (width: number) => {
        const rows = tuiRef?.terminal?.rows || process.stdout.rows || 24;
        // The live theme every frame, so a theme change needs no rebuild. One blank column on the
        // left keeps the cards off the chat.
        return renderPane(Math.max(1, width - 1), rows, ctx.ui.theme).map((line) => " " + line);
      },
      handleMouse: ((event: any) => dockMouse(event)) as Component["handleMouse"],
      invalidate() {},
    };

    function chatVisible(viewport: { height: number }): boolean {
      if (chatEntry) {
        const rows = chatRows(viewport.height);
        chatEntry.basis = rows;
        chatEntry.minSize = rows;
        chatEntry.maxSize = rows;
      }
      return true;
    }

    function composeDock(): boolean {
      const tui = tuiRef;
      if (!tui || !isViewportTUI(tui)) return false;
      const current = (tui as any).layoutRoot as Component | undefined;
      if (!current) return false; // nothing to wrap
      if (current !== composedRoot) baseRoot = current; // pi's own root, or a fresh one after a mode switch
      // The left side: pi's own root (the chat) alone, or under the file viewer when a file is open.
      let left: Component;
      chatEntry = undefined;
      // The chat is always in a box; with a file open it shares the main area with the file's box.
      const theme = () => ctx.ui.theme;
      const rows = () => tuiRef?.terminal?.rows || process.stdout.rows || 24;
      const ownBody = chatBody(baseRoot!, theme, rows); // undefined: pi's root is not what we expect
      const chatBox = box({
        theme,
        rows,
        top: {
          render: (w) => [ruleLine(theme(), w, theme().fg("border", "─") + " " + theme().fg("accent", "Chat") + " ")],
          // With a file open the top edge is the handle that resizes the viewer.
          handleMouse: viewer.isOpen() ? chatEdgeMouse : undefined,
          invalidate() {},
        },
        body: ownBody ?? baseRoot!,
        ownSides: ownBody !== undefined,
      });
      if (viewer.isOpen()) {
        const fileBox = box({ theme, rows, top: viewer.title, body: viewer.body(), bottom: viewer.bar, openRight: true });
        const stack = new MeasurementSafeVStack([
          { component: fileBox, basis: 0, grow: 1, shrink: 1, minSize: 4 },
          // The chat gets a fixed number of rows, set on every layout pass from the window's height.
          { component: chatBox, basis: 11, grow: 0, shrink: 0, minSize: 8, visible: chatVisible },
        ]);
        chatEntry = (stack as any).entries.find((e: { component: Component }) => e.component === chatBox);
        left = stack;
      } else {
        left = new MeasurementSafeVStack([{ component: chatBox, basis: 0, grow: 1, shrink: 1, minSize: 1 }]);
      }
      const stack = new HStack([
        { component: left, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        { component: dockView, basis: 0, grow: 0, shrink: 0, minSize: 0, visible: dockVisible },
      ]);
      // The stack copies the options it is given into its own entry objects: this one is ours to tune.
      dockEntry = (stack as any).entries.find((e: { component: Component }) => e.component === dockView);
      composedRoot = stack;
      tui.setLayoutRoot(stack);
      tui.requestRender(true); // a full repaint: never diff the new layout against the old screen
      return true;
    }

    // Puts pi's own root back.
    function restoreRoot() {
      const tui = tuiRef;
      if (tui && composedRoot && baseRoot && isViewportTUI(tui)) {
        if ((tui as any).layoutRoot === composedRoot) tui.setLayoutRoot(baseRoot);
        tui.requestRender(true);
      }
      composedRoot = undefined;
      dockEntry = undefined;
    }

    // Pi swaps the layout root itself when its display mode changes, without an event. Called on
    // every frame by the widget below: if our root is gone, install it again.
    function heal() {
      if (layoutMode !== "dock" || !tuiRef) return;
      if ((tuiRef as any).layoutRoot !== composedRoot) composeDock();
    }

    // ---- container 2: an overlay, the fallback when pi is not in fullscreen mode ---------------

    function unmountOverlay() {
      dispose?.();
      dispose = undefined;
    }

    function mountOverlay() {
      unmountOverlay();
      if (entries.length === 0) return;
      // Not awaited: the promise only resolves when the overlay is disposed.
      void ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          requestRender = () => tui.requestRender();
          dispose = () => done();
          return {
            // Pi cuts an overlay off at maxHeight, so draw a window of the content and scroll that.
            render: (width: number) => renderPane(width, paneRows(), theme),
            handleMouse: (event: any) => paneMouse(event, 2), // frame + space
            invalidate() {},
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "top-right",
            width: config.width,
            minWidth: config.minWidth,
            maxHeight: config.maxHeight,
            margin: { top: 1, right: 1 },
            // With no card available there is nothing to show, so the pane itself disappears.
            visible: (termWidth: number) => enabled && termWidth >= config.minTerminalWidth && drawn().length > 0,
            nonCapturing: true,
          },
        },
      );
    }

    // ---- choosing the container -----------------------------------------------------------------

    function layout() {
      const dockable = !!tuiRef && isViewportTUI(tuiRef) && !!(tuiRef as any).layoutRoot;
      if (config.layout === "dock" && !dockable && !warnedLayout) {
        warnedLayout = true;
        ctx.ui.notify('side-pane: "layout": "dock" needs pi\'s fullscreen mode, using the overlay instead.', "warning");
      }
      if (config.layout !== "overlay" && dockable) {
        unmountOverlay();
        if (composeDock()) {
          layoutMode = "dock";
          return;
        }
      }
      restoreRoot();
      layoutMode = "overlay";
      mountOverlay();
    }

    // Pi's footer is hidden (always, or while a session card carries what it shows).
    let footerHidden = false;
    function syncFooter() {
      // With hideFooter off: only while the pane, with a session card, is on screen.
      const want =
        config.hideFooter ||
        (enabled && (process.stdout.columns || 0) >= config.minTerminalWidth && drawn().some((i) => entries[i].cfg.type === "session"));
      if (want === footerHidden) return;
      footerHidden = want;
      try {
        ctx.ui.setFooter(want ? () => ({ render: () => [], invalidate() {} }) : undefined);
      } catch {
        // the session is already gone
      }
    }

    // Pi hands its TUI to a widget factory. The widget itself draws nothing; it is there to get the
    // TUI and to run heal() on every frame.
    function ensureWidget() {
      ctx.ui.setWidget(WIDGET_KEY, (tui) => {
        tuiRef = tui;
        requestRender = () => tui.requestRender();
        if (entries.length > 0 && !layoutMode) layout(); // start() already ran: choose now, before the first frame
        return {
          render: () => {
            heal();
            syncFooter();
            return [];
          },
          invalidate() {},
        };
      });
      // Safety net: if the factory never runs, still show the pane as an overlay.
      setTimeout(() => {
        if (entries.length > 0 && !layoutMode) layout();
      }, 400);
    }

    teardown = () => {
      viewer.close();
      activeViewer = undefined;
      if (repaintTimer) clearTimeout(repaintTimer);
      repaintTimer = undefined;
      unmountOverlay();
      restoreRoot();
      try {
        if (footerHidden) ctx.ui.setFooter(undefined);
        footerHidden = false;
        ctx.ui.setWidget(WIDGET_KEY, undefined);
      } catch {
        // the session is already gone
      }
    };

    // The visual card editor (/pane config): switch cards on and off and reorder them, with the
    // pane following live behind the editor. Enter saves into side-pane.json, Esc undoes it all.
    async function configure(cmdCtx: ExtensionCommandContext) {
      const describe = (cfg: CardConfig): EditorRow => {
        const type = cardTypes.get(cfg.type);
        return {
          cfg,
          type: cfg.type,
          title: typeof cfg.title === "string" ? cfg.title : (type?.meta.title ?? cfg.type),
          description: type?.meta.description,
          needs: type?.meta.needs,
          known: !!type,
        };
      };

      // The configured cards in order, then the card types nobody uses yet, switched off.
      const savedEntries = [...entries];
      const savedEnabled = savedEntries.map((e) => e.cfg.enabled);
      const savedFill = savedEntries.map((e) => e.cfg.fill);
      const byConfig = new Map<CardConfig, Entry>(entries.map((e) => [e.cfg, e]));
      const rows = entries.map((e) => describe(e.cfg));
      for (const name of cardTypes.keys()) {
        if (!entries.some((e) => e.cfg.type === name)) rows.push(describe({ type: name, enabled: false }));
      }

      const preview = () => {
        let built = false;
        entries = rows.map((r) => {
          let entry = byConfig.get(r.cfg);
          if (!entry) {
            entry = buildEntry(r.cfg);
            byConfig.set(r.cfg, entry);
            built = true;
          }
          return entry;
        });
        if (built) void refreshAll?.(); // a card that was never shown needs its first data
        requestRender?.();
      };

      const save = await cmdCtx.ui.custom<boolean>(
        (tui, theme, _keybindings, done) =>
          createCardsEditor({ theme, rows, onChange: preview, done, requestRender: () => tui.requestRender() }),
        { overlay: true, overlayOptions: { anchor: "center", width: "60%", minWidth: 54, maxHeight: "85%" } },
      );

      if (!save) {
        // Undo the preview: the cards and their switches as they were.
        for (const entry of byConfig.values()) if (!savedEntries.includes(entry)) entry.dispose();
        entries = savedEntries;
        savedEntries.forEach((e, i) => {
          if (savedEnabled[i] === undefined) delete e.cfg.enabled;
          else e.cfg.enabled = savedEnabled[i];
          if (savedFill[i] === undefined) delete e.cfg.fill;
          else e.cfg.fill = savedFill[i];
        });
        requestRender?.();
        return;
      }
      const error = saveCards(rows.map((r) => r.cfg));
      config.cards = rows.map((r) => r.cfg);
      cmdCtx.ui.notify(error ?? "Side pane cards saved.", error ? "warning" : "info");
    }

    refreshAll = async () => {
      if (busy) return;
      busy = true;
      try {
        viewer.reload(); // the open file may have changed on disk
        await Promise.allSettled(entries.filter((e) => e.cfg.enabled !== false).map((e) => e.card.refresh()));
        requestRender?.();
      } finally {
        busy = false;
      }
    };

    function start() {
      entries.forEach((e) => e.dispose());
      entries = config.cards.map(buildEntry);
      if (tuiRef) layout(); // otherwise the widget factory picks the container as soon as it has the TUI
      void refreshAll?.();
      if (timer) clearInterval(timer);
      timer = setInterval(() => void refreshAll?.(), config.refreshSeconds * 1000);
    }

    pane = {
      toggle() {
        enabled = !enabled;
        requestRender?.();
        return enabled;
      },
      set(on) {
        enabled = on;
        requestRender?.();
      },
      toggleCard(n) {
        const i = n - 1;
        if (!(i >= 0 && i < entries.length)) return `No card ${n}: the pane has ${entries.length}.`;
        const { card, cfg } = entries[i];
        entries[i].collapsed = !entries[i].collapsed;
        requestRender?.();
        if (cfg.enabled === false) return `Card ${n} (${card.title}) is switched off (see /pane config). Its state was still changed.`;
        return card.available?.() === false
          ? `Card ${n} (${card.title}) is hidden right now${card.needs ? `: it needs ${card.needs}` : ""}. Its state was still changed.`
          : undefined;
      },
      setAllCollapsed(on) {
        entries.forEach((e) => (e.collapsed = on));
        requestRender?.();
      },
      configure,
      openFile,
      closeFile,
      sendReview: () => viewer.sendReview(),
      scroll(where) {
        const page = Math.max(1, Math.floor(viewRows / 2));
        if (where === "up") scrollBy(-page);
        else if (where === "down") scrollBy(page);
        else scroll = where === "top" ? 0 : Number.MAX_SAFE_INTEGER; // clamped on the next render
        requestRender?.();
      },
      reload() {
        const { config: next, error } = loadConfig();
        config = next;
        enabled = next.enabled;
        start();
        return error;
      },
    };

    ensureWidget();
    start();
  });

  pi.on("agent_end", () => void refreshAll?.());
  pi.on("tool_result", (event) => {
    if ((event.toolName !== "write" && event.toolName !== "edit") || event.isError) return;
    const path = (event.input as { path?: unknown } | undefined)?.path;
    if (typeof path !== "string") return;
    touch(path, Date.now());
    activeViewer?.reload(); // the agent changed a file: the viewer shows it again if it is the open one
    repaint?.();
  });
  pi.on("session_shutdown", () => stop());
}
