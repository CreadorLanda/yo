import nacl from 'tweetnacl';

import './prng';

import { fetchSenderKeys, publishSenderKeys } from '@/data/api/groups';
import { getCurrentUser } from '@/data/auth-store';
import { excludedFromGroupKey } from '@/data/bot-store';
import { getSecret, setSecret } from '@/data/db/secrets';

import { b64urlToBytes, bytesToB64url, utf8Decode, utf8Encode } from './encoding';
import {
  E2EEUnavailable,
  asE2EEUnavailable,
  decryptFromPeer,
  encryptForPeerOrFail,
  messageKey,
  nonceFromCounter,
} from './session';

/**
 * Group encryption, by sender keys.
 *
 * Groups had none at all — the send path excluded them outright, so every
 * group message arrived at the server readable.
 *
 * Pairwise X3DH does not fit a group: encrypting each message once per member
 * means N ciphertexts on the wire and N ratchets to keep in step, and it gets
 * worse with every member. Instead each member holds one symmetric key for
 * the group, encrypts each message once with it, and seals that key to each
 * other member over the pairwise session that already exists. The server
 * moves sealed blobs it cannot open.
 *
 * The cost, stated plainly: a sender key does not ratchet forward like the
 * pairwise session does, so someone who obtains it can read everything sent
 * under it until the next rotation. Membership changes force a rotation,
 * which is what makes leaving a group mean anything.
 */

const GROUP_PREFIX = 'soc1g.';
const KEY_PREFIX = 'e2ee.group.v1.';

type GroupKeyRecord = {
  chatId: string;
  epoch: number;
  /** Base64url root key, 32 bytes. */
  key: string;
  /** Our send counter under this key. */
  sendN: number;
};

type GroupEnvelopeHeader = {
  v: 1;
  /** Sender's user id — which sender key opens this. */
  s: string;
  e: number;
  n: number;
};

/**
 * Storage key, namespaced by account like the pairwise sessions.
 *
 * Two accounts on one phone share one store; keyed by group alone, signing in
 * as someone else would load a key that account never received and fail every
 * message in the thread.
 */
function storeKey(chatId: string, senderId: string, epoch: number) {
  const self = getCurrentUser()?.id ?? 'anon';
  return `${KEY_PREFIX}${self}.${chatId}.${senderId}.${epoch}`;
}

export function isGroupEnvelope(content: string): boolean {
  return content.startsWith(GROUP_PREFIX);
}

/**
 * Current key epoch per group, as last seen from the server.
 *
 * Held in memory so sending does not cost a round trip to ask which
 * generation is current. Refreshed by syncGroupKeys, which the chat screen
 * runs on open and again whenever a message arrives that it cannot read —
 * the two moments when being a generation behind actually matters.
 */
const epochCache = new Map<string, number>();

export async function groupEpoch(chatId: string): Promise<number> {
  const known = epochCache.get(chatId);
  if (known != null) return known;
  try {
    const res = await fetchSenderKeys(chatId);
    epochCache.set(chatId, res.epoch);
    return res.epoch;
  } catch (err) {
    // Named rather than raw: this is the call that failed with a bare
    // http_404 when the endpoint was missing, and "failed" told nobody
    // anything.
    throw asE2EEUnavailable(err);
  }
}

/** Drop cached epochs — call on logout so nothing outlives the account. */
export function clearGroupKeyCache(): void {
  epochCache.clear();
}

/**
 * Forget the cached epoch for one group.
 *
 * Called when the membership changes. Holding a stale epoch is not a
 * cosmetic problem: the sender would keep encrypting under the generation
 * the removed member still holds, so removing someone would not actually
 * stop them reading.
 */
export function invalidateGroupEpoch(chatId: string): void {
  epochCache.delete(chatId);
}

async function loadKey(
  chatId: string,
  senderId: string,
  epoch: number,
): Promise<GroupKeyRecord | null> {
  const raw = await getSecret(storeKey(chatId, senderId, epoch));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GroupKeyRecord;
  } catch {
    return null;
  }
}

async function saveKey(senderId: string, rec: GroupKeyRecord): Promise<void> {
  await setSecret(storeKey(rec.chatId, senderId, rec.epoch), JSON.stringify(rec));
}

/**
 * Our own sending key for this group at this epoch, creating and
 * distributing it the first time.
 *
 * Distribution happens before the key is used, not after: a key nobody has
 * received produces messages nobody can read, and the sender has no way to
 * find that out.
 */
