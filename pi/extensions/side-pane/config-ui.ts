// The card editor (/pane config): a small modal to switch cards on and off and to reorder them.
//
//   ╭─ Side pane · cards ─────────────────────────╮
//   │ › [x] Recent commits         git-log   ▲ ▼  │
//   │   [x] Working tree           git-status ▲ ▼  │
//   │   [ ] Ollama                 ollama    ▲ ▼  │
//   │ ─────────────────────────────────────────── │
//   │ Hash, date, author and an excerpt of ...    │
//   │ needs: a git repository                     │
//   │                                             │
//   │ ↑↓ select · space on/off · shift+↑↓ move    │
//   │ enter save · esc cancel                     │
//   ╰─────────────────────────────────────────────╯
//
// The editor changes `rows` in place and calls onChange after every change, so the pane behind
// it shows the result live. Mouse: click a row to select it, its [x] to switch it, ▲ ▼ to move it.

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { CardConfig } from "./types";

export interface EditorRow {
  cfg: CardConfig; // the config entry; the editor toggles its `enabled`
  type: string;
  title: string;
  description?: string;
  needs?: string;
  known: boolean; // false = no card file has this type
}

interface Options {
  theme: Theme;
  rows: EditorRow[]; // edited in place
  onChange: () => void;
  done: (save: boolean) => void;
  requestRender: () => void;
}

export function createCardsEditor(o: Options): Component {
  const { theme, rows } = o;
  let selected = 0;
  // Where the clickable parts of each row are, in columns of the editor (set by render).
  let hits: { check: [number, number]; up: [number, number]; down: [number, number] } | undefined;

  const isOn = (row: EditorRow) => row.cfg.enabled !== false;
  const changed = () => {
    o.onChange();
    o.requestRender();
  };
  const toggle = (i: number) => {
    rows[i].cfg.enabled = !isOn(rows[i]);
    changed();
  };
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    selected = j;
    changed();
  };

  return {
    render(width: number): string[] {
      const border = (s: string) => theme.fg("border", s);
      const inner = Math.max(10, width - 4);
      const out: string[] = [];
      const line = (text: string) => out.push(border("│") + " " + truncateToWidth(text, inner, "…", true) + " " + border("│"));

      const title = truncateToWidth(" Side pane · cards ", Math.max(1, width - 4), "…");
      out.push(border("╭─") + theme.fg("accent", title) + border("─".repeat(Math.max(0, width - 3 - visibleWidth(title))) + "╮"));

      // x of the ▲ / ▼ glyphs and of the [x] box, in editor columns (2 for "│ ")
      const upX = 2 + inner - 3;
      const downX = 2 + inner - 1;
      hits = { check: [4, 6], up: [upX - 1, upX], down: [upX + 1, downX + 1] };

      rows.forEach((row, i) => {
        const on = isOn(row);
        const box = on ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
        const name = row.known ? row.title : `${row.type} (unknown)`;
        const styledName = i === selected ? theme.bold(on ? name : theme.fg("dim", name)) : on ? name : theme.fg("dim", name);
        const left = `${i === selected ? theme.fg("accent", "›") : " "} ${box} ${styledName}`;
        const typeText = truncateToWidth(row.type, Math.max(0, inner - visibleWidth(left) - 1 - 5), "…");
        const right = theme.fg("dim", typeText) + "  " + theme.fg("accent", "▲") + " " + theme.fg("accent", "▼");
        line(left + " ".repeat(Math.max(1, inner - visibleWidth(left) - visibleWidth(right))) + right);
      });

      // About the selected card.
      line(theme.fg("border", "─".repeat(inner)));
      const row = rows[selected];
      if (row) {
        const about = row.known
          ? row.description ?? "No description."
          : "No card file has this type. Disable it here, or add cards/" + row.type + ".ts.";
        for (const l of wrapTextWithAnsi(about, inner)) line(theme.fg("muted", l));
        if (row.needs) line(theme.fg("dim", `needs: ${row.needs}`));
      }
      line("");
      line(theme.fg("dim", "↑↓ select · space on/off · shift+↑↓ move"));
      line(theme.fg("dim", "enter save · esc cancel"));
      out.push(border("╰" + "─".repeat(Math.max(0, width - 2)) + "╯"));
      return out;
    },

    handleInput(data: string): void {
      if (matchesKey(data, Key.escape)) return o.done(false);
      if (matchesKey(data, Key.enter)) return o.done(true);
      if (matchesKey(data, Key.up)) selected = Math.max(0, selected - 1);
      else if (matchesKey(data, Key.down)) selected = Math.min(rows.length - 1, selected + 1);
      else if (matchesKey(data, Key.space)) return toggle(selected);
      else if (matchesKey(data, Key.shift("up")) || matchesKey(data, Key.alt("up"))) return move(selected, -1);
      else if (matchesKey(data, Key.shift("down")) || matchesKey(data, Key.alt("down"))) return move(selected, 1);
      else return;
      o.requestRender();
    },

    // Mouse input: x and y are local to the editor.
    handleMouse(event: { type: string; button: string; x: number; y: number }) {
      if (event.type !== "click" || event.button !== "left" || !hits) return undefined;
      const i = event.y - 1; // row 0 is the title bar
      if (i < 0 || i >= rows.length) return undefined;
      const within = (r: [number, number]) => event.x >= r[0] && event.x <= r[1];
      selected = i;
      if (within(hits.check)) toggle(i);
      else if (within(hits.up)) move(i, -1);
      else if (within(hits.down)) move(i, 1);
      else o.requestRender();
      return { handled: true, render: true };
    },

    invalidate() {},
  } as Component;
}
