import { canonicalJson } from './canonicalJson';

export const SALT_BYTES = 32;
const HEX_64 = /^[0-9a-f]{64}$/;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return toHex(buffer);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/** Sůl má pevnou délku, takže spojení „sůl:data“ je jednoznačné. */
function preimage(value: unknown, salt: string): string {
  return `${salt}:${canonicalJson(value)}`;
}

export interface Commitment<T> {
  /** SHA-256(sůl ‖ data) – posílá se hned. */
  readonly hash: string;
  /** Data a sůl – drží si je jen autor a odhalí je až později. */
  readonly value: T;
  readonly salt: string;
}

export async function commit<T>(value: T): Promise<Commitment<T>> {
  const salt = randomHex(SALT_BYTES);
  return { hash: await sha256Hex(preimage(value, salt)), value, salt };
}

export async function verifyCommit(hash: string, value: unknown, salt: string): Promise<boolean> {
  if (!HEX_64.test(hash) || !HEX_64.test(salt)) return false;
  try {
    return (await sha256Hex(preimage(value, salt))) === hash;
  } catch {
    return false;
  }
}

/** Společný seed z příspěvků obou hráčů – žádný z nich ho sám neovlivní. */
export function combineSeeds(seedA: string, seedB: string): Promise<string> {
  return sha256Hex(`myenemy-seed|${seedA}|${seedB}`);
}
