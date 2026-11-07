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

/** Sdílené tajemství ECDH obou hráčů jako materiál pro HKDF. */
async function sharedMaterial(own: SessionKeyPair, peerPublicKey: string): Promise<CryptoKey> {
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
  return crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
}

/** Oba hráči spočítají stejný klíč; `context` (kód místnosti) ho váže na konkrétní místnost. */
export async function deriveSessionKey(
  own: SessionKeyPair,
  peerPublicKey: string,
  context: string,
): Promise<CryptoKey> {
  const material = await sharedMaterial(own, peerPublicKey);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(context), info: utf8('myenemy/session/v1') },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/**
 * Klíč pro hlášení výsledků kamarádům: ze stejného tajemství ECDH, jiná doména. Zprávy
 * zápasu jsou jen podepsané (ne šifrované) – kdo zná kód místnosti, vidí i seed. Klíč
 * zápasu proto vzniká z tohohle klíče, který mají jen oba hráči.
 */
export async function deriveReportKey(
  own: SessionKeyPair,
  peerPublicKey: string,
  context: string,
): Promise<CryptoKey> {
  const material = await sharedMaterial(own, peerPublicKey);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8(context), info: utf8('myenemy/match-report/v1') },
    material,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign'],
  );
}

/** Klíč zápasu (hex) pro hlášení výsledku – HMAC seedu zápasu klíčem z deriveReportKey. */
export async function matchReportKey(reportKey: CryptoKey, seed: string): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', reportKey, utf8(`myenemy/match|${seed}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Otisk veřejného klíče pro závazek v hello (SHA-256, hex). */
export async function commitPublicKey(publicKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(`myenemy/pub-commit/v1|${publicKey}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Kontrolní kód spojení (6 číslic) z obou veřejných klíčů a kódu místnosti. Oba hráči
 * vidí stejný, jen když mezi ně nikdo nevložil vlastní klíče (útok „muž uprostřed“).
 * Host svůj klíč odhalí až po welcome (v hello je jen závazek), takže útočník nemůže
 * dohledávat klíče, dokud kódy nevyjdou stejně – trefí se jen s pravděpodobností 1 : 10⁶.
 */
export async function pairingCode(
  ownPublicKey: string,
  peerPublicKey: string,
  context: string,
): Promise<string> {
  const [first, second] = [ownPublicKey, peerPublicKey].sort();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    utf8(`myenemy/pairing/v1|${context}|${first ?? ''}|${second ?? ''}`),
  );
  const value = new DataView(digest).getUint32(0) % 1_000_000;
  const digits = value.toString().padStart(6, '0');
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
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
