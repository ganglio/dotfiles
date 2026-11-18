// An editor ($VISUAL or $EDITOR) running inside the file viewer's area.
//
// Pi has no way to run an interactive program inside its screen, so tmux does the two jobs that
// need a terminal: it gives the program a pseudo-terminal and it keeps the screen the program
// draws. The editor runs in a tmux session of its own (a private server, one socket per pi, with
// no user config), the screen is read back with `capture-pane` every few milliseconds, and the
// keys pi receives are sent on with `send-keys`. Nothing is installed: tmux is all it needs.
//
// Keys. Pi may have asked the terminal for the Kitty keyboard protocol, which encodes some keys
// (Esc, Ctrl+letter, Alt+letter ...) as CSI-u sequences that editors in tmux do not understand.
// Those are turned back into the classic bytes. Everything else is passed on as it came.

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { decodeKittyPrintable, isKeyRelease, parseKey, truncateToWidth } from "@earendil-works/pi-tui";
import { execFile, execFileSync, spawn } from "node:child_process";

const SESSION = "ed";
const POLL_MS = 40;
// The key that hands the keyboard back to the chat while the editor keeps running.
export const LEAVE_KEY = "ctrl+]";

const NAMED: Record<string, string> = {
  escape: "\x1b",
  enter: "\r",
  tab: "\t",
  "shift+tab": "\x1b[Z",
  backspace: "\x7f",
  space: " ",
  "ctrl+space": "\x00",
};

