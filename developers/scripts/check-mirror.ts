/**
 * Every English page has a Portuguese twin at the same path, and nothing
 * exists in Portuguese only (#330). Fails the build otherwise.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = join(import.meta.dir, '..');
const en = join(root, 'docs');
const pt = join(root, 'i18n/pt/docusaurus-plugin-content-docs/current');

function pages(dir: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.mdx?$/.test(name)) out.add(relative(dir, p));
    }
  };
  walk(dir);
  return out;
}

const a = pages(en);
const b = pages(pt);
const missing = [...a].filter((p) => !b.has(p));
const extra = [...b].filter((p) => !a.has(p));
if (missing.length || extra.length) {
  if (missing.length) console.error(`Missing in pt: ${missing.join(', ')}`);
  if (extra.length) console.error(`Only in pt: ${extra.join(', ')}`);
  process.exit(1);
}
console.log(`${a.size} pages, mirrored in en and pt`);
