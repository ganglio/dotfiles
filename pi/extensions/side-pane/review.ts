// The review model: comments on selections of a file, the prompt that hands them to the agent, and
// applying the agent's proposals. Pure logic, no pi imports, so it can be tested on its own.
//
// A comment's place in the file is a range of absolute offsets into the file's text, which is kept
// with "\n" line ends (the viewer converts CRLF in and out). Offsets make edits simple: replacing a
// range just shifts every offset after it.

export interface Proposal {
  replacement: string;
  note?: string;
  // pending: waiting for the user. kept: the user kept the original. applied: written to the file.
  state: "pending" | "kept" | "applied";
}

export interface Comment {
  id: number;
  start: number; // offsets into the text; end is exclusive
  end: number;
  text: string; // the selected text when the comment was made
  comment: string;
  sent: boolean; // already handed to the agent
  stale: boolean; // the text is no longer where it was, so the comment cannot be applied
  proposal?: Proposal;
}

// ---- positions ---------------------------------------------------------------------------------

// Offset of the first character of every line.
export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

// The line (0-based) and column (0-based, in characters) of an offset.
export function posOf(starts: number[], offset: number): { line: number; col: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, col: offset - starts[lo] };
}

// The offset of a line and column; a column past the end of the line is the end of the line.
export function offsetOf(text: string, starts: number[], line: number, col: number): number {
  const l = Math.max(0, Math.min(line, starts.length - 1));
  const lineEnd = l + 1 < starts.length ? starts[l + 1] - 1 : text.length;
  return Math.min(starts[l] + Math.max(0, col), lineEnd);
}

// "line 12" / "lines 12–15", then the columns, 1-based, for the agent and for the dialog.
export function describe(text: string, start: number, end: number): { lines: string; precise: string } {
  const starts = lineStarts(text);
  const a = posOf(starts, start);
  const b = posOf(starts, Math.max(start, end - 1)); // the last selected character
  const lines = a.line === b.line ? `line ${a.line + 1}` : `lines ${a.line + 1}–${b.line + 1}`;
  const precise = `line ${a.line + 1} column ${a.col + 1} to line ${b.line + 1} column ${b.col + 1}`;
  return { lines, precise };
}

// ---- the prompt for the agent --------------------------------------------------------------------

// A code fence long enough that nothing inside it can close it.
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((m) => m.length));
  return "`".repeat(longest + 1);
}

export function buildPrompt(file: { path: string; rel: string }, text: string, comments: Comment[]): string {
  const parts: string[] = [
    `Please work on my review comments for the file \`${file.rel}\` (absolute path: ${file.path}). Read the whole file first, for context.`,
    "",
    "Do NOT edit the file yourself. For each numbered comment below, call the `propose_edit` tool once, with the " +
      "replacement for exactly the selected text, applying my comment. For each comment I will choose between keeping " +
      "the original text and taking your proposal. If a comment needs no change, send the original text back as the " +
      "replacement and say why in `note`.",
  ];
  for (const c of comments) {
    const where = describe(text, c.start, c.end);
    const f = fence(c.text);
    parts.push(
      "",
      `## Comment ${c.id}: ${where.lines} (${where.precise})`,
      "Selected text:",
      f,
      c.text,
      f,
      `My comment: ${c.comment.trim()}`,
    );
  }
  return parts.join("\n");
}

// ---- applying and keeping the comments in place -----------------------------------------------

// Replaces the comment's range with the proposal, after checking that the text is still there.
export function applyProposal(content: string, c: Comment): { content: string; delta: number } | { error: string } {
  if (!c.proposal) return { error: "There is no proposal for this comment." };
  if (c.stale || content.slice(c.start, c.end) !== c.text) {
    return { error: "The selected text changed in the file since the comment was made, so the edit was not applied." };
  }
  const next = content.slice(0, c.start) + c.proposal.replacement + content.slice(c.end);
  return { content: next, delta: c.proposal.replacement.length - (c.end - c.start) };
}

// After the range [editStart, editEnd) was replaced by text `delta` characters longer or shorter,
// moves every other comment: those before it stay, those after it shift, those overlapping go stale.
export function shiftAfterEdit(comments: Comment[], exceptId: number, editStart: number, editEnd: number, delta: number): void {
  for (const c of comments) {
    if (c.id === exceptId) continue;
    if (c.end <= editStart) continue;
    if (c.start >= editEnd) {
      c.start += delta;
      c.end += delta;
    } else {
      c.stale = true;
    }
  }
}

// After the file was read again (it changed on disk): keep each comment on its text, looking for it
// nearby if it moved, and mark it stale when it is gone.
export function relocate(content: string, comments: Comment[]): void {
  for (const c of comments) {
    if (content.slice(c.start, c.end) === c.text) {
      c.stale = false;
      continue;
    }
    let best = -1;
    for (let i = content.indexOf(c.text); i >= 0 && c.text !== ""; i = content.indexOf(c.text, i + 1)) {
      if (best < 0 || Math.abs(i - c.start) < Math.abs(best - c.start)) best = i;
    }
    if (best >= 0) {
      c.start = best;
      c.end = best + c.text.length;
      c.stale = false;
    } else {
      c.stale = true;
    }
  }
}
