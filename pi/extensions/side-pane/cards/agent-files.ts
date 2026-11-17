// Card: the files the agent wrote or edited in this session, newest first.
//
// Options (side-pane.json): maxFiles (1-30, default 8), title.

import { visibleWidth } from "@earendil-works/pi-tui";
import { homedir } from "node:os";
import { basename, sep } from "node:path";
import { age, clampInt, truncateLeft } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Agent edits",
  description: "Files written or edited through the write and edit tools, with how often and how long ago. Rebuilt from the session, so it survives /reload.",
};

const card: CardFactory = (config, env) => {
  const maxFiles = clampInt(config.maxFiles, 8, 1, 30);
  const home = homedir();
  const shorten = (abs: string) =>
    abs.startsWith(env.cwd + sep) ? abs.slice(env.cwd.length + 1) : abs.startsWith(home + sep) ? "~" + abs.slice(home.length) : abs;
  const newestFirst = () => [...env.touched.entries()].sort((a, b) => b[1].at - a[1].at);

  return {
    title: typeof config.title === "string" ? config.title : "Agent edits",
    // No dependency: always shown, even when empty.
    async refresh() {},

    render(width, theme, height) {
      const rows = newestFirst();
      if (rows.length === 0) return [theme.fg("dim", "No edits yet.")];
      // With a height from the pane (fill, or a resized card) every file is returned: the pane scrolls.
      const limit = height === undefined ? maxFiles : rows.length;
      const lines = rows.slice(0, limit).map(([path, { count, at }]) => {
        const right = [count > 1 ? `×${count}` : "", age(at)].filter(Boolean).join(" ");
        const room = Math.max(4, width - (right ? visibleWidth(right) + 1 : 0));
        const text = truncateLeft(shorten(path), room);
        const gap = " ".repeat(Math.max(1, width - visibleWidth(text) - visibleWidth(right)));
        return right ? text + gap + theme.fg("dim", right) : text;
      });
      if (rows.length > limit) lines.push(theme.fg("dim", `… and ${rows.length - limit} more`));
      return lines;
    },

    // Collapsed: how many files and the most recent one.
    summary(theme) {
      const rows = newestFirst();
      if (rows.length === 0) return theme.fg("dim", "none yet");
      return `${rows.length} file${rows.length === 1 ? "" : "s"} · last: ${basename(rows[0][0])}`;
    },
  };
};

export default card;
