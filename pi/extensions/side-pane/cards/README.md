# Cards for the side pane

Every file in this folder is a card type, named after the file: `git-log.ts` is the card
`{ "type": "git-log" }` in `side-pane.json`. There is nothing to register. Add a file, run `/reload`
in pi, and the card is there: listed in `/pane config` and usable from the config.

- Files whose name starts with `_` or `.` are ignored, so renaming a card to `_git-log.ts` switches
  it off without deleting it.
- A file that fails to load (a syntax error, a missing default export) is reported when pi starts
  and skipped. The other cards are not affected. A card that throws while it draws shows
  "card error" in its box instead of breaking the pane.
- Editing a card needs `/reload` too.

## Writing one

A card file default-exports a factory, and may export `meta` for the card editor:

```ts
import { truncateToWidth } from "@earendil-works/pi-tui";
import { clampInt } from "../helpers";
import type { CardFactory, CardMeta } from "../types";

export const meta: CardMeta = {
  title: "Clock",
  description: "The current time. Options: seconds (true to show them).",
  // needs: "a running something",   // documentation only, shown in the editor
};

const card: CardFactory = (config, env) => {
  // `config` is this card's entry from side-pane.json, with its own options.
  const seconds = config.seconds === true;
  let now = "";

  return {
    title: typeof config.title === "string" ? config.title : "Clock",

    // Called when the pane refreshes (every refreshSeconds, and after each agent turn).
    async refresh() {
      now = new Date().toLocaleTimeString([], seconds ? undefined : { hour: "2-digit", minute: "2-digit" });
    },

    // Content lines for `width` columns. The pane draws the box around them.
    render(width, theme) {
      return [theme.fg("accent", truncateToWidth(now, width, "…"))];
    },

    // Optional: shown after the title while the card is collapsed.
    summary: () => now,

    // Optional: shown, dimmed, after the title while the card is open. `room` is how many columns
    // it may use; fit the text into it (`truncateLeft` in ../helpers keeps the end of a path).
    // subtitle: (theme, room) => theme.fg("muted", truncateLeft("~/some/folder", room)),

    // Optional: return false while a dependency is missing and the card is not drawn at all.
    // A card that has to probe something answers false until its first refresh() has finished.
    // available: () => ready,
  };
};

export default card;
```

## Filling the pane

Any card entry can have `"fill": true` in `side-pane.json` (or press `f` on it in `/pane config`).
The pane draws every card at its natural size first. If rows are left over, the open cards with
`fill` share them evenly (the first ones get the odd row). A collapsed card never grows.

A card does not have to do anything for this: its box is padded to the new size. A card that can show
more when it has room can use the optional third argument of `render`:

```ts
render(width, theme, height) {
  // `height` is only set for a card with "fill": the rows its body may use.
  const limit = height ?? maxLines;   // use them if you can; the pane pads or cuts to `height`
  ...
}
```

`working tree`, `agent edits` and `thinking` do this.

## Mouse input

A card can implement `handleMouse(event)` to react to the mouse over its body. `x` and `y` are local
to the body (0,0 is its first cell); `event.type` is `click`, `wheel` and so on, and a wheel event
carries `wheelDelta`. Return `{ handled: true }` when you used the event. Anything you leave unhandled
falls through to the pane (a wheel event scrolls the pane). `files.ts` uses it to open folders and
files and to scroll its tree.

## What a card gets

- `config`: its entry from `side-pane.json` (`type`, `title`, `collapsed`, `enabled` and whatever
  options you define).
- `env.git(args, timeoutMs?)`: runs git in pi's working directory. Resolves to the output, or
  `undefined` when git failed (not a repository, no commits, timed out).
- `env.cwd`: pi's working directory.
- `env.touched`: the files the agent wrote or edited this session (absolute path to count and time).
- `env.on(event, handler)`: subscribes to a pi event for as long as the card lives. You get the
  same event object an extension would get from `pi.on`. Available events: `model_select`,
  `thinking_level_select`, `before_agent_start`
  (once per user prompt), `agent_start`, `agent_end`, `turn_start`, `turn_end`, `message_start`,
  `message_update` (every streamed token), `message_end`, `tool_execution_start`,
  `tool_execution_end`, `tool_call`, `tool_result`. A handler that throws is ignored, and the
  subscriptions go away with the card.
- `env.repaint()`: asks the pane to redraw after state changed outside `refresh()`. It is coalesced
  to about 15 redraws a second, so calling it on every token is fine.
- `env.sessionEntries()`: the current session branch, oldest first. Use it to rebuild state after
  `/reload` or a resume, as `thinking.ts` does.
- `env.session()`: the model, thinking level and context use (`context.tokens/window/percent`) as pi's
  footer showed them. Read it on every draw. `session.ts` is the example; it also listens to the
  `model_select` and `thinking_level_select` events.
- `env.openFile(path)` / `env.openedFile()`: opens a file in the file viewer (which splits the
  main area, fullscreen mode only) and tells which file it shows. `files.ts` is the example.
- `render(width, theme)`: `theme.fg("accent" | "muted" | "dim" | "success" | "warning" | "error", text)`.
  Use `truncateToWidth` / `visibleWidth` / `wrapTextWithAnsi` from `@earendil-works/pi-tui`: never
  rely on `string.length` for what lands on screen.
- `../helpers`: `clampInt`, `inRepo`, `truncateLeft`, `age` and the git marks `STAGED`, `UNSTAGED`,
  `UNTRACKED`.
