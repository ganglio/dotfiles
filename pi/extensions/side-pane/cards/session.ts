// Card: what pi's footer used to show. The model, its thinking level, the folder, the context used
// (tokens, a bar and a percentage) and a git line modelled on the zsh prompt:
//
//    main  f477611  ✚●?  >M<  1⍅ 2⍆  3
//
//   branch icon + branch      or "➦ <hash>" when HEAD is detached
//   hash                      short commit hash
//   ✚ ● ?                     staged changes / modified tracked files / untracked files
//   <B> / >M< / >R>           bisect / merge / rebase in progress
//   N⍅ / N⍆                   commits behind / ahead of the upstream (only with an upstream)
//   stash icon + N            number of stashes
//
// The pane hides pi's own footer ("hideFooter" in side-pane.json), so this is not shown twice.
//
// Options (side-pane.json): git (false = no git line), title.

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import { STAGED, UNSTAGED, UNTRACKED, truncateLeft } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Session",
  description: "Model, thinking level, folder, context used (tokens, bar, percent) and the git branch, hash and marks. Hides pi's own footer. Option: git (false = no git line).",
};

// Glyphs, as used by the prompt theme. Change them here.
const BRANCH_ICON = ""; // Nerd Font git branch
const STASH_ICON = "";
const BEHIND = "⍅";
const AHEAD = "⍆";
const DETACHED = "➦";
const MODE = { bisect: "<B>", merge: ">M<", rebase: ">R>" } as const;
const GAP = "  ";
const MIN_BRANCH_WIDTH = 8;
const WARNING_PERCENT = 70;
const ERROR_PERCENT = 90;

interface Part {
  text: string;
  color?: string; // a pi theme colour name; none = default text colour
}
interface Segment {
  key: "branch" | "hash" | "dirty" | "mode" | "ab" | "stash";
  parts: Part[];
}
interface GitInfo {
  branch?: string; // undefined when detached
  hash?: string;
  behind: number;
  ahead: number;
  stashes: number;
  mode?: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}

const widthOf = (s: Segment) => s.parts.reduce((n, p) => n + visibleWidth(p.text), 0);
const totalWidth = (list: Segment[]) => list.reduce((n, s) => n + widthOf(s), 0) + GAP.length * Math.max(0, list.length - 1);

function buildSegments(info: GitInfo): Segment[] {
  const list: Segment[] = [];
  const name = info.branch ?? `${DETACHED} ${info.hash ?? "?"}`;
  list.push({ key: "branch", parts: [{ text: `${BRANCH_ICON} `, color: "accent" }, { text: name }] });
  if (info.branch && info.hash) list.push({ key: "hash", parts: [{ text: info.hash, color: "muted" }] });
  if (info.staged || info.unstaged || info.untracked) {
    const parts: Part[] = [];
    if (info.staged) parts.push({ text: STAGED, color: "success" });
    if (info.unstaged) parts.push({ text: UNSTAGED, color: "warning" });
    if (info.untracked) parts.push({ text: UNTRACKED, color: "muted" });
    list.push({ key: "dirty", parts });
  }
  if (info.mode) list.push({ key: "mode", parts: [{ text: info.mode, color: "warning" }] });
  if (info.behind || info.ahead) {
    const parts: Part[] = [];
    if (info.behind) parts.push({ text: `${info.behind}${BEHIND}`, color: "warning" });
    if (info.behind && info.ahead) parts.push({ text: " " });
    if (info.ahead) parts.push({ text: `${info.ahead}${AHEAD}`, color: "accent" });
    list.push({ key: "ab", parts });
  }
  if (info.stashes) list.push({ key: "stash", parts: [{ text: `${STASH_ICON}${info.stashes}`, color: "muted" }] });
  return list;
}

// Drops the least important segments, then truncates the branch, until it fits `budget`.
function fit(segments: Segment[], budget: number): Segment[] {
  let list = [...segments];
  for (const key of ["hash", "stash", "ab"] as const) {
    if (totalWidth(list) <= budget) break;
    list = list.filter((s) => s.key !== key);
  }
  if (totalWidth(list) <= budget) return list;
  const branch = list.find((s) => s.key === "branch")!;
  const others = totalWidth(list) - widthOf(branch);
  const room = Math.max(MIN_BRANCH_WIDTH, budget - others - visibleWidth(branch.parts[0].text));
  const chars = Array.from(branch.parts[1].text);
  branch.parts = [branch.parts[0], { text: chars.slice(0, Math.max(1, room - 1)).join("") + "…" }];
  return list;
}

// Parses `git status --porcelain` ("XY path": X = index, Y = working tree).
function parseWorkTree(out: string) {
  const wt = { staged: false, unstaged: false, untracked: false };
  for (const line of out.split("\n")) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") wt.untracked = true;
    else if (x === "!") continue; // ignored files
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) wt.unstaged = true; // conflict
    else {
      if (x !== " ") wt.staged = true;
      if (y !== " ") wt.unstaged = true;
    }
  }
  return wt;
}

function compactCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 100_000) return (n / 1_000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1_000) + "k";
  if (n < 10_000_000) return (n / 1_000_000).toFixed(1) + "M";
  return Math.round(n / 1_000_000) + "M";
}

const THINKING_COLOR: Record<string, string> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

const card: CardFactory = (config, env) => {
  const showGit = config.git !== false;
  let info: GitInfo | undefined;

  // What the footer showed, kept current from the events that change it.
  const start = env.session();
  let model = start.model;
  let provider = start.provider;
  let thinking = start.thinkingLevel;
  env.on("model_select", (e) => {
    provider = e?.model?.provider ?? provider;
    model = e?.model?.id ?? model;
    env.repaint();
  });
  env.on("thinking_level_select", (e) => {
    thinking = e?.level ?? thinking;
    env.repaint();
  });
  env.on("turn_end", () => env.repaint()); // the context grew

  const folder = () => {
    const home = homedir();
    return env.cwd === home ? "~" : env.cwd.startsWith(home + sep) ? "~" + env.cwd.slice(home.length) : env.cwd;
  };
  const modelName = () => (model ? (provider ? `${provider}/${model}` : model) : "no model");

  function contextLine(width: number, theme: Parameters<ReturnType<CardFactory>["render"]>[1]): string | undefined {
    const usage = env.session().context;
    if (!usage) return undefined;
    const tokens = usage.tokens === null ? "?" : compactCount(usage.tokens);
    const percent = usage.percent === null ? "?" : `${usage.percent.toFixed(1)}%`;
    const barWidth = Math.max(0, width - visibleWidth(tokens) - visibleWidth(percent) - 4); // "tokens [bar] percent"
    const p = usage.percent;
    const filled = p === null ? 0 : Math.min(barWidth, Math.floor((p / 100) * barWidth));
    const color = p !== null && p > ERROR_PERCENT ? "error" : p !== null && p > WARNING_PERCENT ? "warning" : "success";
    const bar = theme.fg(color as never, "█".repeat(filled)) + theme.fg("dim", "░".repeat(barWidth - filled));
    return `${theme.fg("success", tokens)} ${theme.fg("dim", "[")}${bar}${theme.fg("dim", "]")} ${theme.fg("success", percent)}`;
  }

  return {
    title: typeof config.title === "string" ? config.title : "Session",

    async refresh() {
      if (!showGit) return;
      const gitDir = (await env.git(["rev-parse", "--absolute-git-dir"]))?.trim();
      if (!gitDir) {
        info = undefined; // not a repository
        return;
      }
      const [branch, hash, counts, stashList, status] = await Promise.all([
        env.git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        env.git(["rev-parse", "--short", "HEAD"]),
        env.git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
        env.git(["stash", "list"]),
        env.git(["status", "--porcelain=v1", "--untracked-files=normal"], 4000), // scans the tree: it gets longer
      ]);
      const [ahead, behind] = (counts ?? "").trim().split(/\s+/).map((n) => parseInt(n, 10) || 0);
      const has = (name: string) => existsSync(join(gitDir, name));
      info = {
        branch: branch?.trim() || undefined,
        hash: hash?.trim() || undefined,
        ahead: ahead ?? 0,
        behind: behind ?? 0,
        stashes: stashList ? stashList.split("\n").filter(Boolean).length : 0,
        mode: has("BISECT_LOG") ? MODE.bisect : has("MERGE_HEAD") ? MODE.merge : has("rebase-merge") || has("rebase-apply") ? MODE.rebase : undefined,
        ...parseWorkTree(status ?? ""),
      };
    },

    render(width, theme) {
      const lines: string[] = [];
      lines.push(truncateToWidth(theme.bold(theme.fg("accent", modelName())), width, "…"));
      const level = thinking ? String(thinking) : undefined;
      if (level) {
        const color = THINKING_COLOR[level];
        const text = `${level.charAt(0).toUpperCase()}${level.slice(1)}`;
        lines.push(`${theme.fg("dim", "Thinking: ")}${color ? theme.fg(color as never, text) : text}`);
      }
      lines.push(theme.fg("dim", "Path: ") + truncateLeft(folder(), Math.max(4, width - 6)));
      const context = contextLine(width, theme);
      if (context) lines.push(context);
      if (info) {
        const segments = fit(buildSegments(info), width);
        lines.push(
          truncateToWidth(
            segments.map((s) => s.parts.map((p) => (p.color ? theme.fg(p.color as never, p.text) : p.text)).join("")).join(GAP),
            width,
            "…",
          ),
        );
      }
      return lines;
    },

    // Collapsed: the model and how full the context is.
    summary(theme) {
      const p = env.session().context?.percent;
      return theme.fg("muted", model ?? "no model") + (typeof p === "number" ? theme.fg("dim", ` · ${p.toFixed(0)}%`) : "");
    },
  };
};

export default card;
