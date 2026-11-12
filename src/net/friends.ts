import { z } from 'zod';
import type { Profile } from './account';

/** online = je ve hře (ne v zápase), playing = hraje zápas, offline = není (nebo stav skrývá). */
export type FriendStatus = 'online' | 'playing' | 'offline';

/** Kamarád se skóre zápasů z mého pohledu. */
export interface Friend extends Profile {
  readonly id: string;
  readonly wins: number;
  readonly losses: number;
  readonly status: FriendStatus;
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

/** Pozvánka do hry od kamaráda (kód místnosti, platí 10 minut). */
export interface GameInvite extends Profile {
  readonly id: string;
  readonly room: string;
}

/** Pozvánka do lobby turnaje od kamaráda (platí hodinu, jen dokud turnaj nezačal). */
export interface TournamentInvite extends Profile {
  /** Id turnaje. */
  readonly id: string;
  readonly code: string;
}

export interface Notifications {
  /** Čekající žádosti o přátelství. */
  readonly requests: number;
  readonly invites: readonly GameInvite[];
  readonly tournaments?: readonly TournamentInvite[];
  /** Ukazuji kamarádům, že jsem online (přepínač v Nastavení). */
  readonly showOnline: boolean;
}

export type InviteResult = 'sent' | 'not-friends';

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
      status: z.enum(['online', 'playing', 'offline']),
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
export const inviteResultSchema = z.enum(['sent', 'not-friends']);

export const notificationsSchema = z.object({
  requests: z.number().int().min(0).max(10_000),
  invites: z
    .array(
      z.object({
        id: uuid,
        nickname,
        tag,
        room: z.string().regex(/^[A-HJ-NP-Z2-9]{5}$/),
      }),
    )
    .max(100),
  tournaments: z
    .array(
      z.object({
        id: uuid,
        nickname,
        tag,
        code: z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/),
      }),
    )
    .max(50)
    .default([]),
  show_online: z.boolean(),
});

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