async function ownKey(
  chatId: string,
  epoch: number,
  members: { user_id: string; username?: string }[],
): Promise<GroupKeyRecord> {
  const me = getCurrentUser()?.id;
  if (!me) throw new E2EEUnavailable('local_keys_missing');

  const existing = await loadKey(chatId, me, epoch);
  if (existing) return existing;

  const rec: GroupKeyRecord = {
    chatId,
    epoch,
    key: bytesToB64url(nacl.randomBytes(32)),
    sendN: 0,
  };

  // Sealed to each member with the pairwise session — the same envelope a
  // direct message uses, so the server sees the same opaque string here as
  // it does there.
  // ADR 0002: a bot in privacy mode never holds the group key. The server
  // drops such entries too; leaving them out here saves sealing them.
  const excluded = await excludedFromGroupKey(chatId);
  const entries: { user_id: string; ciphertext: string }[] = [];
  for (const m of members) {
    if (m.user_id === me || excluded.has(m.user_id)) continue;
    try {
      entries.push({
        user_id: m.user_id,
        ciphertext: await encryptForPeerOrFail(m.user_id, rec.key, {
          peerUsername: m.username,
        }),
      });
    } catch {
      // One member without a usable session must not stop the group. They
      // will not be able to read us until their next key exchange, which is
      // better than nobody being able to.
      continue;
    }
  }
  if (entries.length === 0) {
    // Nobody could be reached. Sending now would produce messages no one can
    // open, which is worse than not sending.
    throw new E2EEUnavailable('peer_has_no_keys');
  }

  try {
    await publishSenderKeys(chatId, epoch, entries);
  } catch (err) {
    throw asE2EEUnavailable(err);
  }
  // Saved only after the distribution lands. Storing it first would leave us
  // encrypting under a key the others were never given.
  await saveKey(me, rec);
  return rec;
}

/**
 * Serialises encryption per group.
 *
 * The counter is read, used, incremented and written back. Two sends racing
 * would both read the same n and encrypt under the same key and nonce — and
 * reusing a nonce with secretbox leaks the xor of the two plaintexts to
 * anyone holding both messages. Forwarding to several chats at once, or a
 * fast double tap, is enough to hit it.
 */
const sendLocks = new Map<string, Promise<unknown>>();

function withSendLock<T>(chatId: string, run: () => Promise<T>): Promise<T> {
  const prev = sendLocks.get(chatId) ?? Promise.resolve();
  const next = prev.then(run, run);
  // Swallow here only: the caller still gets the real rejection from `next`.
  sendLocks.set(
    chatId,
    next.catch(() => undefined),
  );
  return next;
}

/** Encrypt a body for a group, or refuse. */
export async function encryptForGroup(
  chatId: string,
  plaintext: string,
  members: { user_id: string; username?: string }[],
  epoch: number,
): Promise<string> {
  const me = getCurrentUser()?.id;
  if (!me) throw new E2EEUnavailable('local_keys_missing');

  return withSendLock(chatId, async () => {
    const rec = await ownKey(chatId, epoch, members);
    const root = b64urlToBytes(rec.key);
    const n = rec.sendN;
    const boxed = nacl.secretbox(utf8Encode(plaintext), nonceFromCounter(n), messageKey(root, n));
    if (!boxed) throw new E2EEUnavailable('failed');

    // Written before the envelope is handed out, so a counter is never
    // reused even if the send that follows fails.
    rec.sendN = n + 1;
    await saveKey(me, rec);

    const header: GroupEnvelopeHeader = { v: 1, s: me, e: epoch, n };
    return `${GROUP_PREFIX}${bytesToB64url(utf8Encode(JSON.stringify(header)))}.${bytesToB64url(boxed)}`;
  });
}

/**
 * Pull every sender key addressed to us in this group and store it.
 *
 * Called when a message turns up that we have no key for. The alternative —
 * a realtime announcement whenever someone distributes — would need the hub
 * wired into the groups module for a signal that arrives moments before the
 * message that implies it anyway.
 */
export async function syncGroupKeys(chatId: string): Promise<number> {
  const res = await fetchSenderKeys(chatId);
  epochCache.set(chatId, res.epoch);
  for (const k of res.keys ?? []) {
    if (await loadKey(chatId, k.user_id, k.epoch)) continue;
    let key: string;
    try {
      // Sealed with the pairwise session, so opening it is an ordinary
      // direct-message decrypt.
      key = await decryptFromPeer(k.user_id, k.ciphertext);
    } catch {
      continue;
    }
    if (!key || key === k.ciphertext) continue; // never opened
    await saveKey(k.user_id, { chatId, epoch: k.epoch, key, sendN: 0 });
  }
  return res.epoch;
}

/**
 * Decrypt a group envelope.
 *
 * Returns null when the key is missing, so the caller can sync and retry once
 * rather than this function silently returning the ciphertext — which is how
 * an unreadable message ends up rendered as gibberish instead of as a message
 * that needs a key.
 */
export async function decryptFromGroup(
  chatId: string,
  content: string,
): Promise<string | null> {
  if (!isGroupEnvelope(content)) return content;

  const rest = content.slice(GROUP_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) return null;

  let header: GroupEnvelopeHeader;
  try {
    header = JSON.parse(utf8Decode(b64urlToBytes(rest.slice(0, dot)))) as GroupEnvelopeHeader;
  } catch {
    return null;
  }

  const rec = await loadKey(chatId, header.s, header.e);
  if (!rec) return null;

  const opened = nacl.secretbox.open(
    b64urlToBytes(rest.slice(dot + 1)),
    nonceFromCounter(header.n),
    messageKey(b64urlToBytes(rec.key), header.n),
  );
  return opened ? utf8Decode(opened) : null;
}
