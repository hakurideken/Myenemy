import { z } from 'zod';
import type { MatchFormat } from '../core/match/planMatch';
import type { Difficulty } from '../core/types';

/**
 * Turnaj: vyřazovací pavouk pro 4, 8 nebo 16 hráčů (volná místa doplní AI). Stav drží
 * Supabase (supabase/migrations/20261112120000_tournaments.sql), klient ho jen čte
 * a posílá akce. Každý zápas je online 1v1 (nebo proti AI) ve formátu best of 9.
 */

/** Formát každého turnajového zápasu: 9 náhodných her, vyhrává kdo dřív 5. */
export const TOURNAMENT_FORMAT: MatchFormat = { kind: 'vlastni', bestOf: 9, picks: 'random' };
/** Obtížnost AI, která doplňuje volná místa. */
export const TOURNAMENT_AI: Difficulty = 'medium';
export const TOURNAMENT_MAX_PLAYERS = 16;
/** Jak často se obnovuje pavouk (ms) – na obrazovce turnaje a během zápasu. */
export const POLL_MS = 4_000;
export const POLL_IN_MATCH_MS = 20_000;

export type TournamentStatus = 'lobby' | 'running' | 'finished';
export type MatchStatus = 'waiting' | 'ready' | 'done';
/** played = odehráno, ai = AI proti AI (simulace), walkover = kontumace, random = los. */
export type MatchHow = 'played' | 'ai' | 'walkover' | 'random';

export interface TournamentPlayer {
  /** Pozice v pavouku; v lobby null. */
  readonly slot: number | null;
  readonly nickname: string;
  /** Kód za přezdívkou; u AI pořadové číslo. */
  readonly tag: number;
  readonly ai: boolean;
  /** Odešel z turnaje (nebo smazal účet) – zbylé zápasy prohrává kontumací. */
  readonly gone: boolean;
  readonly online: boolean;
  readonly me: boolean;
  readonly organizer: boolean;
}

export interface TournamentMatch {
  readonly round: number;
  readonly idx: number;
  readonly a: number | null;
  readonly b: number | null;
  readonly status: MatchStatus;
  readonly winner: number | null;
  readonly scoreA: number | null;
  readonly scoreB: number | null;
  readonly how: MatchHow | null;
  /** Kód online místnosti (jen pro hráče zápasu). */
  readonly room: string | null;
  /** Já jsem už výsledek nahlásil. */
  readonly reported: boolean;
  /** Kolikrát se kvůli neshodě hlášení hrálo znovu. */
  readonly replays: number;
  /** Jak dlouho (s) je zápas připravený a místnost založená – jen pro hráče zápasu. */
  readonly readyAge: number | null;
  readonly roomAge: number | null;
}

export interface TournamentState {
  readonly id: string;
  readonly code: string;
  readonly status: TournamentStatus;
  readonly size: 4 | 8 | 16 | null;
  /** Jsem organizátor. */
  readonly organizer: boolean;
  /** Moje pozice v pavouku (v lobby null). */
  readonly me: number | null;
  readonly players: readonly TournamentPlayer[];
  readonly matches: readonly TournamentMatch[];
}

export type CreateResult =
  { readonly kind: 'created'; readonly code: string } | { readonly kind: 'no-profile' | 'busy' };
export type JoinResult = 'joined' | 'not-found' | 'started' | 'full' | 'busy' | 'no-profile';
export type StartResult = 'started' | 'not-organizer' | 'too-few' | 'not-lobby';
export type TournamentReportResult = 'recorded' | 'pending' | 'replay' | 'ignored';
export type TournamentInviteResult = 'sent' | 'not-friends' | 'not-lobby';

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const ROOM_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const slot = z.number().int().min(0).max(15);
const score = z.number().int().min(0).max(9);

export const tournamentStateSchema = z
  .object({
    id: uuid,
    code: z.string().regex(CODE_RE),
    status: z.enum(['lobby', 'running', 'finished']),
    size: z.union([z.literal(4), z.literal(8), z.literal(16)]).nullable(),
    organizer: z.boolean(),
    me: slot.nullable(),
    players: z
      .array(
        z.object({
          slot: slot.nullable(),
          nickname: z.string().min(1).max(64),
          tag: z.number().int().min(0).max(9999),
          ai: z.boolean(),
          gone: z.boolean(),
          online: z.boolean(),
          me: z.boolean(),
          organizer: z.boolean(),
        }),
      )
      .max(TOURNAMENT_MAX_PLAYERS),
    matches: z
      .array(
        z.object({
          round: z.number().int().min(1).max(4),
          idx: z.number().int().min(0).max(7),
          a: slot.nullable(),
          b: slot.nullable(),
          status: z.enum(['waiting', 'ready', 'done']),
          winner: slot.nullable(),
          score_a: score.nullable(),
          score_b: score.nullable(),
          how: z.enum(['played', 'ai', 'walkover', 'random']).nullable(),
          room: z.string().regex(ROOM_RE).nullable(),
          reported: z.boolean(),
          replays: z.number().int().min(0).max(100),
          ready_age: z.number().int().min(0).nullable().optional(),
          room_age: z.number().int().min(0).nullable().optional(),
        }),
      )
      .max(16),
  })
  .transform((s): TournamentState => ({
    ...s,
    matches: s.matches.map(({ score_a, score_b, ready_age, room_age, ...m }) => ({
      ...m,
      scoreA: score_a,
      scoreB: score_b,
      readyAge: ready_age ?? null,
      roomAge: room_age ?? null,
    })),
  }));

