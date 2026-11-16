// Card discovery: every file in cards/ is a card type, named after the file.
//
//   cards/git-log.ts   ->  { "type": "git-log" } in side-pane.json
//
// A card file default-exports a CardFactory and may export `meta` (see types.ts). Files whose name
// starts with "_" or "." are skipped, so a card can be switched off by renaming it. A file that
// fails to load is reported and skipped; it never takes the others down.

import { readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { CardFactory, CardMeta } from "./types";

export interface CardType {
  name: string;
  factory: CardFactory;
  meta: CardMeta;
}

const EXTENSIONS = new Set([".ts", ".js", ".mjs"]);

export async function discoverCards(dir: string): Promise<{ types: Map<string, CardType>; errors: string[] }> {
  const types = new Map<string, CardType>();
  const errors: string[] = [];

  let files: string[];
  try {
    files = readdirSync(dir).sort();
  } catch (e) {
    return { types, errors: [`cannot read the cards folder ${dir}: ${e instanceof Error ? e.message : String(e)}`] };
  }

  for (const file of files) {
    const name = basename(file, extname(file));
    if (!EXTENSIONS.has(extname(file)) || file.endsWith(".d.ts") || file.startsWith("_") || file.startsWith(".")) continue;
    try {
      const mod = (await import(join(dir, file))) as { default?: unknown; meta?: CardMeta };
      if (typeof mod.default !== "function") throw new Error("the default export must be a card factory function");
      if (types.has(name)) throw new Error(`a card named "${name}" already exists`);
      types.set(name, { name, factory: mod.default as CardFactory, meta: mod.meta ?? {} });
    } catch (e) {
      errors.push(`card "${file}" was skipped: ${(e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 160)}`);
    }
  }
  return { types, errors };
}
