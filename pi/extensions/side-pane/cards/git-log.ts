// Card: the last commits of the repository pi runs in.
//
// Options (side-pane.json): count (1-10, default 3), messageLines (1-5, default 2),
// date ("relative" | "absolute", default "relative"), title.

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { clampInt, inRepo } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Recent commits",
  description: "Hash, date, author and an excerpt of the message of the last commits. Collapsed: the latest commit's hash and author.",
  needs: "a git repository",
};

interface Commit {
  hash: string;
  author: string;
  relative: string;
  absolute: string;
  message: string; // subject and body, whitespace collapsed
}

const card: CardFactory = (config, env) => {
  const count = clampInt(config.count, 3, 1, 10);
  const messageLines = clampInt(config.messageLines, 2, 1, 5);
  const absolute = config.date === "absolute";
  let repo: boolean | undefined; // undefined until the first refresh has finished
  let commits: Commit[] | undefined;
  let status = "No commits yet.";

  return {
    title: typeof config.title === "string" ? config.title : "Recent commits",
    needs: "a git repository",
    available: () => repo === true,

    async refresh() {
      repo = await inRepo(env);
      if (!repo) {
        commits = undefined;
        return;
      }
      // \x1f separates fields and \x1e ends a record, so commit messages cannot confuse the parser.
      const out = await env.git(["log", `-n${count}`, "--no-color", "--date=short", "--format=%h%x1f%an%x1f%cr%x1f%ad%x1f%s%x1f%b%x1e"]);
      if (out === undefined) {
        commits = undefined; // a repository without commits
        return;
      }
      commits = out
        .split("\x1e")
        .map((record) => record.replace(/^\n+/, ""))
        .filter((record) => record.trim() !== "")
        .map((record) => {
          const [hash, author, relative, abs, subject, body] = record.split("\x1f");
          return {
            hash,
            author,
            relative,
            absolute: abs,
            message: `${subject} ${body ?? ""}`.replace(/\s+/g, " ").trim(),
          };
        });
    },

    // Collapsed: the latest commit's hash and author.
    summary(theme) {
      const latest = commits?.[0];
      return latest ? `${theme.fg("muted", latest.hash)} ${latest.author}` : undefined;
    },

    render(width, theme) {
      if (!commits || commits.length === 0) return [theme.fg("dim", status)];
      const lines: string[] = [];
      commits.forEach((c, i) => {
        if (i > 0) lines.push("");
        // hash on the left, date on the right
        const date = absolute ? c.absolute : c.relative;
        const dateText = truncateToWidth(date, Math.max(0, width - visibleWidth(c.hash) - 1), "…");
        const gap = " ".repeat(Math.max(1, width - visibleWidth(c.hash) - visibleWidth(dateText)));
        lines.push(theme.fg("accent", c.hash) + gap + theme.fg("dim", dateText));
        lines.push(truncateToWidth(c.author, width, "…"));
        // an excerpt of the message: at most `messageLines` lines, the last one cut with "…"
        const wrapped = wrapTextWithAnsi(c.message, width);
        const shown = wrapped.slice(0, messageLines);
        if (wrapped.length > messageLines) {
          shown[messageLines - 1] = truncateToWidth(shown[messageLines - 1], Math.max(1, width - 1), "") + "…";
        }
        for (const line of shown) lines.push(theme.fg("muted", line));
      });
      return lines;
    },
  };
};

export default card;
