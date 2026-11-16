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

    // Optional: return false while a dependency is missing and the card is not drawn at all.
    // A card that has to probe something answers false until its first refresh() has finished.
    // available: () => ready,
  };
};

export default card;
```

## What a card gets

- `config`: its entry from `side-pane.json` (`type`, `title`, `collapsed`, `enabled` and whatever
  options you define).
- `env.git(args, timeoutMs?)`: runs git in pi's working directory. Resolves to the output, or
  `undefined` when git failed (not a repository, no commits, timed out).
- `env.cwd`: pi's working directory.
- `env.touched`: the files the agent wrote or edited this session (absolute path to count and time).
- `render(width, theme)`: `theme.fg("accent" | "muted" | "dim" | "success" | "warning" | "error", text)`.
  Use `truncateToWidth` / `visibleWidth` / `wrapTextWithAnsi` from `@earendil-works/pi-tui`: never
  rely on `string.length` for what lands on screen.
- `../helpers`: `clampInt`, `inRepo`, `truncateLeft`, `age` and the git marks `STAGED`, `UNSTAGED`,
  `UNTRACKED`.
