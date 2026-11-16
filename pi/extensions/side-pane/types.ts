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
  [option: string]: unknown;
}

// What the pane hands to every card.
export interface CardEnv {
  // Runs git in pi's working directory. undefined = failed (not a repository, no commits, ...).
  git(args: string[], timeoutMs?: number): Promise<string | undefined>;
  cwd: string;
  // Files the agent wrote or edited in this session: absolute path -> how often, and when last.
  touched: Map<string, { count: number; at: number }>;
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
  render(width: number, theme: Theme): string[];
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
