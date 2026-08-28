import { expect, test } from 'bun:test';

import {
  EXTENDED_REACTIONS,
  STANDARD_REACTIONS,
  applyMyReactions,
  reactionBarEmojis,
  toggleReaction,
  type StoryReactionCount,
} from '../data/story-reactions';

test('tocar num emoji adiciona-o, tocar outra vez retira-o', () => {
  expect(toggleReaction([], '🔥')).toEqual(['🔥']);
  expect(toggleReaction(['🔥'], '❤️')).toEqual(['🔥', '❤️']);
  expect(toggleReaction(['🔥', '❤️'], '🔥')).toEqual(['❤️']);
});

test('as contagens sobem e descem so na parte que e minha', () => {
  const counts: StoryReactionCount[] = [
    { emoji: '🔥', count: 4 },
    { emoji: '❤️', count: 2 },
  ];
  // Estava com 🔥, passo a estar com 🔥 e 🎉: o 🔥 nao se mexe, o 🎉 aparece
  // com um, e o ❤️ dos outros fica onde estava.
  const after = applyMyReactions(counts, ['🔥'], ['🔥', '🎉']);
  expect(after).toContainEqual({ emoji: '🔥', count: 4 });
  expect(after).toContainEqual({ emoji: '❤️', count: 2 });
  expect(after).toContainEqual({ emoji: '🎉', count: 1 });
});

test('retirar a ultima reaccao tira o emoji da lista', () => {
  const after = applyMyReactions([{ emoji: '🎉', count: 1 }], ['🎉'], []);
  expect(after).toEqual([]);
});

test('retirar uma reaccao que outros tambem deixaram baixa um, nao apaga', () => {
  const after = applyMyReactions([{ emoji: '🔥', count: 3 }], ['🔥'], []);
  expect(after).toEqual([{ emoji: '🔥', count: 2 }]);
});

/**
 * A contagem nunca fica negativa mesmo com um `previous` desalinhado do
 * servidor — acontece quando duas respostas chegam fora de ordem, e um -1
 * num chip e pior do que perder uma actualizacao.
 */
test('uma contagem nunca fica negativa', () => {
  const after = applyMyReactions([], ['🔥'], []);
  expect(after).toEqual([]);
});

test('a barra mostra sempre o conjunto padrao', () => {
  expect(reactionBarEmojis([], [])).toEqual([...STANDARD_REACTIONS]);
});

test('um emoji extended sobe a barra quando alguem o deixou', () => {
  const bar = reactionBarEmojis([{ emoji: '🥳', count: 4 }], []);
  expect(bar).toContain('🥳');
  // Ordem de catalogo, nao por contagem: os botoes nao se reordenam debaixo
  // do dedo.
  expect(bar.indexOf('🥳')).toBeGreaterThan(bar.indexOf('👏'));
});

test('um emoji extended que eu escolhi fica visivel na barra', () => {
  expect(reactionBarEmojis([], ['💯'])).toContain('💯');
});

test('a barra nao repete um emoji que e meu e tem contagem', () => {
  const bar = reactionBarEmojis([{ emoji: '💯', count: 1 }], ['💯']);
  expect(bar.filter((e) => e === '💯')).toHaveLength(1);
});

/**
 * A app traz a sua propria copia do conjunto para desenhar a barra no
 * primeiro frame e sem rede. Uma copia que divirja do servidor mostra chips
 * que dao `400 invalid_emoji` ao toque, e nada nos avisa — este teste avisa.
 */
test('a lista do cliente e a mesma do servidor', async () => {
  const src = await Bun.file('../server/internal/modules/stories/reactions.go').text();

  const goList = (name: string): string[] => {
    const m = new RegExp(`${name} = \\[\\]string\\{([^}]*)\\}`).exec(src);
    if (!m) throw new Error(`${name} nao encontrada em reactions.go`);
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  };

  expect(goList('StandardReactions')).toEqual([...STANDARD_REACTIONS]);
  expect(goList('ExtendedReactions')).toEqual([...EXTENDED_REACTIONS]);
});
