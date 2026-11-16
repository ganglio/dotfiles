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
  [option: string]: unknown;
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
  // `height` is only given to a card with "fill": the rows the pane gives its body. Use them if the
  // card can show more (the pane pads the body, or cuts it, to exactly that many rows).
  render(width: number, theme: Theme, height?: number): string[];
  // Optional: one line (may be styled) shown after the title while the card is collapsed.
  summary?(theme: Theme): string | undefined;
}

// A card file's default export.
export type CardFactory = (config: CardConfig, env: CardEnv) => Card;

// A card file's optional `meta` export, shown in the card editor (/pane config).
export interface CardMeta {
  title?: string;
  description?: string;
  needs?: string;
}
