import { z } from 'zod';
import { validateNickname } from '../core/nickname';

/** Zvýšit při jakékoli nekompatibilní změně zpráv. */
export const PROTOCOL_VERSION = 4;
export const BUILD_ID: string = __BUILD_ID__;
/** Horní mez velikosti jedné zprávy (znaky kanonického JSON). */
export const MAX_MESSAGE_CHARS = 32_000;

export const clientIdSchema = z.string().regex(/^[0-9a-f]{16}$/);
const hex32 = z.string().regex(/^[0-9a-f]{32}$/);
const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
/** Číslo mental pokeru (nejvýš 2048 bitů). */
const bigHex = z.string().regex(/^[0-9a-f]{1,512}$/);
const cardPos = z.number().int().min(0).max(63);
/** Pořadí současného zapečetěného tahu v karetních hrách (KNP: vždy 0). */
const sealedStep = z.number().int().min(0).max(999).optional();
/** Veřejný klíč P-256 (raw 65 B) v base64url. */
const publicKeySchema = z.string().regex(/^[A-Za-z0-9_-]{87}$/);
/** HMAC-SHA256 (32 B) v base64url. */
const macSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const buildSchema = z.string().min(1).max(64);
const nicknameSchema = z
  .string()
  .max(64)
  .refine((s) => {
    const result = validateNickname(s);
    return result.ok && result.value === s;
  }, 'Neplatná přezdívka');

export const playerSlotSchema = z.enum(['A', 'B']);
export const outcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('win'), winner: playerSlotSchema }),
  z.object({ kind: z.literal('draw') }),
]);
const gameIdSchema = z.string().regex(/^[a-z0-9-]{1,32}$/);

export const matchFormatSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rychlovka') }),
  z.object({ kind: z.literal('velky-souboj') }),
  z.object({
    kind: z.literal('vlastni'),
    bestOf: z.literal([1, 3, 5, 7, 9]),
    picks: z.union([z.literal('random'), z.array(gameIdSchema).max(9).readonly()]),
  }),
]);

// ---------- Párování (nepodepsané, před ustavením spojení) ----------

export const helloSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('hello'),
  from: clientIdSchema,
  nickname: nicknameSchema,
  build: buildSchema,
  pub: publicKeySchema,
});

export const welcomeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('welcome'),
  from: clientIdSchema,
  to: clientIdSchema,
  nickname: nicknameSchema,
  build: buildSchema,
  pub: publicKeySchema,
  format: matchFormatSchema,
});

export const roomFullSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('room-full'),
  from: clientIdSchema,
  to: clientIdSchema,
});

/** NEMĚNIT napříč verzemi – podle téhle zprávy se o neshodě dozví i starší klient. */
export const versionMismatchSchema = z.object({
  v: z.number(),
  type: z.literal('version-mismatch'),
  from: z.string().max(64),
  to: z.string().max(64).optional(),
  build: z.string().max(64),
});

/** Volné čtení jen verze a typu – dřív, než se zpráva validuje striktně. */
export const versionProbeSchema = z.object({ v: z.number(), type: z.string().max(32) });

export type Hello = z.infer<typeof helloSchema>;
export type Welcome = z.infer<typeof welcomeSchema>;

export function versionMismatch(
  from: string,
  to: string | undefined,
): z.infer<typeof versionMismatchSchema> {
  return {
    v: PROTOCOL_VERSION,
    type: 'version-mismatch',
    from,
    ...(to ? { to } : {}),
    build: BUILD_ID,
  };
}

// ---------- Spojení (podepsané HMAC) ----------

export const sessionEnvelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  type: z.literal('session'),
  from: clientIdSchema,
  to: clientIdSchema,
  kind: z.enum(['msg', 'ack', 'ping', 'bye']),
  seq: z.number().int().min(0).optional(),
  /** Nejvyšší pořadové číslo, které odesílatel přijal bez mezer (−1 = nic). */
  ack: z.number().int().min(-1),
  body: z.unknown().optional(),
  mac: macSchema,
});

