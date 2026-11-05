import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * A function whose identity never changes but which always runs the latest
 * version of `fn`. It lets a memoised row keep its props while the handler
 * behind them still sees current state.
 */
export function useStableCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback(((...args: Parameters<T>) => latest.current(...args)) as T, []);
}

/**
 * False until `active` is first true, then true for good. Keeps a closed sheet
 * out of the first render of a screen, and still lets it animate closed.
 */
export function useOpenedOnce(active: boolean): boolean {
  const opened = useRef(false);
  if (active) opened.current = true;
  return opened.current;
}
