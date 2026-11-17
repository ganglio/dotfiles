// side-pane.json: reading it, and saving the list of cards back.

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CardConfig } from "./types";

export interface PaneConfig {
  enabled: boolean;
  layout: "auto" | "dock" | "overlay";
  width: number | `${number}%`;
  minWidth: number;
  maxHeight: number | `${number}%`;
  minTerminalWidth: number;
  // How tall the file viewer is while a file is open: rows, or a percentage of the window. Unset: the chat gets 11 rows.
  viewerHeight?: number | `${number}%`;
  hideFooter: boolean;
  // Colour the file viewer's text by language.
  syntaxHighlight: boolean;
  refreshSeconds: number;
  shortcut?: string;
  cards: CardConfig[];
}

const DEFAULT_CONFIG: PaneConfig = {
  enabled: true,
  layout: "auto",
  width: "30%",
  minWidth: 34,
  maxHeight: "75%",
  minTerminalWidth: 110,
  hideFooter: true,
  syntaxHighlight: true,
  refreshSeconds: 10,
  cards: [{ type: "git-log" }],
};

const configPath = () => join(getAgentDir(), "side-pane.json");

const defaults = (): PaneConfig => ({ ...DEFAULT_CONFIG, cards: DEFAULT_CONFIG.cards.map((c) => ({ ...c })) });

const isSize = (v: unknown): v is number | `${number}%` =>
  (typeof v === "number" && v > 0) || (typeof v === "string" && /^\d+(\.\d+)?%$/.test(v));

// Reads side-pane.json. A missing file means defaults; a broken one means defaults plus an error.
export function loadConfig(): { config: PaneConfig; error?: string } {
  let raw: string;
  try {
    raw = readFileSync(configPath(), "utf8");
  } catch {
    return { config: defaults() };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<PaneConfig>;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("the file must hold a JSON object");
    const problems: string[] = [];
    const config = defaults();

    if (parsed.enabled !== undefined) typeof parsed.enabled === "boolean" ? (config.enabled = parsed.enabled) : problems.push('"enabled" must be true or false');
    if (parsed.layout !== undefined) {
      parsed.layout === "auto" || parsed.layout === "dock" || parsed.layout === "overlay"
        ? (config.layout = parsed.layout)
        : problems.push('"layout" must be "auto", "dock" or "overlay"');
    }
    if (parsed.hideFooter !== undefined) typeof parsed.hideFooter === "boolean" ? (config.hideFooter = parsed.hideFooter) : problems.push('"hideFooter" must be true or false');
    if (parsed.syntaxHighlight !== undefined) typeof parsed.syntaxHighlight === "boolean" ? (config.syntaxHighlight = parsed.syntaxHighlight) : problems.push('"syntaxHighlight" must be true or false');
    if (parsed.width !== undefined) isSize(parsed.width) ? (config.width = parsed.width) : problems.push('"width" must be a number or a percentage like "30%"');
    if (parsed.viewerHeight !== undefined) isSize(parsed.viewerHeight) ? (config.viewerHeight = parsed.viewerHeight) : problems.push('"viewerHeight" must be a number or a percentage like "60%"');
    if (parsed.maxHeight !== undefined) isSize(parsed.maxHeight) ? (config.maxHeight = parsed.maxHeight) : problems.push('"maxHeight" must be a number or a percentage like "75%"');
    for (const key of ["minWidth", "minTerminalWidth"] as const) {
      const v = parsed[key];
      if (v !== undefined) typeof v === "number" && v >= 0 ? (config[key] = v) : problems.push(`"${key}" must be a number`);
    }
    if (parsed.refreshSeconds !== undefined) {
      typeof parsed.refreshSeconds === "number" && parsed.refreshSeconds >= 2
        ? (config.refreshSeconds = parsed.refreshSeconds)
        : problems.push('"refreshSeconds" must be a number of at least 2');
    }
    if (parsed.shortcut !== undefined) typeof parsed.shortcut === "string" ? (config.shortcut = parsed.shortcut) : problems.push('"shortcut" must be a string like "ctrl+shift+g"');
    if (parsed.cards !== undefined) {
      const ok =
        Array.isArray(parsed.cards) &&
        parsed.cards.every(
          (c) => c && typeof c === "object" && typeof (c as CardConfig).type === "string" && ((c as CardConfig).enabled === undefined || typeof (c as CardConfig).enabled === "boolean"),
        );
      ok ? (config.cards = parsed.cards as CardConfig[]) : problems.push('"cards" must be a list of objects, each with a "type" (and "enabled", if present, true or false)');
    }
    return { config, error: problems.length ? `side-pane.json: ${problems.join("; ")}` : undefined };
  } catch (e) {
    return { config: defaults(), error: `side-pane.json is not valid, using defaults: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// Writes the list of cards back into side-pane.json and leaves every other key as it was.
// Returns an error message, or undefined on success. A file that is not valid JSON is never
// overwritten. The file may be a symlink into the dotfiles: writing goes through it.
export function saveCards(cards: CardConfig[]): string | undefined {
  return update((current) => {
    // "enabled": true, "fill": false and "resizable": false are the defaults: leave them out so the file stays tidy.
    current.cards = cards.map((c) => {
      const { enabled, fill, resizable, ...rest } = c;
      return {
        ...rest,
        ...(fill === true ? { fill: true } : {}),
        ...(resizable === true ? { resizable: true } : {}),
        ...(enabled === false ? { enabled: false } : {}),
      };
    });
  });
}

// Writes the pane's width and the file viewer's height (what the user set by dragging), leaving
// every other key as it was. Same rules as saveCards.
export function saveLayout(layout: { width?: string; viewerHeight?: string }): string | undefined {
  return update((current) => {
    if (layout.width !== undefined) current.width = layout.width;
    if (layout.viewerHeight !== undefined) current.viewerHeight = layout.viewerHeight;
  });
}

// Reads side-pane.json, lets `change` edit it and writes it back.
function update(change: (current: Record<string, unknown>) => void): string | undefined {
  const path = configPath();
  let current: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not a JSON object");
      current = parsed as Record<string, unknown>;
    } catch (e) {
      return `Not saved: side-pane.json is not valid JSON (${e instanceof Error ? e.message : String(e)}). Fix it by hand first.`;
    }
  }
  change(current);
  try {
    writeFileSync(path, JSON.stringify(current, null, 2) + "\n");
    return undefined;
  } catch (e) {
    return `Not saved: ${e instanceof Error ? e.message : String(e)}`;
  }
}
