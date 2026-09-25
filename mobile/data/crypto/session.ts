import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';

// tweetnacl has no random source in React Native without this.
import './prng';

import {
  bundleForUsername,
  identityForUsername,
  type PreKeyBundle,
} from '@/data/api/keys';
import { ApiError } from '@/data/api/client';
import { getCurrentUser } from '@/data/auth-store';

import {
  getIdentityPublic,
  getIdentitySecret,
  getSignedPreKeySecret,
  takeOtkSecret,
} from './device-keys';
import { b64urlToBytes, bytesToB64url, utf8Decode, utf8Encode } from './encoding';

const SESSION_PREFIX = 'e2ee.session.v1.';
const ENVELOPE_PREFIX = 'soc1.';

export type SessionRecord = {
  peerUserId: string;
  peerIdentityPublic: string;
  /** Shared 32-byte key (base64url). */
  rootKey: string;
  /** Monotonic send counter for simple ratchet. */
  sendN: number;
  recvN: number;
  establishedAt: string;
  /**
   * The handshake the peer needs in order to derive this same root.
   *
   * Persisted, and repeated on every outbound message until the peer proves
   * they have the session by sending something we can open. It used to live
   * in a process-local Map and ride only on message zero, which lost it to
   * any reload between establishing a session and sending — the peer then
   * received envelopes it had no way to build a session from, forever.
   *
   * Only public material: the ephemeral secret is consumed deriving the root
   * and is never needed again.
   */
  handshake?: {
    ek: string;
    otkId?: number;
    spkId?: number;
  };
  /**
   * Roots this conversation previously used, newest first.
   *
   * There is one root per session, but a conversation can legitimately go
   * through several: both sides initiating before either has received turns
   * up two, and any re-key adds another. Whoever adopts the other's root
   * then cannot read what it sent under its own — which reads as "I can see
   * their messages but not mine", with nothing obviously wrong.
   *
   * Keeping the old ones costs a few hundred bytes and makes history
   * readable across every re-key the conversation has been through.
   */
  pastRoots?: string[];
};

/** How many superseded roots to keep for reading history. */
const PAST_ROOT_RETAIN = 6;

export type EnvelopeHeader = {
  v: 1;
  /** Sender identity public (X25519). */
  ik: string;
  /** Ephemeral public for this message (first msg) or omitted for ratchet. */
  ek?: string;
  /** Optional OTK id the sender consumed from the recipient's bundle. */
  otk_id?: number;
  spk_id?: number;
  n: number; // message number
};

/**
 * Storage key for a peer's session, namespaced by the signed-in account.
 *
 * Two accounts on one device share one keychain. Keyed by peer alone, account
 * B would load the session account A had established with a shared peer and
 * decrypt with an identity the peer never ratcheted against — every message
 * in that thread fails. Logging out cannot fix that on its own, because
 * SecureStore has no way to enumerate keys for deletion. Namespacing makes
 * the collision impossible instead of relying on a cleanup that cannot run.
 */
function sessionKey(peerUserId: string) {
  const self = getCurrentUser()?.id ?? 'anon';
  return `${SESSION_PREFIX}${self}.${peerUserId}`;
}

/**
 * In-memory session cache.
 *
 * Every decrypt used to hit SecureStore, which on Android is a serialized
 * round trip to the keystore. Opening a 50-message thread meant 50 of them
 * back to back, and the chat list did the same per row — that is where the
 * lag came from once encryption actually started running.
 *
 * Sessions are small and rarely change, so keeping them in memory for the
 * life of the process is safe. Cleared on logout via clearSessionCache().
 */
const sessionCache = new Map<string, SessionRecord | null>();

// A direct-message counter is part of the cryptographic state. Serialise
// sends per peer so two rapid sends cannot both read the same counter and
// reuse the same secretbox nonce.
const peerSendLocks = new Map<string, Promise<unknown>>();

function withPeerSendLock<T>(peerUserId: string, run: () => Promise<T>): Promise<T> {
  const previous = peerSendLocks.get(peerUserId) ?? Promise.resolve();
  const next = previous.then(run, run);
  peerSendLocks.set(peerUserId, next.catch(() => undefined));
  return next;
}