// What to send to the editor for what pi received: classic bytes for a CSI-u key, the data itself otherwise.
export function classicBytes(data: string): string {
  if (!/^\x1b\[[\d:;]*u$/.test(data)) return data;
  if (isKeyRelease(data)) return "";
  const id = parseKey(data);
  if (id !== undefined) {
    if (NAMED[id] !== undefined) return NAMED[id];
    const ctrl = /^ctrl\+([a-z])$/.exec(id);
    if (ctrl) return String.fromCharCode(ctrl[1].charCodeAt(0) - 96);
    if (id === "ctrl+[") return "\x1b";
    if (id === "ctrl+]") return "\x1d";
    if (id === "ctrl+\\") return "\x1c";
    if (id === "ctrl+^") return "\x1e";
    if (id === "ctrl+_") return "\x1f";
    const alt = /^alt\+(.+)$/.exec(id);
    if (alt) return "\x1b" + (alt[1].length === 1 ? alt[1] : (NAMED[alt[1]] ?? ""));
    const shifted = /^shift\+([a-z])$/.exec(id);
    if (shifted) return shifted[1].toUpperCase();
    if (id.length === 1) return id;
  }
  return decodeKittyPrintable(data) ?? "";
}

// Puts the cursor (reverse video) on column `col` of a line of coloured text, padding if the line is shorter.
export function paintCursor(line: string, col: number): string {
  let out = "";
  let at = 0; // visible column
  for (let k = 0; k < line.length; ) {
    if (line[k] === "\x1b") {
      const m = /^\x1b\[[0-9;:]*[A-Za-z]/.exec(line.slice(k));
      if (m) {
        out += m[0];
        k += m[0].length;
        continue;
      }
    }
    const cp = line.codePointAt(k)!;
    const ch = String.fromCodePoint(cp);
    k += ch.length;
    if (at === col) return out + "\x1b[7m" + ch + "\x1b[27m" + line.slice(k);
    out += ch;
    at += 1;
  }
  return out + " ".repeat(Math.max(0, col - at)) + "\x1b[7m \x1b[27m";
}

let tmuxFound: boolean | undefined;

// Whether tmux can be run. Looked up once.
export function tmuxAvailable(): boolean {
  if (tmuxFound === undefined) {
    try {
      execFileSync("tmux", ["-V"], { stdio: "ignore", env: cleanEnv() });
      tmuxFound = true;
    } catch {
      tmuxFound = false;
    }
  }
  return tmuxFound;
}

export interface EmbeddedEditor extends Component {
  focused: boolean;
  capturesViewportInput: boolean;
  readonly alive: boolean;
  // Closes the editor, whatever it is doing.
  stop(): void;
}

export interface EmbeddedOptions {
  command: string; // run by the shell, e.g. `vim 'file'`
  cwd: string;
  rows: () => number; // the rows the editor area has
  theme: () => Theme;
  requestRender: () => void;
  onExit: () => void; // the editor ended (by itself, or because of stop())
  onLeave: () => void; // the leave key was pressed
  onError: (message: string) => void; // the editor could not be started
  // True while a dialog (the "close it?" question) is open: it owns the keyboard and the mouse, and
  // the editor must not take them back.
  blocked: () => boolean;
}

const sockets = new Set<string>();
let exitHook = false;

// Closes every editor server of this process when pi exits, so none is left running.
function ensureExitHook() {
  if (exitHook) return;
  exitHook = true;
  process.on("exit", () => {
    for (const socket of sockets) {
      try {
        execFileSync("tmux", ["-L", socket, "-f", "/dev/null", "kill-server"], { stdio: "ignore", env: cleanEnv() });
      } catch {
        // already gone
      }
    }
  });
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.TMUX; // we are starting a server of our own, not a session inside the user's
  delete env.TMUX_PANE;
  return env;
}

export function startEmbeddedEditor(o: EmbeddedOptions): EmbeddedEditor {
  const socket = `pi-edit-${process.pid}-${Date.now().toString(36)}`;
  sockets.add(socket);
  ensureExitHook();

  const tmux = (...args: string[]) =>
    new Promise<{ ok: boolean; out: string }>((resolve) => {
      execFile("tmux", ["-L", socket, "-f", "/dev/null", ...args], { env: cleanEnv(), maxBuffer: 8_000_000 }, (err, stdout) =>
        resolve({ ok: !err, out: stdout ?? "" }),
      );
    });

  let alive = true;
  let ready = false; // the session exists
  let lines: string[] = [];
  let cursor = { x: 0, y: 0, visible: true };
  let mouse: { any: boolean; sgr: boolean } = { any: false, sgr: false };
  let size = { cols: 0, rows: 0 }; // what the session has been told
  let want = { cols: 80, rows: 24 };
  let lastShot = "";
  let polling = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let pending = ""; // keys waiting to be sent
  let sending = false;
  let dragging = false;

  function finish() {
    if (!alive) return;
    alive = false;
    if (timer) clearInterval(timer);
    timer = undefined;
    sockets.delete(socket);
    void tmux("kill-server");
    o.onExit();
  }

  async function resizeIfNeeded() {
    if (!ready || (size.cols === want.cols && size.rows === want.rows)) return;
    size = { ...want };
    await tmux("resize-window", "-t", SESSION, "-x", String(want.cols), "-y", String(want.rows));
  }

  async function poll() {
    if (polling || !alive) return;
    polling = true;
    try {
      if (!ready) return;
      await resizeIfNeeded();
      const META = "<<META>>";
      const r = await tmux(
        "capture-pane", "-p", "-e", "-t", SESSION, ";",
        "display-message", "-p", "-t", SESSION, `${META}#{cursor_x},#{cursor_y},#{pane_dead},#{mouse_any_flag},#{mouse_sgr_flag},#{cursor_flag}`,
      );
      if (!alive) return;
      if (!r.ok) return finish(); // the server is gone: the editor ended
      const at = r.out.lastIndexOf(META);
      if (at < 0) return;
      const meta = r.out.slice(at + META.length).trim().split(",");
      if (meta[2] === "1") return finish();
      if (r.out === lastShot) return;
      lastShot = r.out;
      lines = r.out.slice(0, at).split("\n");
      if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      cursor = { x: Number(meta[0]) || 0, y: Number(meta[1]) || 0, visible: meta[5] !== "0" };
      mouse = { any: meta[3] === "1", sgr: meta[4] === "1" };
      o.requestRender();
    } finally {
      polling = false;
    }
  }

  async function flush() {
    if (sending) return;
    sending = true;
    try {
      while (pending !== "" && alive) {
        const chunk = pending;
        pending = "";
        await tmux("send-keys", "-t", SESSION, "-l", "--", chunk);
      }
    } finally {
      sending = false;
    }
    void poll(); // show the effect of the keys without waiting for the next tick
  }

  const send = (data: string) => {
    if (data === "" || !alive) return;
    pending += data;
    void flush();
  };

  // If pi dies without a chance to clean up (its terminal was closed, it was killed), the editor
  // must not be left running: a watcher outside this process closes the server once pi is gone.
  const watcher = spawn(
    "sh",
    ["-c", `while kill -0 ${process.pid} 2>/dev/null && tmux -L '${socket}' -f /dev/null has-session -t ${SESSION} 2>/dev/null; do sleep 1; done; tmux -L '${socket}' -f /dev/null kill-server 2>/dev/null`],
    { detached: true, stdio: "ignore", env: cleanEnv() },
  );
  watcher.unref();
  watcher.on("error", () => {}); // no sh: nothing to watch with

  // Start: a session of the right size, with no status line and no escape delay.
  void (async () => {
    const created = { ...want }; // the size the session starts with: render() may change `want` while it starts
    const r = await tmux(
      "new-session", "-d", "-s", SESSION, "-x", String(created.cols), "-y", String(created.rows), "-c", o.cwd, o.command, ";",
      "set-option", "-g", "status", "off", ";",
      "set-option", "-sg", "escape-time", "0", ";",
      "set-option", "-g", "remain-on-exit", "off",
    );
    if (!r.ok) {
      o.onError("Could not start the editor: it needs tmux, and the command must work in a shell.");
      return finish();
    }
    size = created; // if `want` changed meanwhile, the next poll resizes
    ready = true;
    timer = setInterval(() => void poll(), POLL_MS);
    void poll();
  })();

  // Mouse: forwarded only when the editor asked for it (SGR encoding).
  function mouseBytes(e: { type: string; button: string; x: number; y: number; wheelDelta?: number }): string | undefined {
    if (!mouse.any || !mouse.sgr) return undefined;
    const x = e.x + 1;
    const y = e.y + 1;
    if (e.type === "wheel") return `\x1b[<${(e.wheelDelta ?? 0) < 0 ? 64 : 65};${x};${y}M`;
    const b = e.button === "left" ? 0 : e.button === "middle" ? 1 : e.button === "right" ? 2 : undefined;
    if (b === undefined) return undefined;
    if (e.type === "press") return `\x1b[<${b};${x};${y}M`;
    if (e.type === "drag") return `\x1b[<${b + 32};${x};${y}M`;
    if (e.type === "release") return `\x1b[<${b};${x};${y}m`;
    return undefined;
  }

  const component: EmbeddedEditor = {
    focused: false,
    capturesViewportInput: true,
    get alive() {
      return alive;
    },

    render(width: number): string[] {
      const t = o.theme();
      const inner = Math.max(1, width - 1); // the last column is the box's right edge
      const rows = Math.max(1, o.rows());
      want = { cols: inner, rows };
      const out: string[] = [];
      for (let y = 0; y < rows; y++) {
        let line = lines[y] ?? "";
        if (this.focused && cursor.visible && y === cursor.y) line = paintCursor(line, cursor.x);
        out.push(truncateToWidth(line, inner, "", true) + t.fg("border", "│"));
      }
      return out;
    },

    handleInput(data: string) {
      if (o.blocked()) return;
      if (parseKey(data) === LEAVE_KEY) return o.onLeave();
      send(classicBytes(data));
    },

    handleMouse(event: any) {
      if (o.blocked()) return { handled: true }; // a dialog is open: clicks do not reach the editor, nor give it the keyboard
      if (event.type === "press") dragging = true;
      const bytes = mouseBytes(event);
      if (bytes) send(bytes);
      if (event.type === "release" || event.type === "click") dragging = false;
      // A click anywhere in the editor gives it the keyboard.
      return { handled: true, focus: true, ...(event.type === "press" && dragging ? { capture: true } : {}) };
    },

    stop() {
      finish();
    },

    invalidate() {},
  };
  return component;
}
