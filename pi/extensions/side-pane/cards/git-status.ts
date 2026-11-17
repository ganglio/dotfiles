// Card: the files behind the session card's ✚ ● ? marks, with +added −removed line counts.
//
// Options (side-pane.json): maxFiles (1-30, default 8), stats (false = no line counts), title.

import { visibleWidth } from "@earendil-works/pi-tui";
import { STAGED, UNSTAGED, UNTRACKED, clampInt, inRepo, truncateLeft } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Working tree",
  description: "Conflicted (!), staged (✚), modified (●) and untracked (?) files. Collapsed: the branch and the marks with counts, or \"clean\".",
  needs: "a git repository",
};

interface FileEntry {
  path: string;
  add?: number; // lines added / removed, when git reports them (not for untracked or binary files)
  del?: number;
}
interface Tree {
  branch?: string; // undefined when HEAD is detached
  conflicts: FileEntry[];
  staged: FileEntry[];
  modified: FileEntry[];
  untracked: FileEntry[];
}

// `git status --porcelain=v1 -z`: records "XY path\0"; a rename or copy adds "origpath\0".
function parseStatus(out: string): Omit<Tree, "branch"> {
  const tree = { conflicts: [] as FileEntry[], staged: [] as FileEntry[], modified: [] as FileEntry[], untracked: [] as FileEntry[] };
  const records = out.split("\0");
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.length < 4) continue;
    const x = record[0];
    const y = record[1];
    const path = record.slice(3);
    if (x === "R" || x === "C" || y === "R" || y === "C") i++; // skip the original name
    if (x === "?" && y === "?") tree.untracked.push({ path });
    else if (x === "!") continue; // ignored
    else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) tree.conflicts.push({ path });
    else {
      if (x !== " ") tree.staged.push({ path });
      if (y !== " ") tree.modified.push({ path });
    }
  }
  return tree;
}

// `git diff --numstat -z`: "added\tremoved\tpath\0"; a rename is "added\tremoved\t\0old\0new\0".
function parseNumstat(out: string | undefined): Map<string, { add?: number; del?: number }> {
  const stats = new Map<string, { add?: number; del?: number }>();
  if (!out) return stats;
  const records = out.split("\0");
  for (let i = 0; i < records.length; i++) {
    const m = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[i]);
    if (!m) continue;
    let path = m[3];
    if (path === "") {
      path = records[i + 2] ?? "";
      i += 2;
    }
    stats.set(path, { add: m[1] === "-" ? undefined : Number(m[1]), del: m[2] === "-" ? undefined : Number(m[2]) });
  }
  return stats;
}

const card: CardFactory = (config, env) => {
  const maxFiles = clampInt(config.maxFiles, 8, 1, 30);
  const showStats = config.stats !== false;
  let repo: boolean | undefined;
  let tree: Tree | undefined;
  let failed = false;

  return {
    title: typeof config.title === "string" ? config.title : "Working tree",
    needs: "a git repository",
    available: () => repo === true,

    async refresh() {
      repo = await inRepo(env);
      if (!repo) {
        tree = undefined;
        return;
      }
      const [status, unstagedStat, stagedStat, branch] = await Promise.all([
        env.git(["status", "--porcelain=v1", "-z", "--untracked-files=normal"], 4000),
        showStats ? env.git(["diff", "--numstat", "-z"], 4000) : Promise.resolve(undefined),
        showStats ? env.git(["diff", "--cached", "--numstat", "-z"], 4000) : Promise.resolve(undefined),
        env.git(["symbolic-ref", "--quiet", "--short", "HEAD"]),
      ]);
      if (status === undefined) {
        failed = true; // timed out or failed: say so rather than show stale data
        return;
      }
      failed = false;
      const parsed = parseStatus(status);
      const unstaged = parseNumstat(unstagedStat);
      const staged = parseNumstat(stagedStat);
      for (const f of parsed.modified) Object.assign(f, unstaged.get(f.path));
      for (const f of parsed.staged) Object.assign(f, staged.get(f.path));
      tree = { branch: branch?.trim() || undefined, ...parsed };
    },

    render(width, theme, height) {
      if (failed || !tree) return [theme.fg("dim", "git status unavailable")];
      const rows: { marker: string; color: string; file: FileEntry }[] = [
        ...tree.conflicts.map((file) => ({ marker: "!", color: "error", file })),
        ...tree.staged.map((file) => ({ marker: STAGED, color: "success", file })),
        ...tree.modified.map((file) => ({ marker: UNSTAGED, color: "warning", file })),
        ...tree.untracked.map((file) => ({ marker: UNTRACKED, color: "muted", file })),
      ];
      if (rows.length === 0) return [theme.fg("success", "Working tree clean")];

      // With a height from the pane (fill, or a resized card) every file is returned: the pane scrolls.
      const limit = height === undefined ? maxFiles : rows.length;
      const lines = rows.slice(0, limit).map(({ marker, color, file }) => {
        const hasStat = file.add !== undefined && file.del !== undefined;
        const statPlain = hasStat ? `+${file.add} −${file.del}` : "";
        const statStyled = hasStat ? `${theme.fg("success", `+${file.add}`)} ${theme.fg("error", `−${file.del}`)}` : "";
        const room = Math.max(4, width - 2 - (hasStat ? visibleWidth(statPlain) + 1 : 0));
        const path = truncateLeft(file.path, room);
        const gap = " ".repeat(Math.max(1, width - 2 - visibleWidth(path) - visibleWidth(statPlain)));
        return `${theme.fg(color as never, marker)} ${path}${hasStat ? gap + statStyled : ""}`;
      });
      if (rows.length > limit) lines.push(theme.fg("dim", `… and ${rows.length - limit} more`));
      return lines;
    },

    // Collapsed: the branch and the same marks as the session card, with counts.
    summary(theme) {
      if (!tree) return undefined;
      const marks: string[] = [];
      if (tree.conflicts.length) marks.push(theme.fg("error", `!${tree.conflicts.length}`));
      if (tree.staged.length) marks.push(theme.fg("success", `${STAGED}${tree.staged.length}`));
      if (tree.modified.length) marks.push(theme.fg("warning", `${UNSTAGED}${tree.modified.length}`));
      if (tree.untracked.length) marks.push(theme.fg("muted", `${UNTRACKED}${tree.untracked.length}`));
      return `${tree.branch ?? "detached"} ${marks.length ? marks.join(" ") : theme.fg("success", "clean")}`;
    },
  };
};

export default card;
