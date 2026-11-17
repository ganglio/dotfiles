// Small helpers shared by the cards.

import { visibleWidth } from "@earendil-works/pi-tui";
import type { CardEnv } from "./types";

// The git marks of the session card and the working tree card.
export const STAGED = "✚"; // ✚
export const UNSTAGED = "●"; // ●
export const UNTRACKED = "?";

// A number option, rounded and kept inside [min, max]; `fallback` when it is not a number.
export const clampInt = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

// Whether pi's working directory is inside a git work tree.
export const inRepo = async (env: CardEnv) => (await env.git(["rev-parse", "--is-inside-work-tree"]))?.trim() === "true";

// Cuts from the left, so the end of a path (the file name) survives: "…/deep/dir/file.ts".
export function truncateLeft(text: string, max: number): string {
  if (visibleWidth(text) <= max) return text;
  return "…" + Array.from(text).slice(-Math.max(1, max - 1)).join("");
}

// "3m", "2h", "5d"; "now" under a minute; "" when the time is unknown.
export function age(at: number): string {
  if (!at) return "";
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
