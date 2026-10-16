/**
 * Autentizace zpráv mezi dvěma hráči: ECDH (P-256) při spárování → HKDF → HMAC-SHA256.
 * Kdo jen poslouchá kanál místnosti, nemůže po spárování podvrhnout zprávy za soupeře.
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

const utf8 = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text);

export interface SessionKeyPair {
  readonly privateKey: CryptoKey;
  /** Veřejný klíč (raw, base64url) – posílá se v hello / welcome. */
  readonly publicKey: string;
}

export async function createKeyPair(): Promise<SessionKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, [
    'deriveBits',
  ]);
  const raw = await crypto.subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey: toBase64Url(new Uint8Array(raw)) };
}

/** Oba hráči spočítají stejný klíč; `context` (kód místnosti) ho váže na konkrétní místnost. */
export async function deriveSessionKey(
  own: SessionKeyPair,
  peerPublicKey: string,
  context: string,
): Promise<CryptoKey> {
  const peer = await crypto.subtle.importKey(
    'raw',
    fromBase64Url(peerPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peer },
    own.privateKey,
    256,
  );
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(context), info: utf8('myenemy/session/v1') },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

export async function signText(key: CryptoKey, text: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', key, utf8(text));
  return toBase64Url(new Uint8Array(mac));
}

export async function verifyText(key: CryptoKey, text: string, mac: string): Promise<boolean> {
  try {
    return await crypto.subtle.verify('HMAC', key, fromBase64Url(mac), utf8(text));
  } catch {
    return false;
  }
}
