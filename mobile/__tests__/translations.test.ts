import { expect, test } from 'bun:test';
import { Glob } from 'bun';

/**
 * Every key the code asks for has to exist, in both languages.
 *
 * This shipped: the call screen's failure state rendered
 * `[missing "en.common.close" translation]` where a Close button should have
 * been, so the one way out of a failed call was a line of debug text. Nothing
 * caught it because a missing key is not a type error and not a crash — it is
 * a string that renders, and only on the screen nobody reaches on purpose.
 */

async function usedKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  const glob = new Glob('{app,components,data,hooks}/**/*.{ts,tsx}');
  for await (const file of glob.scan('.')) {
    const src = await Bun.file(file).text();
    // Literal calls only. `t(\`stories.${x}\`)` cannot be checked from here,
    // and pretending otherwise would make this test lie in the other
    // direction.
    for (const m of src.matchAll(/\bt\(\s*'([a-z_]+\.[a-z_0-9]+)'/g)) {
      keys.add(m[1]);
    }
  }
  return keys;
}

/**
 * Reads the locale as text rather than importing it: the module pulls in the
 * i18n runtime, which pulls in expo-localization, which does not exist outside
 * an app. Section is whatever is at two-space indent, key at four.
 */
async function localeKeys(locale: string): Promise<Set<string>> {
  const src = await Bun.file(`i18n/locales/${locale}.ts`).text();
  const out = new Set<string>();
  let section: string | null = null;
  for (const line of src.split('\n')) {
    const s = /^ {2}(\w+): \{/.exec(line);
    if (s) {
      section = s[1];
      continue;
    }
    if (/^ {2}\},/.test(line)) {
      section = null;
      continue;
    }
    const k = /^ {4}(\w+):/.exec(line);
    if (k && section) out.add(`${section}.${k[1]}`);
  }
  return out;
}

test('nao ha chave usada sem traducao', async () => {
  const used = await usedKeys();
  const en = await localeKeys('en');
  const pt = await localeKeys('pt');

  const missing: string[] = [];
  for (const key of used) {
    if (!en.has(key)) missing.push(`en: ${key}`);
    if (!pt.has(key)) missing.push(`pt: ${key}`);
  }
  expect(missing.sort(), 'chaves em falta').toEqual([]);
});

test('os dois idiomas tem as mesmas chaves', async () => {
  const en = await localeKeys('en');
  const pt = await localeKeys('pt');

  // Drift in either direction is a bug: a key only in English renders raw for
  // half the users, and one only in Portuguese is dead weight nobody deletes
  // because nobody knows it is dead.
  const onlyEn = [...en].filter((k) => !pt.has(k)).sort();
  const onlyPt = [...pt].filter((k) => !en.has(k)).sort();
  expect(onlyEn, 'só em en').toEqual([]);
  expect(onlyPt, 'só em pt').toEqual([]);
});

test('as chaves que a tela de chamada precisa existem', async () => {
  // Named because this is the one that shipped, and the screen it broke is
  // the screen someone reaches when a call has already gone wrong.
  const en = await localeKeys('en');
  for (const key of ['common.close', 'call.unmute', 'call.failed_to_join']) {
    expect(en.has(key), `${key} em falta`).toBe(true);
  }
});
test('locale strings use double-brace placeholders', async () => {
  for (const locale of ['en', 'pt']) {
    const src = await Bun.file(`i18n/locales/${locale}.ts`).text();
    const bad = src
      .split('\n')
      .map((line, i) => ({ line, n: i + 1 }))
      .filter(({ line }) => /(?<!\{)\{\w+\}(?!\})/.test(line));
    expect(bad, `single-brace placeholder in ${locale}`).toEqual([]);
  }
});