const createSchema = z.union([z.string().regex(CODE_RE), z.enum(['no-profile', 'busy'])]);
const joinSchema = z.enum(['joined', 'not-found', 'started', 'full', 'busy', 'no-profile']);
const startSchema = z.enum(['started', 'not-organizer', 'too-few', 'not-lobby']);
const reportSchema = z.enum(['recorded', 'pending', 'replay', 'ignored']);
const inviteSchema = z.enum(['sent', 'not-friends', 'not-lobby']);

/** „ab 12cd-3“ → „AB12CD“ (kód turnaje: 6 znaků bez I, O, 0, 1). */
export function normalizeTournamentCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(code) ? code : null;
}

/** Volání funkce v databázi (Account.call). */
export type RpcCall = (
  fn: string,
  args?: Record<string, unknown>,
  keepalive?: boolean,
) => Promise<unknown>;

export interface TournamentApi {
  /** Stav mého turnaje (null = v žádném nejsem); zároveň hlásí „jsem tady“. */
  state(): Promise<TournamentState | null>;
  create(): Promise<CreateResult>;
  join(code: string): Promise<JoinResult>;
  leave(): Promise<void>;
  start(): Promise<StartResult>;
  /** false = místnost zakládat nesmím (dolní hráč dřív než po 2 minutách). */
  setRoom(match: MatchRef, room: string): Promise<boolean>;
  report(
    match: MatchRef,
    winner: number,
    scoreA: number,
    scoreB: number,
  ): Promise<TournamentReportResult>;
  invite(friendId: string): Promise<TournamentInviteResult>;
  dismissInvite(tournamentId: string): Promise<void>;
}

export interface MatchRef {
  readonly round: number;
  readonly idx: number;
}

export function createTournamentApi(call: RpcCall): TournamentApi {
  return {
    async state() {
      const data = await call('tournament_state');
      return data === null ? null : tournamentStateSchema.parse(data);
    },
    async create() {
      const r = createSchema.parse(await call('tournament_create'));
      return r === 'no-profile' || r === 'busy' ? { kind: r } : { kind: 'created', code: r };
    },
    async join(code) {
      return joinSchema.parse(await call('tournament_join', { p_code: code }));
    },
    async leave() {
      await call('tournament_leave', {}, true);
    },
    async start() {
      return startSchema.parse(await call('tournament_start'));
    },
    async setRoom(match, room) {
      return z.boolean().parse(
        await call('tournament_set_room', {
          p_round: match.round,
          p_idx: match.idx,
          p_room: room,
        }),
      );
    },
    async report(match, winner, scoreA, scoreB) {
      return reportSchema.parse(
        await call(
          'tournament_report',
          {
            p_round: match.round,
            p_idx: match.idx,
            p_winner: winner,
            p_score_a: scoreA,
            p_score_b: scoreB,
          },
          true,
        ),
      );
    },
    async invite(friendId) {
      return inviteSchema.parse(await call('tournament_invite', { p_friend: friendId }));
    },
    async dismissInvite(tournamentId) {
      await call('dismiss_tournament_invite', { p_tournament: tournamentId });
    },
  };
}

// ---------- Pomocné funkce nad stavem ----------

export function roundsOf(size: 4 | 8 | 16): number {
  return size === 4 ? 2 : size === 8 ? 3 : 4;
}

export function playerAt(state: TournamentState, slot: number | null): TournamentPlayer | null {
  if (slot === null) return null;
  return state.players.find((p) => p.slot === slot) ?? null;
}

/** Můj zápas, který se má právě hrát (oba soupeři známí, ještě nerozhodnutý). */
export function myReadyMatch(state: TournamentState): TournamentMatch | null {
  if (state.status !== 'running' || state.me === null) return null;
  return (
    state.matches.find((m) => m.status === 'ready' && (m.a === state.me || m.b === state.me)) ??
    null
  );
}

/** Vypadl (prohrál zápas; prohra v semifinále posílá ještě do zápasu o 3. místo)? */
export function eliminated(state: TournamentState, slot: number): boolean {
  if (!state.size) return false;
  const rounds = roundsOf(state.size);
  return state.matches.some(
    (m) =>
      m.status === 'done' &&
      m.winner !== slot &&
      (m.a === slot || m.b === slot) &&
      m.round !== rounds - 1,
  );
}

export type RoundKind = 'final' | 'third' | 'semi' | 'quarter' | 'eighth';

export function roundKind(round: number, idx: number, rounds: number): RoundKind {
  if (round === rounds) return idx === 1 ? 'third' : 'final';
  const fromEnd = rounds - round;
  return fromEnd === 1 ? 'semi' : fromEnd === 2 ? 'quarter' : 'eighth';
}

export interface Placement {
  readonly first: number | null;
  readonly second: number | null;
  readonly third: number | null;
}

export function placements(state: TournamentState): Placement {
  if (!state.size) return { first: null, second: null, third: null };
  const rounds = roundsOf(state.size);
  const final = state.matches.find((m) => m.round === rounds && m.idx === 0);
  const third = state.matches.find((m) => m.round === rounds && m.idx === 1);
  const loserOf = (m: TournamentMatch | undefined): number | null =>
    m?.winner === null || m?.winner === undefined ? null : m.winner === m.a ? m.b : m.a;
  return {
    first: final?.winner ?? null,
    second: loserOf(final),
    third: third?.winner ?? null,
  };
}

/** Jméno do pavouku: hráč „Pepa“, AI „AI 3“. */
export function entrantName(player: TournamentPlayer | null, aiLabel: string): string {
  if (!player) return '';
  return player.ai ? `${aiLabel} ${player.tag}` : player.nickname;
}
