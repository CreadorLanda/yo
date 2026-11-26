import nacl from 'tweetnacl';

import type { Store } from './store.js';

/**
 * ZwoSocial's end-to-end encryption, as a bot speaks it.
 *
 * A faithful port of the app's protocol (mobile/data/crypto): X25519 keys,
 * an X3DH-lite handshake, a root key per conversation with one secretbox key
 * per message counter, and group sender keys sealed to each member over the
 * pairwise session. Interoperability is the whole point, so every byte of
 * the derivations matches the app; change one and nothing decrypts.
 */

// ── Encoding ────────────────────────────────────────────────────────────────

export function toB64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array {
  return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ── Primitives (match mobile/data/crypto/primitives.ts) ─────────────────────

function hkdfLike(ikm: Uint8Array, info: string): Uint8Array {
  return nacl.hash(concat(ikm, enc.encode(info))).slice(0, 32);
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

// ── Keys ────────────────────────────────────────────────────────────────────

export type DeviceKeys = {
  identityPublic: string;
  identitySecret: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySecret: string;
  signedPreKeySignature: string;
  oneTimeSecrets: Record<string, string>;
  usedOtkSecrets: Record<string, string>;
  nextOtkId: number;
};

export type UploadKeysRequest = {
  identity_key: string;
  signed_pre_key: { key_id: number; public_key: string; signature: string };
  one_time_pre_keys: { key_id: number; public_key: string }[];
};

export type PreKeyBundle = {
  identity_key: string;
  signed_pre_key: { key_id: number; public_key: string; signature?: string };
  one_time_pre_key?: { key_id: number; public_key: string } | null;
};

export type SenderKeyEntry = { user_id: string; epoch: number; ciphertext: string };

/** What the crypto needs from the server; the bot client provides it. */
export interface KeyServer {
  uploadKeys(body: UploadKeysRequest): Promise<{ one_time_remaining: number }>;
  bundle(username: string): Promise<PreKeyBundle>;
  fetchSenderKeys(chatId: string): Promise<{ epoch: number; keys: SenderKeyEntry[] | null }>;
  publishSenderKeys(chatId: string, epoch: number, entries: { user_id: string; ciphertext: string }[]): Promise<void>;
}

const OTK_TARGET = 40;
const USED_OTK_RETAIN = 60;
const PAST_ROOT_RETAIN = 6;
const ENVELOPE = 'soc1.';
const GROUP_ENVELOPE = 'soc1g.';

function keyPair() {
  const kp = nacl.box.keyPair();
  return { publicKey: toB64url(kp.publicKey), secretKey: toB64url(kp.secretKey) };
}

function signSpk(identitySecret: string, spkPublic: string): string {
  const ik = fromB64url(identitySecret);
  const msg = fromB64url(spkPublic);
  const macKey = nacl.hash(ik).slice(0, 32);
  const nonce = nacl.hash(msg).slice(0, 24);
  return toB64url(nacl.secretbox(msg, nonce, macKey).slice(0, 64));
}

function freshOtkBase(): number {
  const b = nacl.randomBytes(4);
  return ((((b[0] << 23) | (b[1] << 15) | (b[2] << 7) | b[3]) >>> 0) % 0x7fff0000) + 1;
}

// ── Sessions ────────────────────────────────────────────────────────────────

type Session = {
  peerUserId: string;
  peerIdentityPublic: string;
  rootKey: string;
  sendN: number;
  recvN: number;
  establishedAt: string;
  handshake?: { ek: string; otkId?: number; spkId?: number };
  pastRoots?: string[];
};

type Header = { v: 1; ik: string; ek?: string; otk_id?: number; spk_id?: number; n: number };
type GroupHeader = { v: 1; s: string; e: number; n: number };
type GroupKey = { chatId: string; epoch: number; key: string; sendN: number };

export class DecryptError extends Error {}

/** One bot's keys and sessions. */
export class E2EE {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: Store,
    private readonly selfId: string,
    private readonly server: KeyServer,
  ) {}

  /** Serialise work per key: counters are crypto state and must not race. */
  private lock<T>(key: string, run: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(run, run);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  // ── Device keys ──

  async keys(): Promise<DeviceKeys> {
    const existing = await this.store.get<DeviceKeys>('keys');
    if (existing) return existing;
    const identity = keyPair();
    const spk = keyPair();
    const oneTimeSecrets: Record<string, string> = {};
    let nextOtkId = freshOtkBase();
    for (let i = 0; i < OTK_TARGET; i++) oneTimeSecrets[String(nextOtkId++)] = keyPair().secretKey;
    const fresh: DeviceKeys = {
      identityPublic: identity.publicKey,
      identitySecret: identity.secretKey,
      signedPreKeyId: 1,
      signedPreKeyPublic: spk.publicKey,
      signedPreKeySecret: spk.secretKey,
      signedPreKeySignature: signSpk(identity.secretKey, spk.publicKey),
      oneTimeSecrets,
      usedOtkSecrets: {},
      nextOtkId,
    };
    await this.store.set('keys', fresh);
    return fresh;
  }

  /** Publish the bundle; top up one-time keys when the server runs low. */
  async publishKeys(): Promise<void> {
    const k = await this.keys();
    const res = await this.server.uploadKeys(this.uploadBody(k, Object.entries(k.oneTimeSecrets)));
    if (res.one_time_remaining < 10) {
      const fresh: [string, string][] = [];
      for (let i = 0; i < OTK_TARGET; i++) {
        const id = String(k.nextOtkId++);
        k.oneTimeSecrets[id] = keyPair().secretKey;
        fresh.push([id, k.oneTimeSecrets[id]]);
      }
      await this.store.set('keys', k);
      await this.server.uploadKeys(this.uploadBody(k, fresh));
    }
  }

  private uploadBody(k: DeviceKeys, otks: [string, string][]): UploadKeysRequest {
    return {
      identity_key: k.identityPublic,
      signed_pre_key: { key_id: k.signedPreKeyId, public_key: k.signedPreKeyPublic, signature: k.signedPreKeySignature },
      one_time_pre_keys: otks.map(([id, secret]) => ({
        key_id: Number(id),
        public_key: toB64url(nacl.box.keyPair.fromSecretKey(fromB64url(secret)).publicKey),
      })),
    };
  }

  private async takeOtk(id: number): Promise<Uint8Array | null> {
    const k = await this.keys();
    const key = String(id);
    const live = k.oneTimeSecrets[key];
    if (live) {
      delete k.oneTimeSecrets[key];
      k.usedOtkSecrets[key] = live;
      const ids = Object.keys(k.usedOtkSecrets);
      for (const stale of ids.slice(0, Math.max(0, ids.length - USED_OTK_RETAIN))) delete k.usedOtkSecrets[stale];
      await this.store.set('keys', k);
      return fromB64url(live);
    }
    const spent = k.usedOtkSecrets[key];
    return spent ? fromB64url(spent) : null;
  }

  // ── Pairwise ──

  private sessionKey(peer: string) {
    return `session:${peer}`;
  }

  private async initiate(peerUserId: string, peerUsername: string): Promise<Session> {
    const k = await this.keys();
    const bundle = await this.server.bundle(peerUsername);
    const bobIk = fromB64url(bundle.identity_key);
    const bobSpk = fromB64url(bundle.signed_pre_key.public_key);
    const bobOtk = bundle.one_time_pre_key ? fromB64url(bundle.one_time_pre_key.public_key) : undefined;
    const ek = nacl.box.keyPair();
    const ik = fromB64url(k.identitySecret);
    const parts = [nacl.scalarMult(ik, bobSpk), nacl.scalarMult(ek.secretKey, bobIk), nacl.scalarMult(ek.secretKey, bobSpk)];
    if (bobOtk) parts.push(nacl.scalarMult(ek.secretKey, bobOtk));
    const session: Session = {
      peerUserId,
      peerIdentityPublic: bundle.identity_key,
      rootKey: toB64url(hkdfLike(concat(...parts), 'Socialize-X3DH-v1')),
      sendN: 0,
      recvN: 0,
      establishedAt: new Date().toISOString(),
      handshake: {
        ek: toB64url(ek.publicKey),
        otkId: bundle.one_time_pre_key?.key_id,
        spkId: bundle.signed_pre_key.key_id,
      },
    };
    await this.store.set(this.sessionKey(peerUserId), session);
    return session;
  }

  private async responderRoot(h: Header): Promise<Uint8Array | null> {
    if (!h.ek || !h.ik) return null;
    const k = await this.keys();
    if (h.ik === k.identityPublic) return null;
    const spk = fromB64url(k.signedPreKeySecret);
    const ik = fromB64url(k.identitySecret);
    const aliceIk = fromB64url(h.ik);
    const aliceEk = fromB64url(h.ek);
    const parts = [nacl.scalarMult(spk, aliceIk), nacl.scalarMult(ik, aliceEk), nacl.scalarMult(spk, aliceEk)];
    if (h.otk_id != null) {
      const otk = await this.takeOtk(h.otk_id);
      if (!otk) return null;
      parts.push(nacl.scalarMult(otk, aliceEk));
    }
    return hkdfLike(concat(...parts), 'Socialize-X3DH-v1');
  }

  /** Encrypt for one person (or a bot). `peerUsername` is needed for a first message. */
  encrypt(peerUserId: string, plaintext: string, peerUsername?: string): Promise<string> {
    return this.lock(this.sessionKey(peerUserId), async () => {
      let s = await this.store.get<Session>(this.sessionKey(peerUserId));
      if (!s) {
        if (!peerUsername) throw new Error('session_missing: a first message needs the peer username');
        s = await this.initiate(peerUserId, peerUsername);
      }
      const k = await this.keys();
      const n = s.sendN;
      const boxed = nacl.secretbox(enc.encode(plaintext), nonceFromCounter(n), messageKey(fromB64url(s.rootKey), n));
      const header: Header = { v: 1, ik: k.identityPublic, n };
      if (s.handshake) {
        header.ek = s.handshake.ek;
        if (s.handshake.otkId != null) header.otk_id = s.handshake.otkId;
        if (s.handshake.spkId != null) header.spk_id = s.handshake.spkId;
      }
      s.sendN = n + 1;
      await this.store.set(this.sessionKey(peerUserId), s);
      return `${ENVELOPE}${toB64url(enc.encode(JSON.stringify(header)))}.${toB64url(boxed)}`;
    });
  }

  /** Decrypt a pairwise envelope from `peerUserId`. Throws DecryptError when it cannot. */
  decrypt(peerUserId: string, content: string): Promise<string> {
    return this.lock(this.sessionKey(peerUserId), async () => {
      if (!content.startsWith(ENVELOPE)) throw new DecryptError('not an envelope');
      const rest = content.slice(ENVELOPE.length);
      const dot = rest.indexOf('.');
      if (dot < 0) throw new DecryptError('malformed envelope');
      let h: Header;
      try {
        h = JSON.parse(dec.decode(fromB64url(rest.slice(0, dot)))) as Header;
      } catch {
        throw new DecryptError('malformed header');
      }
      const body = fromB64url(rest.slice(dot + 1));
      const nonce = nonceFromCounter(h.n);

      let s = await this.store.get<Session>(this.sessionKey(peerUserId));
      if (!s && h.ek) {
        const root = await this.responderRoot(h);
        if (root && h.ik) {
          s = {
            peerUserId,
            peerIdentityPublic: h.ik,
            rootKey: toB64url(root),
            sendN: 0,
            recvN: 0,
            establishedAt: new Date().toISOString(),
          };
          await this.store.set(this.sessionKey(peerUserId), s);
        }
      }
      if (!s) throw new DecryptError('no session with this sender');

      let opened = nacl.secretbox.open(body, nonce, messageKey(fromB64url(s.rootKey), h.n));
      for (const old of s.pastRoots ?? []) {
        if (opened) break;
        opened = nacl.secretbox.open(body, nonce, messageKey(fromB64url(old), h.n));
      }
      if (!opened && h.ek && h.ik) {
        // The sender may have re-keyed: prove the new root on this very
        // message before it replaces the one that worked.
        const candidate = await this.responderRoot(h);
        if (candidate) {
          opened = nacl.secretbox.open(body, nonce, messageKey(candidate, h.n));
          if (opened) {
            const root = toB64url(candidate);
            s = {
              peerUserId,
              peerIdentityPublic: h.ik,
              rootKey: root,
              sendN: s.sendN,
              recvN: s.recvN,
              establishedAt: new Date().toISOString(),
              pastRoots: [s.rootKey, ...(s.pastRoots ?? [])].filter((r) => r !== root).slice(0, PAST_ROOT_RETAIN),
            };
          }
        }
      }
      if (!opened) throw new DecryptError('cannot decrypt');
      s.handshake = undefined;
      if (h.n >= s.recvN) s.recvN = h.n + 1;
      await this.store.set(this.sessionKey(peerUserId), s);
      return dec.decode(opened);
    });
  }

  // ── Groups ──

  private groupKey(chatId: string, sender: string, epoch: number) {
    return `group:${chatId}:${sender}:${epoch}`;
  }

  /**
   * Encrypt for a group (a bot with full read, or one that sends into the
   * group). The bot's sender key is made and sealed to every member the
   * first time in each epoch.
   */
  encryptForGroup(
    chatId: string,
    plaintext: string,
    epoch: number,
    members: { user_id: string; username?: string }[],
  ): Promise<string> {
    return this.lock(`group:${chatId}`, async () => {
      const key = this.groupKey(chatId, this.selfId, epoch);
      let rec = await this.store.get<GroupKey>(key);
      if (!rec) {
        rec = { chatId, epoch, key: toB64url(nacl.randomBytes(32)), sendN: 0 };
        const entries: { user_id: string; ciphertext: string }[] = [];
        for (const m of members) {
          if (m.user_id === this.selfId) continue;
          try {
            entries.push({ user_id: m.user_id, ciphertext: await this.encrypt(m.user_id, rec.key, m.username) });
          } catch {
            // A member without keys cannot read us until they publish some.
          }
        }
        if (entries.length === 0) throw new Error('no group member could be reached');
        await this.server.publishSenderKeys(chatId, epoch, entries);
        await this.store.set(key, rec);
      }
      const n = rec.sendN;
      const boxed = nacl.secretbox(enc.encode(plaintext), nonceFromCounter(n), messageKey(fromB64url(rec.key), n));
      rec.sendN = n + 1;
      await this.store.set(key, rec);
      const header: GroupHeader = { v: 1, s: this.selfId, e: epoch, n };
      return `${GROUP_ENVELOPE}${toB64url(enc.encode(JSON.stringify(header)))}.${toB64url(boxed)}`;
    });
  }

  /** Collect the sender keys addressed to this bot; returns the group's epoch. */
  async syncGroupKeys(chatId: string): Promise<number> {
    const res = await this.server.fetchSenderKeys(chatId);
    for (const k of res.keys ?? []) {
      const key = this.groupKey(chatId, k.user_id, k.epoch);
      if (await this.store.get(key)) continue;
      try {
        const opened = await this.decrypt(k.user_id, k.ciphertext);
        await this.store.set(key, { chatId, epoch: k.epoch, key: opened, sendN: 0 } satisfies GroupKey);
      } catch {
        // Not sealed to a session we hold; skip it.
      }
    }
    return res.epoch;
  }

  /** Decrypt a group envelope, syncing keys once if one is missing. */
  async decryptGroup(chatId: string, content: string): Promise<string> {
    if (!content.startsWith(GROUP_ENVELOPE)) throw new DecryptError('not a group envelope');
    const rest = content.slice(GROUP_ENVELOPE.length);
    const dot = rest.indexOf('.');
    if (dot < 0) throw new DecryptError('malformed envelope');
    let h: GroupHeader;
    try {
      h = JSON.parse(dec.decode(fromB64url(rest.slice(0, dot)))) as GroupHeader;
    } catch {
      throw new DecryptError('malformed header');
    }
    let rec = await this.store.get<GroupKey>(this.groupKey(chatId, h.s, h.e));
    if (!rec) {
      await this.syncGroupKeys(chatId);
      rec = await this.store.get<GroupKey>(this.groupKey(chatId, h.s, h.e));
    }
    if (!rec) throw new DecryptError('no sender key — the bot may not have full read here');
    const opened = nacl.secretbox.open(
      fromB64url(rest.slice(dot + 1)),
      nonceFromCounter(h.n),
      messageKey(fromB64url(rec.key), h.n),
    );
    if (!opened) throw new DecryptError('cannot decrypt');
    return dec.decode(opened);
  }
}

export function isEnvelope(s: string): boolean {
  return s.startsWith(ENVELOPE);
}

export function isGroupEnvelope(s: string): boolean {
  return s.startsWith(GROUP_ENVELOPE);
}
