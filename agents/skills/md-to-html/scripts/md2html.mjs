#!/usr/bin/env node
// Converts a Markdown file into a single self-contained HTML page.
//
//   node md2html.mjs <input.md> [output.html]
//
// Output defaults to the input path with a .html extension. Code blocks are
// highlighted here, at conversion time. A page makes no external request unless it
// contains a mermaid diagram, which is rendered in the browser at page load.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "./vendor/marked.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, "..", "assets", "template.html");
const mermaidSnippetPath = join(here, "..", "assets", "mermaid.html");

// highlight.js is CommonJS: 36 common languages, plus a few extras registered below.
const require = createRequire(import.meta.url);
const hljs = require("./vendor/highlight/common.js");
for (const extra of ["dockerfile", "nginx", "powershell"]) {
  hljs.registerLanguage(extra, require(`./vendor/highlight/languages/${extra}.js`));
}

function fail(message) {
  console.error(`md2html: ${message}`);
  process.exit(1);
}

const [input, output] = process.argv.slice(2);
if (!input || input === "-h" || input === "--help") {
  console.error("usage: node md2html.mjs <input.md> [output.html]");
  process.exit(input ? 0 : 2);
}
if (!existsSync(input)) fail(`no such file: ${input}`);
if (!/\.(md|markdown|mdx?)$/i.test(input)) fail(`not a Markdown file: ${input}`);

const outPath = resolve(output ?? input.replace(/\.[^.]+$/, ".html"));
if (outPath === resolve(input)) fail("output would overwrite the input file");

let source = readFileSync(input, "utf8").replace(/^﻿/, "");
// A leading YAML front matter block is metadata, not content.
source = source.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, "");

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const seen = new Map();
function slug(text) {
  const base =
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section";
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

let hasMermaid = false;

const marked = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }) {
      // The info string may carry extra words (```js title=x); the language is the first.
      const language = (lang ?? "").match(/^\S*/)[0].toLowerCase();
      if (language === "mermaid") {
        // Rendered in the browser at page load; the source is the no-JS / offline fallback.
        hasMermaid = true;
        return `<div class="diagram"><pre class="mermaid">${escapeHtml(text)}</pre></div>\n`;
      }
      // No language, or one highlight.js does not know: plain text, never auto-detected.
      if (language && hljs.getLanguage(language)) {
        const body = hljs.highlight(text, { language, ignoreIllegals: true }).value;
        return `<pre><code class="hljs language-${escapeHtml(language)}">${body}</code></pre>\n`;
      }
      const cls = language ? ` class="language-${escapeHtml(language)}"` : "";
      return `<pre><code${cls}>${escapeHtml(text)}</code></pre>\n`;
    },
    heading({ tokens, depth, text }) {
      const id = slug(text);
      const inner = this.parser.parseInline(tokens);
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${depth}>\n`;
    },
  },
});

// Title: first level-1 heading, else the file name.
const firstH1 = marked.lexer(source).find((t) => t.type === "heading" && t.depth === 1);
const title = (firstH1?.text ?? basename(input, extname(input))).replace(/[*_`]/g, "");

// Wide tables scroll on their own instead of stretching the page.
const content = marked
  .parse(source)
  .replace(/<table>/g, '<div class="table-wrap"><table>')
  .replace(/<\/table>/g, "</table></div>");

const template = readFileSync(templatePath, "utf8");
// Pages without a diagram carry no mermaid code and make no network request.
const mermaid = hasMermaid ? readFileSync(mermaidSnippetPath, "utf8") : "";
// Replacer functions: the content may contain "$&", "$1" and the like.
const html = template
  .replace("{{TITLE}}", () => escapeHtml(title))
  .replace("{{CONTENT}}", () => content)
  .replace("{{MERMAID}}", () => mermaid);

writeFileSync(outPath, html);
console.log(outPath);
