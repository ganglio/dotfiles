// Git status at the right-hand end of the footer's first row, modelled on the zsh prompt
// (ohmy.custom/themes/gagnoster.zsh-theme):
//
//     main  f477611  ✚●?  >M<  1⍅ 2⍆  3
//
//   branch icon + branch      or "➦ <hash>" when HEAD is detached
//   hash                      short commit hash
//   ✚ ● ?                     staged changes / modified tracked files / untracked files;
//                             each shows when present, so they can appear together
//   <B> / >M< / >R>           bisect / merge / rebase in progress
//   N⍅ / N⍆                   commits behind / ahead of the upstream (only with an upstream)
//   stash icon + N            number of stashes
//
// pi-jefferson (the footer) has no git instrument and does not render extension status text,
// so this draws a small non-focusable overlay over free space on the footer's first row.
//
// Fitting: the footer row's left side (model, thinking level, path) is estimated and the git
// text gets the columns that are left. When short of room it drops the hash, then the stash
// count, then the ahead/behind counts, then truncates the branch. If even that does not fit,
// or the terminal is too narrow, nothing is drawn rather than cover the path.
//
// Refreshes at start, after every agent turn, on model changes, and every POLL_MS, so
// commits made in another terminal show up too. It never fetches from a remote.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";

// Glyphs, as used by the prompt theme. Change them here.
const BRANCH_ICON = ""; // Nerd Font git branch
const STASH_ICON = "";
const BEHIND = "⍅"; // ⍅
const AHEAD = "⍆"; // ⍆
const DETACHED = "➦"; // ➦
const MODE = { bisect: "<B>", merge: ">M<", rebase: ">R>" } as const;
const STAGED = "✚"; // ✚ same as the prompt
const UNSTAGED = "●"; // ● same as the prompt
const UNTRACKED = "?"; // the prompt has none; "?" is what git status --short uses

const POLL_MS = 5000;
// 0 = the footer's last row, 1 = the row above it. Matches the 2-row pi-jefferson layout.
const ROWS_FROM_BOTTOM = 1;
const GAP = "  ";
const MAX_TEXT_WIDTH = 60;
const MIN_BRANCH_WIDTH = 8;

interface Part {
  text: string;
  color?: string; // a pi theme colour name; none = default text colour
}
interface Segment {
  key: "branch" | "hash" | "dirty" | "mode" | "ab" | "stash";
  parts: Part[];
}
interface WorkTree {
  staged: boolean; // changes added to the index, not yet committed
  unstaged: boolean; // tracked files modified (or in conflict) in the working tree
  untracked: boolean; // files git does not track yet
}
interface GitInfo {
  branch?: string; // undefined when detached
  hash?: string;
  behind: number;
  ahead: number;
  stashes: number;
  mode?: string;
  workTree?: WorkTree; // undefined when `git status` failed or timed out
}

const widthOf = (s: Segment) => s.parts.reduce((n, p) => n + visibleWidth(p.text), 0);
const totalWidth = (list: Segment[]) => list.reduce((n, s) => n + widthOf(s), 0) + GAP.length * Math.max(0, list.length - 1);

