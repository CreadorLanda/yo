import nacl from 'tweetnacl';

import { utf8Encode } from './encoding';

/**
 * Purpose-bound expansion for message keys. Kept independent from storage and
 * transport so the recovery proof can exercise the production construction.
 */
function hkdfLike(ikm: Uint8Array, info: string): Uint8Array {
  const infoBytes = utf8Encode(info);
  const buf = new Uint8Array(ikm.length + infoBytes.length);
  buf.set(ikm, 0);
  buf.set(infoBytes, ikm.length);
  return nacl.hash(buf).slice(0, 32);
}

export function messageKey(root: Uint8Array, n: number): Uint8Array {
  return hkdfLike(root, `msg-${n}`);
}

export function nonceFromCounter(n: number): Uint8Array {
  const nonce = new Uint8Array(24);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, n, false);
  view.setUint32(4, 0x534f4349 /* SOCI */, false);
  return nonce;
}