export async function loadSession(peerUserId: string): Promise<SessionRecord | null> {
  // Cache under the namespaced key too — keyed by peer alone it would carry
  // account A's session into account B for the life of the process, which is
  // the same collision the storage key namespacing exists to prevent.
  const k = sessionKey(peerUserId);
  if (sessionCache.has(k)) return sessionCache.get(k) ?? null;

  const raw = await SecureStore.getItemAsync(k);
  let parsed: SessionRecord | null = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw) as SessionRecord;
    } catch {
      parsed = null;
    }
  }
  sessionCache.set(k, parsed);
  return parsed;
}

/** Drop cached sessions — call on logout so nothing outlives the account. */
export function clearSessionCache(): void {
  sessionCache.clear();
}

async function saveSession(s: SessionRecord): Promise<void> {
  const k = sessionKey(s.peerUserId);
  await SecureStore.setItemAsync(k, JSON.stringify(s));
  // Keep the cache honest: a stale entry here would decrypt with the old
  // key and silently fail every message after a rekey.
  sessionCache.set(k, s);
}

/**
 * The label below is part of key derivation, not branding. Renaming it
 * changes every derived key and makes existing sessions — and every
 * message already encrypted under them — undecryptable. It stays as-is
 * regardless of what the product is called. DO NOT RENAME.
 */
/**
 * Derive a purpose-bound secret from an existing session root.
 *
 * Used for call media keys. The label separates purposes: a key derived for
 * a call must not equal the one protecting messages, so that compromising
 * one does not hand over the other.
 */
export function deriveSharedSecret(root: Uint8Array, label: string): Uint8Array {
  return hkdfLike(root, label);
}

function hkdfLike(ikm: Uint8Array, info: string): Uint8Array {
  // Simple expand: hash(ikm || info) then hash again for 32 bytes.
  const infoBytes = utf8Encode(info);
  const buf = new Uint8Array(ikm.length + infoBytes.length);
  buf.set(ikm, 0);
  buf.set(infoBytes, ikm.length);
  return nacl.hash(buf).slice(0, 32);
}

/**
 * X3DH-lite: DH(IKa, SPKb) || DH(EKa, IKb) || DH(EKa, SPKb) [|| DH(EKa, OTKb)]
 */
function deriveRoot(
  aliceIkSecret: Uint8Array,
  aliceEkSecret: Uint8Array,
  bobIkPublic: Uint8Array,
  bobSpkPublic: Uint8Array,
  bobOtkPublic?: Uint8Array,
): Uint8Array {
  const dh1 = nacl.scalarMult(aliceIkSecret, bobSpkPublic);
  const dh2 = nacl.scalarMult(aliceEkSecret, bobIkPublic);
  const dh3 = nacl.scalarMult(aliceEkSecret, bobSpkPublic);
  let cat = new Uint8Array(dh1.length + dh2.length + dh3.length);
  cat.set(dh1, 0);
  cat.set(dh2, dh1.length);
  cat.set(dh3, dh1.length + dh2.length);
  if (bobOtkPublic) {
    const dh4 = nacl.scalarMult(aliceEkSecret, bobOtkPublic);
    const next = new Uint8Array(cat.length + dh4.length);
    next.set(cat, 0);
    next.set(dh4, cat.length);
    cat = next;
  }
  return hkdfLike(cat, 'Socialize-X3DH-v1');
}

/** Initiator: fetch peer bundle and establish a session. */
export async function establishSessionAsInitiator(
  peerUserId: string,
  peerUsername: string,
): Promise<SessionRecord> {
  const existing = await loadSession(peerUserId);
  if (existing) return existing;

  const ikSecret = await getIdentitySecret();
  const ikPublic = await getIdentityPublic();
  if (!ikSecret || !ikPublic) {
    throw new Error('local_keys_missing');
  }

  const bundle: PreKeyBundle = await bundleForUsername(peerUsername);
  const bobIk = b64urlToBytes(bundle.identity_key);
  const bobSpk = b64urlToBytes(bundle.signed_pre_key.public_key);
  const bobOtk = bundle.one_time_pre_key
    ? b64urlToBytes(bundle.one_time_pre_key.public_key)
    : undefined;

  const ek = nacl.box.keyPair();
  const root = deriveRoot(ikSecret, ek.secretKey, bobIk, bobSpk, bobOtk);

  const session: SessionRecord = {
    peerUserId,
    peerIdentityPublic: bundle.identity_key,
    rootKey: bytesToB64url(root),
    sendN: 0,
    recvN: 0,
    establishedAt: new Date().toISOString(),
    // Stored, not stashed in memory: this has to survive a restart, because
    // without it the peer can never derive the matching root.
    handshake: {
      ek: bytesToB64url(ek.publicKey),
      otkId: bundle.one_time_pre_key?.key_id,
      spkId: bundle.signed_pre_key.key_id,
    },
  };
  await saveSession(session);

  return session;
}

