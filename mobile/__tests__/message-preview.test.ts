import { expect, test } from 'bun:test';

import {
  MESSAGE_TYPES,
  isKnownMessageType,
  isMachineText,
  previewShape,
} from '@/data/message-preview';

/**
 * O bug que este módulo existe para não repetir: a lista de conversas mostrava
 * `{"kind":"poll",…}` a pessoas reais. Acrescentaram-se casos para poll e
 * event e deixou-se o buraco aberto — e `call`, `game` e `system` caíram nele
 * a seguir.
 */

test('todos os tipos do servidor têm uma forma decidida', () => {
  // Se o servidor ganhar um tipo novo, ou este teste ou o `never` no switch
  // dá o alarme — que é o ponto de existirem os dois.
  for (const t of MESSAGE_TYPES) {
    expect(previewShape(t)).toBeTruthy();
  }
  expect(MESSAGE_TYPES.length).toBe(14);
});

test('os três que vazavam agora têm rótulo', () => {
  expect(previewShape('call').kind).toBe('label');
  expect(previewShape('game').kind).toBe('label');
  expect(previewShape('system').kind).toBe('label');
});

test('só texto e reply mostram o conteúdo', () => {
  const asText = MESSAGE_TYPES.filter((t) => previewShape(t).kind === 'text');
  expect(asText.sort()).toEqual(['reply', 'text']);
});

test('media com legenda pode ser substituída pela legenda', () => {
  expect(previewShape('image').kind).toBe('captioned');
  expect(previewShape('video').kind).toBe('captioned');
  // Um documento não: o nome do ficheiro não é uma legenda.
  expect(previewShape('document').kind).toBe('label');
});

test('um tipo desconhecido cai em texto, para a rede o apanhar', () => {
  expect(isKnownMessageType('quantum')).toBe(false);
  expect(previewShape('quantum').kind).toBe('text');
  expect(previewShape(undefined).kind).toBe('text');
});

// ── A rede de segurança ─────────────────────────────────────────────────────

test('apanha as três formas que já apareceram na lista', () => {
  expect(isMachineText('{"call_id":"9f2c","mode":"video"}')).toBe(true);
  expect(isMachineText('[{"a":1}]')).toBe(true);
  expect(isMachineText('soc1.abc.def')).toBe(true);
  expect(isMachineText('disappearing:60:0f8c1a2b')).toBe(true);
});

test('não apanha o que uma pessoa escreveria', () => {
  expect(isMachineText('olá')).toBe(false);
  expect(isMachineText('')).toBe(false);
  // A verificação do espaço é o que salva uma hora escrita com dois pontos.
  expect(isMachineText('18:30: a caminho')).toBe(false);
  expect(isMachineText('vê isto: é bom')).toBe(false);
  // Uma chaveta solta não é JSON.
  expect(isMachineText('{ não fechado')).toBe(false);
  expect(isMachineText('usa } para fechar')).toBe(false);
});
