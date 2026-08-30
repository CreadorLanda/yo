import { expect, test } from 'bun:test';

import {
  DEFAULT_AVATAR_LICENSE,
  avatarSeed,
  defaultAvatarSvg,
} from '@/data/default-avatar';

test('a mesma pessoa é sempre a mesma cara', () => {
  // É o contrato todo: nada é guardado em lado nenhum, portanto a única coisa
  // que garante que a cara não muda entre dispositivos é ser determinista.
  const a = defaultAvatarSvg('ana-uuid');
  const b = defaultAvatarSvg('ana-uuid');
  expect(a).toBe(b);
  expect(a.trimStart().startsWith('<svg')).toBe(true);
});

test('pessoas diferentes são caras diferentes', () => {
  expect(defaultAvatarSvg('ana-uuid')).not.toBe(defaultAvatarSvg('bruno-uuid'));
});

test('o tamanho faz parte da identidade da cache', () => {
  // Sem o tamanho na chave, pedir 96 depois de 40 devolvia o SVG pequeno
  // esticado — que é como um avatar fica desfocado só nalguns ecrãs.
  const small = defaultAvatarSvg('ana-uuid', 40);
  const large = defaultAvatarSvg('ana-uuid', 96);
  expect(small).not.toBe(large);
});

test('a semente prefere o id ao nome de utilizador', () => {
  // Um nome de utilizador muda; uma cara que muda com ele é uma cara que
  // ninguém reconhece.
  expect(avatarSeed({ id: 'uuid-1', username: 'ana' })).toBe('uuid-1');
  expect(avatarSeed({ username: 'Ana' })).toBe('ana');
  expect(avatarSeed({})).toBe('yo');
  // Maiúsculas e espaços não podem dar caras diferentes à mesma pessoa.
  expect(avatarSeed({ username: '  ANA  ' })).toBe(avatarSeed({ username: 'ana' }));
});

test('o estilo é CC0 — sem obrigação de atribuição', () => {
  // Metade dos estilos do DiceBear são CC BY 4.0 e obrigariam todos os que
  // distribuem esta app a atribuir. Se alguém trocar o estilo, este teste
  // falha antes de essa obrigação entrar sem ninguém reparar.
  expect(DEFAULT_AVATAR_LICENSE.name).toBe('CC0 1.0');
});
