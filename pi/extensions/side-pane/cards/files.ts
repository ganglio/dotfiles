// Card: a file browser. Click a folder to open or close it, click a file to open it in the file
// viewer, which splits the main area (see viewer.ts). The wheel scrolls the tree.
//
// The files come from `git ls-files` (tracked and untracked, ignored files left out) and, outside a
// repository, from a walk of the working directory.
//
// Options (side-pane.json): maxRows (4-80, default 14: how many rows to show unless the card has
// "fill", which gives it the free rows of the pane), title.

import { truncateToWidth } from "@earendil-works/pi-tui";
import { readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { homedir } from "node:os";
import { clampInt, truncateLeft } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Files",
  description:
    "The files of the working directory as a tree. Click a file to open it in the viewer. Options: maxRows (default 14); give the card \"fill\" to let it use the free rows of the pane.",
};

const MAX_FILES = 20000;
const SKIP = new Set([".git", "node_modules", "__pycache__", ".DS_Store"]);

interface Row {
  depth: number;
  name: string;
  path: string; // relative to the working directory, "/"-separated
  dir: boolean;
}

// Outside a repository: every file below `dir`, relative, to a depth that keeps it fast.
function walk(dir: string, rel = "", depth = 0, out: string[] = []): string[] {
  if (depth > 8 || out.length >= MAX_FILES) return out;
  let entries;
  try {
    entries = readdirSync(join(dir, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(dir, path, depth + 1, out);
    else out.push(path);
  }
  return out;
}

// The visible rows: folders first, then files, each alphabetical; only the open folders' contents.
function flatten(paths: string[], expanded: Set<string>): Row[] {
  interface Node {
    name: string;
    path: string;
    dir: boolean;
    children: Map<string, Node>;
  }
  const root: Node = { name: "", path: "", dir: true, children: new Map() };
  for (const p of paths) {
    let node = root;
    const parts = p.split("/");
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path, dir: i < parts.length - 1, children: new Map() };
        node.children.set(part, child);
      }
      node = child;
    });
  }
  const rows: Row[] = [];
  const visit = (node: Node, depth: number) => {
    const kids = [...node.children.values()].sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    for (const k of kids) {
      rows.push({ depth, name: k.name, path: k.path, dir: k.dir });
      if (k.dir && expanded.has(k.path)) visit(k, depth + 1);
    }
  };
  visit(root, 0);
  return rows;
}

const card: CardFactory = (config, env) => {
  const maxRows = clampInt(config.maxRows, 14, 4, 80);
  const expanded = new Set<string>(); // open folders, relative paths
  let paths: string[] = [];
  let rows: Row[] = [];
  let ready = false;
  let scroll = 0;
  let windowRows = maxRows; // how many tree rows the last render showed, for the mouse
  let revealed: string | undefined; // the open file whose folders were last opened

  const abs = (rel: string) => join(env.cwd, ...rel.split("/"));
  const rel = (path: string) => (path.startsWith(env.cwd + sep) ? path.slice(env.cwd.length + 1).split(sep).join("/") : undefined);

  // The file the viewer shows should be visible: open its folders, once per file.
  function reveal() {
    const open = env.openedFile();
    if (open === revealed) return;
    revealed = open;
    const r = open ? rel(open) : undefined;
    if (!r) return;
    const parts = r.split("/").slice(0, -1);
    parts.forEach((_, i) => expanded.add(parts.slice(0, i + 1).join("/")));
    rows = flatten(paths, expanded);
  }

  return {
    title: typeof config.title === "string" ? config.title : "Files",
    available: () => ready,

    async refresh() {
      const out = await env.git(["ls-files", "-co", "--exclude-standard", "-z"], 5000);
      const next = (out !== undefined ? out.split("\0").filter(Boolean) : walk(env.cwd)).slice(0, MAX_FILES);
      if (next.length !== paths.length || next.some((p, i) => p !== paths[i])) {
        paths = next;
        rows = flatten(paths, expanded);
      }
      ready = true;
    },

    render(width, theme, height) {
      reveal();
      if (rows.length === 0) return [theme.fg("dim", "No files.")];
      const limit = Math.max(3, height ?? maxRows);
      const scrollable = rows.length > limit;
      windowRows = scrollable ? limit - 1 : rows.length; // the last row of a scrolling tree is its position
      scroll = Math.max(0, Math.min(scroll, rows.length - windowRows));

      const open = env.openedFile();
      const lines = rows.slice(scroll, scroll + windowRows).map((row) => {
        const indent = "  ".repeat(row.depth);
        if (row.dir) return truncateToWidth(`${indent}${theme.fg("accent", `${expanded.has(row.path) ? "▾" : "▸"} ${row.name}/`)}`, width, "…");
        const current = open !== undefined && abs(row.path) === open;
        const name = current ? theme.bold(theme.fg("accent", row.name)) : row.name;
        return truncateToWidth(`${indent}  ${name}`, width, "…");
      });
      if (scrollable) lines.push(theme.fg("dim", `${scroll + 1}–${scroll + windowRows} of ${rows.length}`));
      return lines;
    },

    handleMouse(event) {
      if (event.type === "wheel") {
        const delta = Math.round(event.wheelDelta ?? 0);
        const next = Math.max(0, Math.min(Math.max(0, rows.length - windowRows), scroll + delta));
        if (delta === 0 || rows.length <= windowRows || next === scroll) return undefined; // let the pane scroll
        scroll = next;
        return { handled: true };
      }
      if (event.type !== "click" || event.button !== "left") return undefined;
      const row = rows[scroll + event.y];
      if (!row || event.y >= windowRows) return undefined;
      if (row.dir) {
        if (expanded.has(row.path)) expanded.delete(row.path);
        else expanded.add(row.path);
        rows = flatten(paths, expanded);
      } else {
        env.openFile(abs(row.path));
      }
      return { handled: true };
    },

    // The folder being browsed, with the home directory as ~ and the end kept when it is too long.
    subtitle(theme, room) {
      const home = homedir();
      const shown = env.cwd === home ? "~" : env.cwd.startsWith(home + sep) ? "~" + env.cwd.slice(home.length) : env.cwd;
      return theme.fg("muted", truncateLeft(shown, room));
    },

    summary: (theme) => theme.fg("dim", `${paths.length} files`),
  };
};

export default card;
