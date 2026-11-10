---
name: md-to-html
description: Converts a Markdown file into a polished, self-contained HTML page with a font-size control and an Auto/Dark/Light theme switch. Use immediately after creating any new .md file the user will read (reports, notes, plans, summaries, write-ups, documentation), and whenever the user asks to render, preview or export Markdown as HTML. Do not use for agent or configuration files such as SKILL.md, AGENTS.md, CLAUDE.md, MEMORY.md or memory entries.
---

# Markdown to HTML

Turns a `.md` file into a single `.html` file placed next to it, with syntax-highlighted
code and mermaid diagrams. Pages without a diagram make no external request and work
offline. A sticky top bar has two controls:

- font size: `−` / `+` buttons, with the current percentage (click it to reset), 80%–160%
- theme: **Auto** (follows the system), **Dark**, **Light**

Both choices are remembered by the browser.

## When to run it

Right after you create a Markdown file, run the converter and tell the user the
path of the generated HTML in one line. Do this without being asked.

Also re-run it after you later edit a `.md` file you already converted, so the HTML
does not go stale.

Skip it when:

- the file is agent or tool configuration: `SKILL.md`, `AGENTS.md`, `CLAUDE.md`,
  `MEMORY.md`, memory entries, or anything under `.claude/`, `.pi/`, `.agents/`
- the file is under `node_modules/`, `.git/` or a vendored/third-party directory
- the user asked not to convert, or asked for Markdown only

## How to run it

Paths are relative to this skill's directory.

```bash
node scripts/md2html.mjs path/to/file.md                 # writes path/to/file.html
node scripts/md2html.mjs path/to/file.md other/out.html  # explicit output path
```

The script prints the absolute path of the file it wrote. It needs Node 18 or newer
and nothing else: the Markdown parser (marked) and the highlighter (highlight.js) are
bundled in `scripts/vendor/`.

## Code and diagrams

- **Syntax highlighting** happens at conversion time, so the page stays static. Tag the
  fence with a language (```` ```python ````). Supported: highlight.js's common languages
  (js, ts, python, bash/sh, json, yaml, toml/ini, sql, go, rust, java, c/cpp, css, html/xml,
  markdown, diff, and more) plus dockerfile, nginx and powershell. A fence with no language,
  or an unknown one, is shown as plain text; the language is never guessed.
- **Mermaid diagrams**: put the diagram in a ```` ```mermaid ```` fence. It is rendered in
  the browser at page load, in the page's current theme, and re-rendered when the theme
  changes. This is the one case where the page loads something from the network: a pinned,
  integrity-checked `mermaid@12.3.0` from the jsDelivr CDN, added only to pages that contain
  a diagram. If it cannot load (offline, blocked) or the diagram has a syntax error, the
  diagram source is shown with a short note instead. Check diagram syntax before converting.

## Notes

- Supported: GitHub-flavoured Markdown (tables, task lists, strikethrough, autolinks),
  fenced code blocks, blockquotes, images, heading anchors. A leading YAML front matter
  block is dropped. The page title is the first `# heading`, else the file name.
- Raw HTML inside the Markdown is passed through unchanged. Only convert content you trust.
- Do not open the HTML in a browser and do not commit it unless the user asks.
- The look lives in `assets/template.html` (token colours included) and the diagram
  loader in `assets/mermaid.html`. Edit those to change behaviour; do not patch generated
  HTML. To bump mermaid, change the version and the `integrity` hash together
  (`openssl dgst -sha384 -binary mermaid.min.js | openssl base64 -A`).
