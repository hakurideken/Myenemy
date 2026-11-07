import { z } from 'zod';
import type { Profile } from './account';

/** Kamarád se skóre zápasů z mého pohledu. */
export interface Friend extends Profile {
  readonly id: string;
  readonly wins: number;
  readonly losses: number;
}

export interface FriendRequest extends Profile {
  /** Id žádosti (ne účtu) – odesílatel se nedozví identifikátor adresáta. */
  readonly id: string;
  /** true = žádost přišla mně, false = poslal jsem ji já. */
  readonly incoming: boolean;
}

export type SendRequestResult =
  'sent' | 'accepted' | 'already-friends' | 'already-sent' | 'not-found' | 'self' | 'no-profile';

export type ReportResult = 'pending' | 'recorded' | 'ignored';

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const nickname = z.string().min(1).max(64);
const tag = z.number().int().min(1).max(9999);

export const friendsSchema = z
  .array(
    z.object({
      id: uuid,
      nickname,
      tag,
      wins: z.number().int().min(0),
      losses: z.number().int().min(0),
    }),
  )
  .max(1000);

export const friendRequestsSchema = z
  .array(z.object({ id: uuid, nickname, tag, incoming: z.boolean() }))
  .max(200);

export const sendRequestResultSchema = z.enum([
  'sent',
  'accepted',
  'already-friends',
  'already-sent',
  'not-found',
  'self',
  'no-profile',
]);
export const reportResultSchema = z.enum(['pending', 'recorded', 'ignored']);

export function isUserId(value: string): boolean {
  return uuid.safeParse(value).success;
}

/**
 * „Pepa#0042“ → přezdívka a kód. Kód 1–4 číslice (i bez úvodních nul), mezery kolem
 * se ořežou. Přezdívka se tu nekontroluje – stačí, že ji pozná server.
 */
export function parseHandle(input: string): Profile | null {
  const text = input.normalize('NFC').trim();
  const at = text.lastIndexOf('#');
  if (at <= 0) return null;
  const name = text.slice(0, at).trim();
  const code = text.slice(at + 1).trim();
  if (!/^\d{1,4}$/.test(code)) return null;
  const value = Number(code);
  if (value < 1 || value > 9999 || name.length < 1 || name.length > 64) return null;
  return { nickname: name, tag: value };
}
