// Borders for the sections of the main area: the file viewer and the chat each get a box, so it is
// clear where one ends and the next begins. A box is a stack of small components (corners, a rule
// carrying a label, side bars around the body), so the body keeps its own layout and its mouse
// input arrives in its own coordinates, as if the box were not there.

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { HStack, truncateToWidth, VStack, visibleWidth } from "@earendil-works/pi-tui";

// A stack whose own render() is a constant. The layout engine measures every child of a stack by
// calling render(); for pi's root that would draw the whole chat a second time on every frame.
// Real layout and painting go through the layout node, not through render(), so only the
// throwaway measurement becomes cheap.
export class MeasurementSafeVStack extends VStack {
  render(_width: number): string[] {
    return [""];
  }
}

class MeasurementSafeHStack extends HStack {
  render(_width: number): string[] {
    return [""];
  }
}

// `─` filling the rest of the line after a label (which may be styled). Use it for a rule's content.
export function ruleLine(theme: Theme, width: number, label = ""): string {
  const text = truncateToWidth(label, Math.max(0, width), "…");
  return text + theme.fg("border", "─".repeat(Math.max(0, width - visibleWidth(text))));
}

const corner = (theme: () => Theme, ch: string): Component => ({
  render: () => [theme().fg("border", ch)],
  invalidate() {},
});

// A column of `│`, as tall as the terminal: the layout clips it to the rows it was given.
const side = (theme: () => Theme, rows: () => number): Component => ({
  render: () => Array.from({ length: Math.max(1, rows()) }, () => theme().fg("border", "│")),
  invalidate() {},
});

const fixed = { grow: 0, shrink: 0 } as const;

// A line made of a corner, `middle` (which draws the rest of the line) and a corner.
function edge(theme: () => Theme, left: string, middle: Component, right: string): Component {
  return new MeasurementSafeHStack([
    { component: corner(theme, left), basis: 1, ...fixed },
    { component: middle, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: corner(theme, right), basis: 1, ...fixed },
  ]);
}

// The options of one entry of a stack, as pi-tui keeps them.
interface StackLayoutEntry {
  component: Component;
  basis?: number | "auto";
  grow?: number;
  shrink?: number;
  minSize?: number;
  maxSize?: number;
  visible?: (viewport: { width: number; height: number }) => boolean;
}

// ---- the chat ------------------------------------------------------------------------------------
//
// Pi's fullscreen root is [ transcript | dock ], the dock being [ pending, status, widgets, editor,
// widgets, footer ]. The editor draws a rule above and below its text. Inside the chat's box those
// two rules look like clutter, so the dock's rows get side borders of their own and the rules are
// reworked: the one above the input becomes a junction with the side borders (├────┤), the one
// below is dropped and the box's bottom edge closes the input instead.

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// A line that is nothing but a rule: the editor's border, possibly with a "↑ 3 more" note in it.
const isRule = (line: string) => {
  const text = line.replace(ANSI, "").trim();
  return text.length > 0 && text.startsWith("─") && text.endsWith("─");
};

// Draws `body` (one dock row group) between side borders, reworking the editor's two rules.
class Bordered implements Component {
  private dropped = -1; // the row, in the body's own lines, that was left out
  constructor(
    private readonly body: Component,
    private readonly theme: () => Theme,
  ) {}

  render(width: number): string[] {
    const t = this.theme();
    const inner = Math.max(1, width - 2);
    const out: string[] = [];
    let rules = 0;
    this.dropped = -1;
    this.body.render(inner).forEach((line, i) => {
      if (isRule(line)) {
        rules++;
        if (rules === 1) return void out.push(t.fg("border", "├") + line + t.fg("border", "┤"));
        if (rules === 2) return void (this.dropped = i);
      }
      const pad = " ".repeat(Math.max(0, inner - visibleWidth(line)));
      out.push(t.fg("border", "│") + line + pad + t.fg("border", "│"));
    });
    return out;
  }

  handleMouse(event: any) {
    // Over a side border: nothing to do. Otherwise the body, in its own coordinates; rows below the
    // dropped rule are one row further down in the body.
    if (event.x < 1 || event.x > event.width - 2) return undefined;
    const y = this.dropped >= 0 && event.y >= this.dropped ? event.y + 1 : event.y;
    return (this.body as any).handleMouse?.({ ...event, x: event.x - 1, y, width: event.width - 2 });
  }

  invalidate() {
    this.body.invalidate();
  }
}

// What goes inside the chat's box: pi's root, with side borders on the transcript and on every row of
// the dock. If pi's root does not have the expected shape, `fallback` is the plain way (side columns).
export function chatBody(root: Component, theme: () => Theme, rows: () => number): Component | undefined {
  const entries = (root as any).entries as StackLayoutEntry[] | undefined;
  const dock = entries?.[1]?.component as any;
  if (!entries || entries.length !== 2 || !Array.isArray(dock?.entries)) return undefined;
  // The editor entry asks for at least 3 rows (a rule, a line of text, a rule): one rule is dropped.
  const wrap = (entry: StackLayoutEntry): StackLayoutEntry => ({
    ...entry,
    component: new Bordered(entry.component, theme),
    ...(entry.minSize !== undefined && entry.minSize >= 2 ? { minSize: entry.minSize - 1 } : {}),
  });
  const transcript = new MeasurementSafeHStack([
    { component: side(theme, rows), basis: 1, ...fixed },
    { component: entries[0].component, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: side(theme, rows), basis: 1, ...fixed },
  ]);
  return new MeasurementSafeVStack([
    { ...entries[0], component: transcript },
    // The dock is measured by its own render(): this one is a plain stack, not a measurement-safe one.
    { ...entries[1], component: new VStack((dock.entries as StackLayoutEntry[]).map(wrap)) },
  ]);
}

export interface BoxParts {
  theme: () => Theme;
  rows: () => number; // the terminal's height, for the side bars
  top: Component; // draws one line, usually with ruleLine(): the box title
  body: Component;
  // One line for the bottom edge (a rule with buttons in it, say). Without it the bottom is a plain rule.
  bottom?: Component;
  // Leave the right side open, for a body that draws its own scrollbar there.
  openRight?: boolean;
  // The body draws its own side borders (see chatBody).
  ownSides?: boolean;
}

export function box(parts: BoxParts): VStack {
  const { theme, rows } = parts;
  const plain: Component = { render: (w) => [ruleLine(theme(), w)], invalidate() {} };
  const middle = new MeasurementSafeHStack([
    ...(parts.ownSides ? [] : [{ component: side(theme, rows), basis: 1, ...fixed }]),
    { component: parts.body, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    ...(parts.openRight || parts.ownSides ? [] : [{ component: side(theme, rows), basis: 1, ...fixed }]),
  ]);
  return new MeasurementSafeVStack([
    { component: edge(theme, "╭", parts.top, "╮"), basis: 1, ...fixed },
    { component: middle, basis: 0, grow: 1, shrink: 1, minSize: 1 },
    { component: edge(theme, "╰", parts.bottom ?? plain, "╯"), basis: 1, ...fixed },
  ]);
}
