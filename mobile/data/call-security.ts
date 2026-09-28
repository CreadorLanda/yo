export type CallSecurityState = 'encrypted' | 'group-unencrypted' | 'unencrypted';

/** Classify what the call screen can truthfully tell the person using it. */
export function getCallSecurityState(
  isGroup: boolean,
  e2eeKey: string | null,
): CallSecurityState {
  if (e2eeKey) return 'encrypted';
  return isGroup ? 'group-unencrypted' : 'unencrypted';
}
