// The types a card is written against. See cards/README.md.

import type { Theme } from "@earendil-works/pi-coding-agent";

// One entry of "cards" in side-pane.json: its type (the name of the card's file in cards/) plus
// the options of that card type.
export interface CardConfig {
  type: string;
  title?: string;
  // false = configured but not shown. Set by the card editor (/pane config). Default: true.
  enabled?: boolean;
  // true = the card starts collapsed.
  collapsed?: boolean;
  // true = the card grows to take the free rows of the pane. When several open cards have it, they
  // share the free rows evenly.
  fill?: boolean;
  // true = the card's top and bottom edges can be dragged to resize it. A card that is not
  // resizable keeps the size its content (or "fill") gives it.
  resizable?: boolean;
  // The body height in rows, set by dragging and saved. For a "fill" card it is a share: the fill
  // cards split the free rows in proportion to their heights.
  height?: number;
  [option: string]: unknown;
}

// Live facts about the pi session (see CardEnv.session).
export interface SessionInfo {
  provider?: string;
  model?: string;
  thinkingLevel?: string;
  // Tokens in the context (null = unknown, e.g. right after a compaction), the model's window and
  // the percentage used. undefined when pi does not know.
  context?: { tokens: number | null; window: number; percent: number | null };
}

// What the pane hands to every card.
export interface CardEnv {
  // Runs git in pi's working directory. undefined = failed (not a repository, no commits, ...).
  git(args: string[], timeoutMs?: number): Promise<string | undefined>;
  cwd: string;
  // Files the agent wrote or edited in this session: absolute path -> how often, and when last.
  touched: Map<string, { count: number; at: number }>;
  // Subscribes to a pi event (the same event object an extension would get from pi.on) for as long
  // as the card lives. The events on offer: before_agent_start, agent_start, agent_end, turn_start,
  // turn_end, message_start, message_update, message_end, tool_execution_start,
  // tool_execution_end, tool_call, tool_result. A handler that throws is ignored.
  on(event: string, handler: (event: any) => void): void;
  // Asks the pane to redraw, for state that changed outside refresh(). Calls are coalesced to
  // about 15 redraws a second, so it is safe to call on every streamed token.
  repaint(): void;
  // The entries of the current session branch, oldest first (same data as
  // ctx.sessionManager.getBranch()). For rebuilding a card's state after /reload or a resume.
  sessionEntries(): unknown[];
  // The model, thinking level and context use, as pi's footer showed them. Read it on every draw.
  session(): SessionInfo;
  // Opens a file in the file viewer, which splits the main area (pi's fullscreen mode only).
  openFile(path: string): void;
  // The absolute path of the file the viewer shows, if any.
  openedFile(): string | undefined;
}

// A mouse event over a card's body, with x and y local to the body (0,0 = its first cell).
export interface CardMouseEvent {
  type: string; // "click" | "press" | "release" | "drag" | "wheel" | ...
  button: string; // "left" | "middle" | "right" | "none"
  x: number;
  y: number;
  wheelDelta?: number;
}

export interface Card {
  title: string;
  // What the card depends on, in words ("a git repository"). Documentation for humans only.
  needs?: string;
  // false = the dependency is not met right now: the card is not drawn at all (default: true).
  // A card that must probe first answers false until its first refresh() has finished.
  available?(): boolean;
  refresh(): Promise<void>;
  // Content lines for the given inner width; the pane draws the frame around them.
  // `height` is only given to a card with "fill" or its own height (it was resized): the rows the
  // pane gives its body. The pane pads a shorter body; a longer one scrolls (wheel, scrollbar), so
  // a card can simply return everything it has when it gets a height.
  render(width: number, theme: Theme, height?: number): string[];
  // Optional: true = when the body is taller than its rows and scrolled to the end, it stays at
  // the end as content is added (until the user scrolls up). For streaming output.
  follow?: boolean;
  // Optional: one line (may be styled) shown after the title while the card is collapsed.
  summary?(theme: Theme): string | undefined;
  // Optional: a short text shown after the title, dimmed, while the card is open (the folder a
  // file browser shows, say). `room` is the number of columns available: fit the text into it.
  subtitle?(theme: Theme, room: number): string | undefined;
  // Optional: mouse input over the card's body (clicks, wheel). Return { handled: true } when the
  // card used the event; a wheel event it does not handle scrolls the pane instead.
  handleMouse?(event: CardMouseEvent): { handled?: boolean } | undefined;
}

// A card file's default export.
export type CardFactory = (config: CardConfig, env: CardEnv) => Card;

// A card file's optional `meta` export, shown in the card editor (/pane config).
export interface CardMeta {
  title?: string;
  description?: string;
  needs?: string;
}