function buildSegments(info: GitInfo): Segment[] {
  const list: Segment[] = [];
  const name = info.branch ?? `${DETACHED} ${info.hash ?? "?"}`;
  list.push({ key: "branch", parts: [{ text: `${BRANCH_ICON} `, color: "accent" }, { text: name }] });
  if (info.branch && info.hash) list.push({ key: "hash", parts: [{ text: info.hash, color: "muted" }] });
  // Same order as the prompt: branch, working tree state, mode, then ahead/behind and stashes.
  const wt = info.workTree;
  if (wt && (wt.staged || wt.unstaged || wt.untracked)) {
    const parts: Part[] = [];
    if (wt.staged) parts.push({ text: STAGED, color: "success" });
    if (wt.unstaged) parts.push({ text: UNSTAGED, color: "warning" });
    if (wt.untracked) parts.push({ text: UNTRACKED, color: "muted" });
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
function fit(segments: Segment[], budget: number): Segment[] | undefined {
  let list = [...segments];
  for (const key of ["hash", "stash", "ab"] as const) {
    if (totalWidth(list) <= budget) break;
    list = list.filter((s) => s.key !== key);
  }
  if (totalWidth(list) <= budget) return list;

  const branch = list.find((s) => s.key === "branch")!;
  const others = totalWidth(list) - widthOf(branch);
  const iconWidth = visibleWidth(branch.parts[0].text);
  const room = budget - others - iconWidth;
  if (room < MIN_BRANCH_WIDTH) return undefined;
  const chars = Array.from(branch.parts[1].text);
  const cut = chars.slice(0, Math.max(1, room - 1)).join("") + "…";
  branch.parts = [branch.parts[0], { text: cut }];
  return list;
}

export default function (pi: ExtensionAPI) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let dispose: (() => void) | undefined;
  let refreshNow: (() => Promise<void>) | undefined;

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
    refreshNow = undefined;
    dispose?.();
    dispose = undefined;
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    stop(); // a reload starts a new session: never leave two overlays behind

    let shown: Segment[] = [];
    let mounted: { width: number; minTerminal: number } | undefined;
    let requestRender: (() => void) | undefined;
    let busy = false;

    // `raw` keeps the output untouched: `git status` lines start with a meaningful space.
    const git = async (args: string[], opts: { timeout?: number; raw?: boolean } = {}): Promise<string | undefined> => {
      try {
        const r = await pi.exec("git", ["--no-optional-locks", ...args], { cwd: ctx.cwd, timeout: opts.timeout ?? 2000 });
        return r.code === 0 ? (opts.raw ? r.stdout : r.stdout.trim()) : undefined;
      } catch {
        return undefined; // git missing or timed out
      }
    };

    // Parses `git status --porcelain` ("XY path": X = index, Y = working tree).
    function parseWorkTree(out: string | undefined): WorkTree | undefined {
      if (out === undefined) return undefined;
      const wt: WorkTree = { staged: false, unstaged: false, untracked: false };
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

    async function readInfo(): Promise<GitInfo | undefined> {
      const gitDir = await git(["rev-parse", "--absolute-git-dir"]);
      if (!gitDir) return undefined; // not a repository
      const [branch, hash, counts, stashList, status] = await Promise.all([
        git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
        git(["rev-parse", "--short", "HEAD"]),
        git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
        git(["stash", "list"]),
        // Scans the working tree, so it gets longer than the others on big repositories.
        git(["status", "--porcelain=v1", "--untracked-files=normal"], { timeout: 4000, raw: true }),
      ]);
      const [ahead, behind] = (counts ?? "").split(/\s+/).map((n) => parseInt(n, 10) || 0);
      const has = (name: string) => existsSync(join(gitDir, name));
      const mode = has("BISECT_LOG")
        ? MODE.bisect
        : has("MERGE_HEAD")
          ? MODE.merge
          : has("rebase-merge") || has("rebase-apply")
            ? MODE.rebase
            : undefined;
      return {
        branch: branch || undefined,
        hash: hash || undefined,
        ahead: ahead ?? 0,
        behind: behind ?? 0,
        stashes: stashList ? stashList.split("\n").filter(Boolean).length : 0,
        mode,
        workTree: parseWorkTree(status),
      };
    }

    // Estimated width of the footer's first row: "<provider>/<model> Thinking: <Level> Path: <dir>".
    function leftWidth(): number {
      const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
      const level = String(ctx.thinkingLevel ?? "");
      const thinking = `Thinking: ${level.charAt(0).toUpperCase()}${level.slice(1)}`;
      return [model, thinking, `Path: ${basename(ctx.cwd)}`].join(" ").length;
    }

    function unmount() {
      dispose?.();
      dispose = undefined;
      mounted = undefined;
      shown = [];
    }

    // pi reads the overlay options once, so a different width means a new overlay.
    function mount(width: number, minTerminal: number) {
      // Only drop the old overlay: `shown` was just set by the caller and must survive.
      dispose?.();
      dispose = undefined;
      mounted = { width, minTerminal };
      // Not awaited: the promise only resolves when the overlay is disposed.
      void ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          requestRender = () => tui.requestRender();
          dispose = () => done();
          return {
            render: (w: number) => {
              if (shown.length === 0) return [""];
              const styled = shown
                .map((s) => s.parts.map((p) => (p.color ? theme.fg(p.color as never, p.text) : p.text)).join(""))
                .join(GAP);
              // Right-aligned inside the fixed width; the padding blanks the free space it covers.
              return [" ".repeat(Math.max(0, w - totalWidth(shown) - 1)) + styled + " "];
            },
            invalidate() {},
          };
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: "bottom-right",
            offsetY: -ROWS_FROM_BOTTOM,
            width,
            visible: (termWidth: number) => termWidth >= (mounted?.minTerminal ?? Infinity),
            nonCapturing: true,
          },
        },
      );
    }

    refreshNow = async () => {
      if (busy) return;
      busy = true;
      try {
        const info = await readInfo();
        if (!info) return unmount();

        const columns = process.stdout.columns || 120;
        const left = leftWidth();
        const budget = Math.min(MAX_TEXT_WIDTH, columns - left - 3 - 2);
        const fitted = fit(buildSegments(info), budget);
        if (!fitted) return unmount();

        const width = totalWidth(fitted) + 2; // one trailing space plus one column of slack for wide glyphs
        const minTerminal = left + 3 + width;
        shown = fitted;
        if (!mounted || mounted.width !== width) mount(width, minTerminal);
        else {
          mounted.minTerminal = minTerminal;
          requestRender?.();
        }
      } finally {
        busy = false;
      }
    };

    void refreshNow();
    timer = setInterval(() => void refreshNow?.(), POLL_MS);
  });

  pi.on("agent_end", () => void refreshNow?.());
  pi.on("model_select", () => void refreshNow?.());
  pi.on("session_shutdown", () => stop());
}
