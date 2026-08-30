import { expect, test } from 'bun:test';

import {
  DEFAULT_LOCK_TIMEOUT_MS,
  LOCK_TIMEOUTS_MS,
  sanitizeTimeout,
  shouldLock,
} from '@/data/app-lock-policy';

/**
 * Quando a app se volta a trancar.
 *
 * É a única decisão do bloqueio que se pode verificar sem um telemóvel na
 * mão: o resto — biometria, `FLAG_SECURE`, o instantâneo do alternador de
 * apps — é o sistema operativo a responder, e não há como o simular aqui.
 */

const MIN = 60_000;

test('em primeiro plano não há nada a decidir', () => {
  expect(shouldLock(null, Date.now(), MIN)).toBe(false);
});

test('dentro do período de tolerância não tranca', () => {
  const t0 = 1_000_000;
  expect(shouldLock(t0, t0 + 59_999, MIN)).toBe(false);
});

test('no limite exacto, tranca', () => {
  const t0 = 1_000_000;
  // >= e não >: escolher "1 minuto" e ser deixado entrar ao minuto certo
  // seria um limite que não é o que diz ser.
  expect(shouldLock(t0, t0 + MIN, MIN)).toBe(true);
  expect(shouldLock(t0, t0 + MIN + 1, MIN)).toBe(true);
});

test('"imediatamente" tranca mesmo sem tempo nenhum decorrido', () => {
  const t0 = 1_000_000;
  // Se isto fosse uma subtracção simples, t0 - t0 = 0 não chegaria a 0 e a
  // troca rápida de app deixava entrar — que é exactamente o contrário do
  // que quem escolhe esta opção está a pedir.
  expect(shouldLock(t0, t0, 0)).toBe(true);
});

test('um relógio que anda para trás tranca, não abre', () => {
  const t0 = 1_000_000;
  // Um bloqueio que se contorna a mexer na hora do aparelho não é um
  // bloqueio. Falha fechado.
  expect(shouldLock(t0, t0 - 10 * MIN, MIN)).toBe(true);
});

test('só os períodos que este build oferece sobrevivem', () => {
  for (const ms of LOCK_TIMEOUTS_MS) {
    expect(sanitizeTimeout(ms)).toBe(ms);
  }
  // Um valor guardado por outra versão, ou à mão, cai no padrão em vez de
  // deixar a app com um período que nenhuma opção do ecrã consegue mostrar.
  expect(sanitizeTimeout(1234)).toBe(DEFAULT_LOCK_TIMEOUT_MS);
  expect(sanitizeTimeout('60000')).toBe(DEFAULT_LOCK_TIMEOUT_MS);
  expect(sanitizeTimeout(null)).toBe(DEFAULT_LOCK_TIMEOUT_MS);
  expect(sanitizeTimeout(undefined)).toBe(DEFAULT_LOCK_TIMEOUT_MS);
  expect(sanitizeTimeout(-1)).toBe(DEFAULT_LOCK_TIMEOUT_MS);
});

test('o padrão é um minuto, e está na lista', () => {
  expect(DEFAULT_LOCK_TIMEOUT_MS).toBe(MIN);
  expect(LOCK_TIMEOUTS_MS).toContain(DEFAULT_LOCK_TIMEOUT_MS);
  expect(LOCK_TIMEOUTS_MS[0]).toBe(0);
});
