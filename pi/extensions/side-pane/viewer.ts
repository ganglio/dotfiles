// The file viewer: shows a file in the main area, lets you select text and comment on it, hands the
// comments to the agent, and shows the agent's proposals so you can keep the original or take the
// edit. It is read-only: the file is only written when you click "Use edit".
//
//   ┌ title    src/app.ts · 120 lines
//   │ content  12 ● │ const x = 1;       ← drag to select, then comment on the selection
//   │          13   │ ┌ proposal for comment 1 ─────────
//   │          ...    │ - const x = 1;
//   │                 │ + const x = 2;
//   │                 └ [ Keep original ] [ Use edit ]
//   └ bar      1 comment · 1 to send            [ Send 1 ] [ ▲ Chat ] [ ✕ Close ]
//
// Layout and wiring live in index.ts; the model (ranges, the prompt, applying edits) in review.ts.

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { ScrollView, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { ruleLine } from "./frame";
import type { Comment } from "./review";
import { applyProposal, buildPrompt, describe, lineStarts, posOf, relocate, shiftAfterEdit } from "./review";

// A scroll view that uses up every wheel movement it is given. Pi hands what a scroll view could
// not use (at the top or the bottom) to the chat, even for a view that does not chain: this keeps
// the wheel from scrolling the chat when the file has reached its end.
class ContainedScrollView extends ScrollView {
  scrollBy(lines: number): number {
    super.scrollBy(lines);
    return 0;
  }
}

// What the viewer needs from the extension.
export interface ViewerHost {
  theme(): Theme;
  requestRender(): void;
  chatLarge(): boolean;
  toggleChat(): void;
  close(): void;
  notify(message: string, level: "info" | "warning" | "error"): void;
  // A dialog asking for a comment; resolves to the text, or undefined when cancelled.
  askComment(title: string, initial?: string): Promise<string | undefined>;
  // A dialog to pick one of `options`; resolves to the choice, or undefined when cancelled.
  choose(title: string, options: string[]): Promise<string | undefined>;
  // Hands a message to the agent.
  send(text: string): void;
}

const TAB = 4;
const MAX_BYTES = 2_000_000;
const MAX_PROPOSAL_ROWS = 12;

// One cell of a displayed line: a character (or a tab, which spans several columns).
interface Cell {
  text: string; // what is drawn
  w: number; // columns
  idx: number; // index of the character in the line
  len: number; // characters it stands for (2 for a character outside the basic plane)
}

// A row of the content: a source line, or a part of a proposal block shown under a line.
type Row =
  | { kind: "line"; line: number }
  | { kind: "proposal"; id: number; part: "top" | "orig" | "new" | "note" | "buttons"; text: string };

const INVERSE = ["\x1b[7m", "\x1b[27m"];
const UNDERLINE = ["\x1b[4m", "\x1b[24m"];

export function createViewer(host: ViewerHost, cwd: string) {
  // ---- the model -----------------------------------------------------------------------------
  let path = "";
  let rel = "";
  let text = ""; // the file, with "\n" line ends
  let eol = "\n";
  let lines: string[] = [];
  let starts: number[] = [0];
  let mtime = 0;
  let error: string | undefined;
  const comments: Comment[] = [];
  let nextId = 1;
  let anchor: number | undefined; // selection, as offsets into `text`
  let head: number | undefined;
  let rows: Row[] = [];
  let cells: (Cell[] | undefined)[] = [];
  let scrollView: ScrollView | undefined;

  const theme = () => host.theme();
  const isOpen = () => path !== "";

  function load(p: string): boolean {
    try {
      const st = statSync(p);
      if (st.size > MAX_BYTES) throw new Error(`the file is larger than ${MAX_BYTES / 1_000_000} MB`);
      const raw = readFileSync(p, "utf8");
      if (raw.includes("\0")) throw new Error("this looks like a binary file");
      eol = raw.includes("\r\n") ? "\r\n" : "\n";
      text = eol === "\r\n" ? raw.replace(/\r\n/g, "\n") : raw;
      lines = text.split("\n");
      starts = lineStarts(text);
      cells = [];
      mtime = st.mtimeMs;
      error = undefined;
      return true;
    } catch (e) {
      error = `Cannot show this file: ${e instanceof Error ? e.message : String(e)}`;
      text = "";
      lines = [];
      starts = [0];
      cells = [];
      return false;
    }
  }

  function open(p: string) {
    if (p === path) return;
    path = p;
    rel = relative(cwd, p) || p;
    comments.length = 0;
    nextId = 1;
    anchor = head = undefined;
    load(p);
    scrollView?.scrollToStart();
  }

  function close() {
    path = "";
    rel = "";
    comments.length = 0;
    anchor = head = undefined;
    text = "";
    lines = [];
  }

  // The file may have changed on disk (the agent, an editor): read it again and keep the comments on their text.
  function reload(force = false) {
    if (!isOpen()) return;
    let m = 0;
    try {
      m = statSync(path).mtimeMs;
    } catch {
      return;
    }
    if (!force && m === mtime) return;
    const before = text;
    if (!load(path)) return;
    if (text !== before) relocate(text, comments);
    host.requestRender();
  }

  // ---- selection and comments ----------------------------------------------------------------

  const selection = () => (anchor === undefined || head === undefined || anchor === head ? undefined : { start: Math.min(anchor, head), end: Math.max(anchor, head) });

  async function finishSelection() {
    const sel = selection();
    if (!sel) return;
    const where = describe(text, sel.start, sel.end);
    const comment = await host.askComment(`Comment on ${where.lines} (esc cancels)`);
    anchor = head = undefined;
    if (comment && comment.trim() !== "") {
      comments.push({ id: nextId++, start: sel.start, end: sel.end, text: text.slice(sel.start, sel.end), comment: comment.trim(), sent: false, stale: false });
    }
    host.requestRender();
  }

  const drafts = () => comments.filter((c) => !c.sent && !c.stale);
  const pending = () => comments.filter((c) => c.proposal?.state === "pending");

  function sendReview() {
    const todo = drafts();
    if (todo.length === 0) return host.notify("There are no new comments to send.", "info");
    for (const c of todo) c.sent = true;
    host.send(buildPrompt({ path, rel }, text, todo));
    host.requestRender();
  }

  // The agent's answer for one comment (the propose_edit tool). Returns the text for the tool result.
  function propose(id: number, replacement: string, note?: string): string {
    const c = comments.find((x) => x.id === id);
    if (!isOpen()) return "No file is open in the viewer, so there is nothing to propose an edit for.";
    if (!c) return `There is no comment ${id} in the open review.`;
    c.proposal = { replacement, note, state: "pending" };
    host.requestRender();
    return `Proposal for comment ${id} recorded. The user decides whether to keep the original or use your edit; the file has not been changed.`;
  }

  function keep(id: number) {
    const c = comments.find((x) => x.id === id);
    if (c?.proposal) c.proposal.state = "kept";
    host.requestRender();
  }

  function useEdit(id: number) {
    const c = comments.find((x) => x.id === id);
    if (!c?.proposal) return;
    reload(); // work on what is on disk now
    const result = applyProposal(text, c);
    if ("error" in result) {
      c.stale = true;
      host.notify(result.error, "warning");
      host.requestRender();
      return;
    }
    try {
      writeFileSync(path, eol === "\r\n" ? result.content.replace(/\n/g, "\r\n") : result.content);
    } catch (e) {
      host.notify(`Could not write the file: ${e instanceof Error ? e.message : String(e)}`, "error");
      return;
    }
    const editStart = c.start;
    const editEnd = c.end;
    shiftAfterEdit(comments, id, editStart, editEnd, result.delta);
    text = result.content;
    lines = text.split("\n");
    starts = lineStarts(text);
    cells = [];
    try {
      mtime = statSync(path).mtimeMs;
    } catch {
      // the next reload will notice
    }
    // The comment now stands on the new text.
    c.text = c.proposal.replacement;
    c.end = c.start + c.text.length;
    c.proposal.state = "applied";
    host.requestRender();
  }

  async function commentMenu(id: number) {
    const c = comments.find((x) => x.id === id);
    if (!c) return;
    const choice = await host.choose(`Comment ${c.id}: ${c.comment.slice(0, 60)}`, ["Edit comment", "Delete comment"]);
    if (choice === "Delete comment") comments.splice(comments.indexOf(c), 1);
    else if (choice === "Edit comment") {
      const next = await host.askComment(`Comment ${c.id}`, c.comment);
      if (next && next.trim() !== "") {
        c.comment = next.trim();
        c.sent = false; // changed after it was sent: it can be sent again
      }
    }
    host.requestRender();
  }

  function jumpToProposal() {
    const target = pending()[0];
    if (!target) return;
    const i = rows.findIndex((r) => r.kind === "proposal" && r.id === target.id && r.part === "top");
    if (i >= 0) scrollView?.scrollTo(Math.max(0, i - 2));
    host.requestRender();
  }

  // ---- drawing the content ---------------------------------------------------------------------

  // The cells of a line, cached: tabs become spaces up to the next tab stop.
  function cellsOf(i: number): Cell[] {
    const cached = cells[i];
    if (cached) return cached;
    const line = lines[i] ?? "";
    const out: Cell[] = [];
    let col = 0;
    for (let k = 0; k < line.length; ) {
      const cp = line.codePointAt(k)!;
      const len = cp > 0xffff ? 2 : 1;
      if (line[k] === "\t") {
        const w = TAB - (col % TAB);
        out.push({ text: " ".repeat(w), w, idx: k, len });
        col += w;
      } else {
        const ch = String.fromCodePoint(cp);
        const w = visibleWidth(ch);
        out.push({ text: ch, w, idx: k, len });
        col += w;
      }
      k += len;
    }
    return (cells[i] = out);
  }

  const gutterWidth = () => String(Math.max(1, lines.length)).length + 4; // "  12 ● │ "

  // The comments whose text touches line i.
  const commentsOnLine = (i: number) => {
    const lineEnd = starts[i] + (lines[i]?.length ?? 0);
    return comments.filter((c) => c.start <= lineEnd && c.end > starts[i]);
  };

  function markerFor(i: number): string {
    const t = theme();
    const here = commentsOnLine(i);
    if (here.length === 0) return " ";
    const c = here[0];
    if (c.stale) return t.fg("warning", "!");
    if (c.proposal?.state === "applied") return t.fg("success", "✓");
    return t.fg("accent", "●");
  }

  // One source line: the gutter, then the text, with the selection reversed and commented text underlined.
  function lineRow(i: number, width: number): string {
    const t = theme();
    const numW = String(Math.max(1, lines.length)).length;
    const gutter = t.fg("dim", String(i + 1).padStart(numW)) + " " + markerFor(i) + t.fg("border", "│") + " ";
    const textW = Math.max(1, width - (numW + 4));
    const cs = cellsOf(i);
    const ls = starts[i];
    const sel = selection();
    const spans = comments.filter((c) => c.end > ls && c.start < ls + (lines[i]?.length ?? 0) + 1 && !c.stale && c.proposal?.state !== "applied");

    const total = cs.reduce((n, c) => n + c.w, 0);
    const limit = total <= textW ? textW : textW - 1;
    let out = "";
    let acc = 0;
    let cut = false;
    for (const cell of cs) {
      if (acc + cell.w > limit) {
        cut = true;
        break;
      }
      const off = ls + cell.idx;
      let s = cell.text;
      if (spans.some((c) => off >= c.start && off < c.end)) s = UNDERLINE[0] + s + UNDERLINE[1];
      if (sel && off >= sel.start && off < sel.end) s = INVERSE[0] + s + INVERSE[1];
      out += s;
      acc += cell.w;
    }
    // A selection that runs over the end of the line shows as a reversed space.
    const lineEnd = ls + (lines[i]?.length ?? 0);
    if (!cut && sel && lineEnd >= sel.start && lineEnd < sel.end && acc < textW) out += INVERSE[0] + " " + INVERSE[1];
    if (cut) out += "…";
    return gutter + out;
  }

  // The block that shows a pending proposal under the last line of its comment.
  function proposalRows(c: Comment): Row[] {
    const p = c.proposal!;
    const out: Row[] = [];
    const top = ` proposal for comment ${c.id}${p.note ? ` · ${p.note}` : ""} `;
    out.push({ kind: "proposal", id: c.id, part: "top", text: top });
    const side = (src: string, kind: "orig" | "new") => {
      const ls = src.split("\n");
      ls.slice(0, MAX_PROPOSAL_ROWS).forEach((l) => out.push({ kind: "proposal", id: c.id, part: kind, text: l }));
      if (ls.length > MAX_PROPOSAL_ROWS) out.push({ kind: "proposal", id: c.id, part: kind, text: `… ${ls.length - MAX_PROPOSAL_ROWS} more lines` });
    };
    side(c.text, "orig");
    side(p.replacement, "new");
    out.push({ kind: "proposal", id: c.id, part: "buttons", text: "" });
    return out;
  }

  let buttonHits = new Map<number, { keep?: [number, number]; use?: [number, number]; dismiss?: [number, number] }>(); // by row

  function proposalText(row: Extract<Row, { kind: "proposal" }>, rowIndex: number, width: number): string {
    const t = theme();
    const indent = " ".repeat(gutterWidth());
    const room = Math.max(1, width - gutterWidth() - 2);
    const c = comments.find((x) => x.id === row.id);
    switch (row.part) {
      case "top":
        return indent + t.fg("accent", "┌" + row.text + "─".repeat(Math.max(0, room - visibleWidth(row.text) + 1)));
      case "orig":
        return indent + t.fg("accent", "│ ") + t.fg("error", truncateToWidth("- " + row.text.replace(/\t/g, "    "), room, "…"));
      case "new":
        return indent + t.fg("accent", "│ ") + t.fg("success", truncateToWidth("+ " + row.text.replace(/\t/g, "    "), room, "…"));
      case "note":
        return indent + t.fg("accent", "│ ") + t.fg("dim", truncateToWidth(row.text, room, "…"));
      case "buttons": {
        const stale = !c || c.stale;
        const a = stale ? "[ Dismiss ]" : "[ Keep original ]";
        const b = stale ? "" : "[ Use edit ]";
        const x0 = gutterWidth() + 2;
        const hit: { keep?: [number, number]; use?: [number, number]; dismiss?: [number, number] } = {};
        if (stale) hit.dismiss = [x0, x0 + visibleWidth(a) - 1];
        else {
          hit.keep = [x0, x0 + visibleWidth(a) - 1];
          hit.use = [x0 + visibleWidth(a) + 2, x0 + visibleWidth(a) + 1 + visibleWidth(b)];
        }
        buttonHits.set(rowIndex, hit);
        const note = stale ? t.fg("warning", "  the text changed in the file") : "";
        return indent + t.fg("accent", "└ ") + t.bold(t.fg("muted", a)) + (b ? "  " + t.bold(t.fg("success", b)) : "") + note;
      }
    }
  }

  const contentView: Component = {
    render(width: number): string[] {
      const t = theme();
      if (error) return [t.fg("error", " " + error)];
      if (!isOpen()) return [t.fg("dim", " No file open.")];
      buttonHits = new Map();
      // Rows: every line, and under the last line of a comment its pending proposal.
      rows = [];
      const blocks = new Map<number, Comment[]>();
      for (const c of pending()) {
        const line = posOf(starts, Math.max(c.start, c.end - 1)).line;
        blocks.set(line, [...(blocks.get(line) ?? []), c]);
      }
      for (let i = 0; i < lines.length; i++) {
        rows.push({ kind: "line", line: i });
        for (const c of blocks.get(i) ?? []) rows.push(...proposalRows(c));
      }
      return rows.map((row, idx) => (row.kind === "line" ? lineRow(row.line, width) : proposalText(row, idx, width)));
    },

    handleMouse(event: { type: string; button: string; x: number; y: number }) {
      const row = rows[event.y];
      if (!row || error) return undefined;
      const x0 = gutterWidth();

      if (row.kind === "proposal") {
        if (event.type !== "click" || event.button !== "left" || row.part !== "buttons") return undefined;
        const hit = buttonHits.get(event.y);
        const within = (r?: [number, number]) => !!r && event.x >= r[0] && event.x <= r[1];
        if (within(hit?.keep) || within(hit?.dismiss)) keep(row.id);
        else if (within(hit?.use)) useEdit(row.id);
        else return undefined;
        return { handled: true, render: true };
      }

      // The character under the pointer: offsets into the text. In the gutter that is the start of the line.
      const offsetAt = (): number => {
        const cs = cellsOf(row.line);
        const col = event.x - x0;
        if (col < 0) return starts[row.line];
        let acc = 0;
        for (const cell of cs) {
          if (col < acc + cell.w) return starts[row.line] + cell.idx;
          acc += cell.w;
        }
        return starts[row.line] + (lines[row.line]?.length ?? 0);
      };

      if (event.button !== "left") return undefined;
      if (event.type === "press") {
        // A press on the comment marker is a click on it, not the start of a selection.
        if (event.x >= x0 - 3 && event.x < x0 - 2 && markerFor(row.line) !== " ") return undefined;
        anchor = head = offsetAt();
        return { handled: true, capture: true, render: true };
      }
      if (event.type === "drag" && anchor !== undefined) {
        head = offsetAt();
        return { handled: true, render: true };
      }
      if (event.type === "release" && anchor !== undefined) {
        head = offsetAt();
        if (selection()) void finishSelection();
        else anchor = head = undefined;
        return { handled: true, render: true };
      }
      if (event.type === "click" && event.x >= x0 - 3 && event.x < x0 - 2) {
        const c = commentsOnLine(row.line)[0];
        if (c) {
          void commentMenu(c.id);
          return { handled: true, render: true };
        }
      }
      return undefined;
    },

    invalidate() {},
  } as Component;

  scrollView = new ContainedScrollView(contentView, {
    scrollbar: "always",
    scrollbarTrackStyle: (s) => theme().fg("border", s),
    scrollbarThumbStyle: (s) => theme().fg("muted", s),
  });

  // ---- the title and the bar --------------------------------------------------------------------

  const titleBar: Component = {
    render(width: number): string[] {
      const t = theme();
      if (!isOpen()) return [""];
      const info = error ? "" : t.fg("dim", ` · ${lines.length} line${lines.length === 1 ? "" : "s"}`);
      const stale = comments.some((c) => c.stale) ? t.fg("warning", " · some comments no longer match the file") : "";
      return [ruleLine(t, width, t.fg("border", "─") + " " + t.bold(t.fg("accent", rel)) + info + stale + " ")];
    },
    invalidate() {},
  };

  let barHits: { send?: [number, number]; chat?: [number, number]; close?: [number, number]; status?: [number, number] } = {};
  const bar: Component = {
    render(width: number): string[] {
      const t = theme();
      barHits = {};
      const toSend = drafts().length;
      const toReview = pending().length;
      const parts: string[] = [];
      if (comments.length === 0) parts.push("Drag over text to select it, then add a comment");
      else {
        parts.push(`${comments.length} comment${comments.length === 1 ? "" : "s"}`);
        if (toSend > 0) parts.push(`${toSend} to send`);
        if (toReview > 0) parts.push(`${toReview} proposal${toReview === 1 ? "" : "s"} to review (click here)`);
      }
      const status = " " + parts.join(" · ");
      const buttons: { key: "send" | "chat" | "close"; label: string; style: (s: string) => string }[] = [];
      if (toSend > 0) buttons.push({ key: "send", label: `[ Send ${toSend} ]`, style: (s) => t.bold(t.fg("accent", s)) });
      buttons.push({ key: "chat", label: host.chatLarge() ? "[ ▼ Chat ]" : "[ ▲ Chat ]", style: (s) => t.fg("muted", s) });
      buttons.push({ key: "close", label: "[ ✕ Close ]", style: (s) => t.fg("muted", s) });
      const rightW = buttons.reduce((n, b) => n + visibleWidth(b.label) + 1, 0);
      // The bar is the bottom edge of the viewer's box: a rule leads into the status, and the space
      // between status and buttons is rule too.
      const lead = 1;
      const statusText = truncateToWidth(status, Math.max(0, width - rightW - lead - 1), "…");
      const statusW = visibleWidth(statusText);
      let x = Math.max(lead + statusW + 1, width - rightW);
      let line =
        t.fg("border", "─".repeat(lead)) +
        t.fg(toReview > 0 ? "warning" : "dim", statusText) +
        " " +
        t.fg("border", "─".repeat(Math.max(0, x - lead - statusW - 1)));
      if (toReview > 0) barHits.status = [lead, lead + statusW];
      for (const b of buttons) {
        barHits[b.key] = [x, x + visibleWidth(b.label) - 1];
        line += b.style(b.label) + " ";
        x += visibleWidth(b.label) + 1;
      }
      return [truncateToWidth(line, width, "", true)];
    },
    handleMouse(event: { type: string; button: string; x: number }) {
      if (event.type !== "click" || event.button !== "left") return undefined;
      const within = (r?: [number, number]) => !!r && event.x >= r[0] && event.x <= r[1];
      if (within(barHits.send)) sendReview();
      else if (within(barHits.chat)) host.toggleChat();
      else if (within(barHits.close)) host.close();
      else if (within(barHits.status)) jumpToProposal();
      else return undefined;
      return { handled: true, render: true };
    },
    invalidate() {},
  } as Component;

  return {
    title: titleBar,
    scroll: scrollView,
    bar,
    open,
    close,
    reload,
    propose,
    sendReview,
    isOpen,
    path: () => path,
    comments: () => comments,
  };
}

export type Viewer = ReturnType<typeof createViewer>;