export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

const matchNo = z.number().int().min(1).max(100_000);
const roundRef = {
  match: matchNo,
  gameNo: z.number().int().min(1).max(9),
  replay: z.number().int().min(0).max(3),
};

export const gameBodySchema = z.discriminatedUnion('kind', [
  /** Hostitel → host: pohled hosta na aktuální stav (validuje viewSchema dané hry). */
  z.object({
    kind: z.literal('state'),
    seq: z.number().int().min(0),
    view: z.unknown(),
    canAct: z.boolean(),
    committed: z.array(playerSlotSchema).max(2),
    finished: outcomeSchema.nullable(),
  }),
  /** Host → hostitel: tah (validuje moveSchema dané hry). */
  z.object({ kind: z.literal('move'), move: z.unknown(), auto: z.boolean() }),
  /** Zapečetěný tah: SHA-256(sůl ‖ tah). */
  z.object({
    kind: z.literal('commit'),
    player: playerSlotSchema,
    hash: hex64,
    auto: z.boolean(),
    step: sealedStep,
  }),
  z.object({
    kind: z.literal('reveal'),
    player: playerSlotSchema,
    move: z.unknown(),
    salt: hex64,
    step: sealedStep,
  }),
  /** Závazek k tajným datům hry (rozmístění lodí, kód): SHA-256(sůl ‖ data). */
  z.object({ kind: z.literal('secret-commit'), player: playerSlotSchema, hash: hex64 }),
  /** Odhalení tajných dat po konci hry (validuje secretSchema dané hry). */
  z.object({
    kind: z.literal('secret-reveal'),
    player: playerSlotSchema,
    secret: z.unknown(),
    salt: hex64,
  }),
  /** Mental poker: balíček po kroku míchání 1–4. */
  z.object({
    kind: z.literal('deck'),
    stage: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    cards: z.array(bigHex).min(1).max(64),
  }),
  /** Mental poker: klíče vlastní vrstvy k pozicím, na které má soupeř nárok. */
  z.object({
    kind: z.literal('card-keys'),
    keys: z
      .array(z.object({ pos: cardPos, key: bigHex }))
      .min(1)
      .max(64),
  }),
  /** Mental poker: všechny klíče po konci hry (ověření celého balíčku). */
  z.object({ kind: z.literal('deck-audit'), keys: z.array(bigHex).min(1).max(64) }),
]);

export const sessionBodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('seed-commit'), match: matchNo, hash: hex64 }),
  z.object({ type: z.literal('seed-reveal'), match: matchNo, seed: hex32, salt: hex64 }),
  z.object({
    type: z.literal('match-setup'),
    match: matchNo,
    format: matchFormatSchema,
    slots: z
      .array(z.object({ gameId: gameIdSchema, picked: z.boolean() }))
      .min(1)
      .max(9),
  }),
  z.object({ type: z.literal('match-start'), match: matchNo }),
  z.object({ type: z.literal('ready'), ...roundRef }),
  z.object({ type: z.literal('round-start'), ...roundRef }),
  z.object({ type: z.literal('game'), ...roundRef, body: gameBodySchema }),
  z.object({
    type: z.literal('round-end'),
    ...roundRef,
    outcome: outcomeSchema,
    summary: z.string().max(300),
  }),
  z.object({
    type: z.literal('match-end'),
    match: matchNo,
    winner: playerSlotSchema,
    reason: z.enum(['afk']),
  }),
  z.object({ type: z.literal('rematch'), match: matchNo }),
  z.object({ type: z.literal('cheat'), match: matchNo, detail: z.string().max(200) }),
]);

export type SessionBody = z.infer<typeof sessionBodySchema>;
export type GameBody = z.infer<typeof gameBodySchema>;
export type StateBody = Extract<GameBody, { kind: 'state' }>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