/**
 * Responder: peer sent an envelope with header.ek — derive session from
 * our SPK/OTK secrets + their IK/EK.
 */
/**
 * Derive the responder's root from an envelope header, without storing
 * anything.
 *
 * Kept separate from establishSessionAsResponder so a *candidate* root can be
 * tested against the ciphertext before it is allowed to replace a working
 * session. Committing first and checking later means a derivation that turns
 * out to be wrong has already destroyed the session that worked.
 */
async function deriveResponderRoot(header: EnvelopeHeader): Promise<Uint8Array | null> {
  if (!header.ek || !header.ik) return null;

  // Never treat our own outbound envelope as an inbound handshake. Its `ik`
  // and `ek` are ours, so this would derive a root from our own keys on both
  // sides of every DH — garbage that matches nothing.
  const ownIk = await getIdentityPublic();
  if (ownIk && header.ik === ownIk) return null;

  const spkSecret = await getSignedPreKeySecret();
  const ikSecret = await getIdentitySecret();
  if (!spkSecret || !ikSecret) return null;

  const aliceIk = b64urlToBytes(header.ik);
  const aliceEk = b64urlToBytes(header.ek);

  // Mirror of initiator DHs with roles swapped:
  // dh1 = DH(SPKb, IKa) = DH(IKa, SPKb)
  // dh2 = DH(IKb, EKa)
  // dh3 = DH(SPKb, EKa)
  // dh4 = DH(OTKb, EKa)
  const dh1 = nacl.scalarMult(spkSecret, aliceIk);
  const dh2 = nacl.scalarMult(ikSecret, aliceEk);
  const dh3 = nacl.scalarMult(spkSecret, aliceEk);
  let cat = new Uint8Array(dh1.length + dh2.length + dh3.length);
  cat.set(dh1, 0);
  cat.set(dh2, dh1.length);
  cat.set(dh3, dh1.length + dh2.length);

  if (header.otk_id != null) {
    const otkSecret = await takeOtkSecret(header.otk_id);
    // The initiator folded this DH into its root key. Deriving without it
    // does not fail here — it silently produces a *different* root key, so
    // every message in the thread then fails to open with no indication of
    // why. Refusing the session is the honest outcome: the sender can fetch
    // a fresh bundle, whereas a mismatched session is unrecoverable.
    if (!otkSecret) return null;
    const dh4 = nacl.scalarMult(otkSecret, aliceEk);
    const next = new Uint8Array(cat.length + dh4.length);
    next.set(cat, 0);
    next.set(dh4, cat.length);
    cat = next;
  }

  return hkdfLike(cat, 'Socialize-X3DH-v1');
}

/**
 * Responder: peer sent an envelope with header.ek — derive session from
 * our SPK/OTK secrets + their IK/EK.
 */
export async function establishSessionAsResponder(
  peerUserId: string,
  header: EnvelopeHeader,
): Promise<SessionRecord | null> {
  const existing = await loadSession(peerUserId);
  if (existing) return existing;

  const root = await deriveResponderRoot(header);
  if (!root || !header.ik) return null;

  const session: SessionRecord = {
    peerUserId,
    peerIdentityPublic: header.ik,
    rootKey: bytesToB64url(root),
    sendN: 0,
    recvN: 0,
    establishedAt: new Date().toISOString(),
  };
  await saveSession(session);
  return session;
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

export function isEnvelope(content: string): boolean {
  return content.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt plaintext for peer. May include X3DH header on first message. */
export async function encryptForPeer(
  peerUserId: string,
  plaintext: string,
  opts?: { peerUsername?: string },
): Promise<string> {
	return withPeerSendLock(peerUserId, async () => {
		let session = await loadSession(peerUserId);
		if (!session && opts?.peerUsername) {
			session = await establishSessionAsInitiator(peerUserId, opts.peerUsername);
		}
		if (!session) {
			throw new Error('session_missing');
		}

		const ikPublic = await getIdentityPublic();
		if (!ikPublic) throw new Error('local_keys_missing');

		const root = b64urlToBytes(session.rootKey);
		const n = session.sendN;
		const mk = messageKey(root, n);
		const nonce = nonceFromCounter(n);
		const boxed = nacl.secretbox(utf8Encode(plaintext), nonce, mk);
		if (!boxed) throw new Error('encrypt_failed');

		const header: EnvelopeHeader = {
			v: 1,
			ik: ikPublic,
			n,
		};
		// Repeat the handshake until the peer proves they can decrypt, rather than
		// sending it once on message zero. Anything can drop the first message —
		// a reload, a chat never opened, the parallel decrypt below racing past
		// it — and every message after that was unrecoverable for the peer.
		if (session.handshake) {
			header.ek = session.handshake.ek;
			if (session.handshake.otkId != null) header.otk_id = session.handshake.otkId;
			if (session.handshake.spkId != null) header.spk_id = session.handshake.spkId;
		}

		session.sendN = n + 1;
		await saveSession(session);

		const headerB64 = bytesToB64url(utf8Encode(JSON.stringify(header)));
		const bodyB64 = bytesToB64url(boxed);
		return `${ENVELOPE_PREFIX}${headerB64}.${bodyB64}`;
	});
}

/** Decrypt an envelope. Falls back to raw content if not encrypted. */
export async function decryptFromPeer(
  peerUserId: string,
  content: string,
): Promise<string> {
  if (!isEnvelope(content)) return content;

  const rest = content.slice(ENVELOPE_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) return content;
  let header: EnvelopeHeader;
  try {
    header = JSON.parse(utf8Decode(b64urlToBytes(rest.slice(0, dot)))) as EnvelopeHeader;
  } catch {
    return content;
  }
  const body = b64urlToBytes(rest.slice(dot + 1));

  let session = await loadSession(peerUserId);
  if (!session && header.ek) {
    session = await establishSessionAsResponder(peerUserId, header);
  }
  if (!session) {
    return '[encrypted message — missing keys]';
  }

  const nonce = nonceFromCounter(header.n);
  let opened = nacl.secretbox.open(body, nonce, messageKey(b64urlToBytes(session.rootKey), header.n));

  // Then anything this conversation used before. Our own older messages were
  // encrypted under whichever root was current at the time, and adopting the
  // peer's root must not make them unreadable.
  if (!opened) {
    for (const old of session.pastRoots ?? []) {
      opened = nacl.secretbox.open(body, nonce, messageKey(b64urlToBytes(old), header.n));
      if (opened) break;
    }
  }

  // A session that cannot open an envelope carrying a full handshake may be
  // stale rather than the message corrupt: the peer re-keyed and derived a
  // new root while we kept the old one.
  //
  // The candidate is proved against this very ciphertext before it is stored.
  // Replacing the session first and checking afterwards meant a single
  // unreadable message — one left over from an older key generation, sitting
  // at the top of the thread — destroyed a working session and took every
  // later message with it. deriveResponderRoot also refuses our own outbound
  // envelopes, whose ik/ek are ours and would derive pure noise.
  if (!opened && header.ek && header.ik) {
    const candidate = await deriveResponderRoot(header);
    if (candidate) {
      opened = nacl.secretbox.open(body, nonce, messageKey(candidate, header.n));
      if (opened) {
        const superseded = [session.rootKey, ...(session.pastRoots ?? [])]
          .filter((r) => r !== bytesToB64url(candidate))
          .slice(0, PAST_ROOT_RETAIN);
        session = {
          peerUserId,
          peerIdentityPublic: header.ik,
          rootKey: bytesToB64url(candidate),
          // Carry the send counter forward. Resetting it would reuse nonces
          // under the new root only if it were also reused for sending, but
          // more practically it makes our next message collide with one the
          // peer has already seen at that index.
          sendN: session.sendN,
          recvN: session.recvN,
          establishedAt: new Date().toISOString(),
          pastRoots: superseded,
        };
        await saveSession(session);
      }
    }
  }

  if (!opened) {
    return '[encrypted message — cannot decrypt]';
  }

  // Opening proves the peer holds this root, so our own handshake has landed
  // and no longer needs repeating on every message we send.
  if (session.handshake) {
    session.handshake = undefined;
    await saveSession(session);
  }

  if (header.n >= session.recvN) {
    session.recvN = header.n + 1;
    await saveSession(session);
  }
  return utf8Decode(opened);
}

/**
 * Drop the stored session if the peer no longer publishes the identity it
 * was established against.
 *
 * A session is bound to one identity. When the peer reinstalls, signs in
 * again, or regenerates their keys, everything we encrypt under the old
 * session is undecryptable for them — and nothing on this side notices,
 * because encryption keeps succeeding. The receiver just sees "missing
 * keys" forever while the sender believes the thread is healthy.
 *
 * Returns true when a stale session was discarded, so callers can tell the
 * difference between "checked, fine" and "the peer's identity changed".
 */
export async function ensurePeerIdentityCurrent(
  peerUserId: string,
  peerUsername: string,
): Promise<boolean> {
  const session = await loadSession(peerUserId);
  if (!session) return false;

  let current: string;
  try {
    current = (await identityForUsername(peerUsername)).identity_key;
  } catch {
    // Offline, or the peer has published nothing yet. Keeping the session is
    // the safer default: discarding it on a network blip would force a
    // needless re-key and burn one of their one-time keys.
    return false;
  }

  if (current === session.peerIdentityPublic) return false;
  await clearSession(peerUserId);
  return true;
}

export async function clearSession(peerUserId: string): Promise<void> {
  const k = sessionKey(peerUserId);
  await SecureStore.deleteItemAsync(k);
  sessionCache.delete(k);
}

/**
 * Why a message could not be encrypted.
 *
 * The three send paths used to catch the failure and send the plaintext
 * instead, each with a comment guessing that the peer had no bundle yet.
 * Nobody had checked: the error was swallowed before it could be read, so
 * the guess had never been either confirmed or contradicted. A reason that
 * is never recorded is a reason nobody can act on.
 */
export class E2EEUnavailable extends Error {
  constructor(
    readonly reason:
      | 'peer_has_no_keys'
      | 'peer_unknown'
      | 'offline'
      | 'local_keys_missing'
      // The endpoint answered in a way that means the server is wrong, not
      // the peer — a missing route, a rejected body. Worth its own reason
      // because the fix is on the server, not on anyone's phone.
      | 'server'
      | 'failed',
    readonly cause?: unknown,
  ) {
    super(`e2ee_unavailable:${reason}`);
  }
}

/**
 * Encrypt for a peer, or refuse.
 *
 * There is no plaintext path out of here. A messenger that quietly downgrades
 * when encryption fails offers a promise it does not keep — and the person
 * affected is the one who never finds out, since the sender's screen looks
 * identical either way.
 */
export async function encryptForPeerOrFail(
  peerUserId: string,
  plaintext: string,
  opts?: { peerUsername?: string },
): Promise<string> {
  if (!opts?.peerUsername) {
    // Without a username there is no bundle to fetch, so a first message to
    // this peer can never be encrypted. Worth naming separately: it is a bug
    // in whatever opened the chat, not a problem with the peer.
    const existing = await loadSession(peerUserId);
    if (!existing) throw new E2EEUnavailable('peer_unknown');
  }
  try {
    return await encryptForPeer(peerUserId, plaintext, opts);
  } catch (err) {
    throw new E2EEUnavailable(classify(err), err);
  }
}

/**
 * Turn any failure into one that names itself.
 *
 * A group send that hit a missing endpoint reported `send blocked: failed
 * [Error: http_404]` — the reason was the fallback, because the group path
 * threw the raw API error and only the pairwise path was classified. "failed"
 * says nothing, and a 404 on an endpoint is a very different problem from a
 * peer without keys.
 */
export function asE2EEUnavailable(err: unknown): E2EEUnavailable {
  if (err instanceof E2EEUnavailable) return err;
  return new E2EEUnavailable(classify(err), err);
}

function classify(err: unknown): E2EEUnavailable['reason'] {
  const msg = err instanceof Error ? err.message : '';
  if (msg === 'local_keys_missing') return 'local_keys_missing';
  if (msg === 'session_missing') return 'peer_unknown';
  if (err instanceof ApiError) {
    // 404 is the peer having published nothing yet — an old client, or an
    // account that has not opened the app since key publishing existed.
    if (err.status === 404) return 'peer_has_no_keys';
    // 5xx and network-level codes are the server's problem, not the peer's.
    if (err.status >= 500 || err.status === 0) return 'offline';
    return 'server';
  }
  // fetch rejects rather than resolving when the request never left.
  if (err instanceof TypeError) return 'offline';
  return 'failed';
}
