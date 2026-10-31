import { blindAll, blindLabels, fogHex, padLabels, parseFogHex, randomKey } from '../core/fog/psi';
import type { FogKeeper, FogKnowledge, FogRules, Sighting } from '../core/MiniGame';
import { otherPlayer, type PerPlayer, type PlayerSlot } from '../core/types';
import { canonicalJson } from '../core/util/canonicalJson';
import { translations } from '../i18n';
import { Listeners } from '../net/Transport';

const t = translations(
  {
    badQuery: 'Soupeř poslal neplatný šifrovaný dotaz.',
    badAnswer: 'Soupeř poslal neplatnou šifrovanou odpověď.',
    routeMismatch: 'Odhalená trasa soupeře nesouhlasí s jeho tahy.',
    badRoute: 'Soupeř táhl, kam nesměl.',
    badReport: 'Hlášení o chycení neodpovídá polohám.',
    lookedTooFar: 'Soupeř se díval dál, než smí.',
    hidPosition: 'Soupeř zatajil svou polohu.',
    auditIncomplete: 'Soupeř neodhalil celou trasu.',
    auditMissing: 'Soupeř neodhalil svou trasu.',
  },
  {
    badQuery: 'Your opponent sent an invalid encrypted query.',
    badAnswer: 'Your opponent sent an invalid encrypted answer.',
    routeMismatch: 'Your opponent’s revealed route does not match their moves.',
    badRoute: 'Your opponent moved where they were not allowed to.',
    badReport: 'The catch report does not match the positions.',
    lookedTooFar: 'Your opponent looked further than allowed.',
    hidPosition: 'Your opponent hid their position.',
    auditIncomplete: 'Your opponent did not reveal their whole route.',
    auditMissing: 'Your opponent did not reveal their route.',
  },
);

/** Zprávy mlhy (pole jsou mutabilní kvůli typům protokolu ze Zodu). */
export type FogMessage =
  | { kind: 'fog-query'; index: number; values: string[] }
  | { kind: 'fog-answer'; index: number; doubles: string[]; exposed: string[] }
  | {
      kind: 'fog-audit';
      segment: number;
      moves: { index: number; move: unknown }[];
      keys: { index: number; observe: string; target: string }[];
    };

type Audit = Extract<FogMessage, { kind: 'fog-audit' }>;

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  done: boolean;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  const out: Deferred = {
    promise,
    resolve: () => {
      out.done = true;
      resolve();
    },
    done: false,
  };
  return out;
}

/** Pozorování po jednom tahu – já pozoruji soupeře a soupeř pozoruje mě. */
interface Observation {
  readonly index: number;
  readonly segment: number;
  readonly mover: PlayerSlot | null;
  readonly own: unknown;
  /** Já jako pozorovatel: můj klíč, štítky, kam dohlédnu, a co mi soupeř odpověděl. */
  readonly observeKey: bigint;
  labels: string[] | null;
  values: bigint[] | null;
  theirDoubles: bigint[] | null;
  theirExposed: bigint[] | null;
  /** Soupeř jako pozorovatel: jeho dotaz a můj klíč do odpovědi. */
  theirQuery: bigint[] | null;
  targetKey: bigint | null;
  readonly observed: Deferred;
  readonly answered: Deferred;
}

const KEY = /^[0-9a-f]{1,64}$/;

function parseList(raw: readonly string[], size: number): bigint[] | null {
  if (raw.length !== size) return null;
  const out: bigint[] = [];
  for (const text of raw) {
    const value = parseFogHex(text);
    if (value === null) return null;
    out.push(value);
  }
  return out;
}

const sameList = (a: readonly bigint[], b: readonly bigint[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Online mlha pro dva hráče. Vlastní polohu zná jen toto zařízení. Po každém tahu, který
 * něco mění, proběhne šifrovaný průnik oběma směry (viz psi.ts): každý se dozví jen to,
 * co vidí. Po skončení úseku (poločasu) oba pošlou celé své tahy i klíče a soupeř
 * přepočítá, že trasa byla platná, dívalo se jen kam smělo a nic se nezatajilo.
 */
export class OnlineFog implements FogKeeper {
  private readonly opponent: PlayerSlot;
  private own: unknown = null;
  private staged: { readonly value: unknown } | null = null;
  private segment = 0;
  private lastIndex = 0;
  private finished = false;
  private problem: string | null = null;
  private readonly views = new Map<number, PerPlayer<unknown>>();
  /** Veřejné tahy podle čísla. */
  private readonly moves = new Map<
    number,
    { readonly player: PlayerSlot; readonly move: unknown }
  >();
  /** Vlastní tahy i se soukromou částí – odhalí se po úseku. */
  private readonly ownMoves = new Map<number, unknown>();
  private readonly ownAt = new Map<number, unknown>();
  private readonly segmentStart = new Map<number, number>();
  private readonly segmentEnd = new Map<number, number>();
  private readonly observations = new Map<number, Observation>();
  /** Dotazy, které předběhly zápis tahu (nemělo by nastat – zprávy jdou po pořadí). */
  private readonly queued = new Map<number, string[]>();
  private readonly sightings: Sighting[] = [];
  private readonly revealed = new Map<number, unknown>();
  private readonly closed = new Set<number>();
  private readonly audits = new Map<number, Audit>();
  private readonly verifying = new Set<number>();
  private readonly verified = new Map<number, string | null>();
  private readonly listeners = new Listeners<void>();
  private readonly waiters: (() => boolean)[] = [];

  constructor(
    private readonly rules: FogRules<unknown, unknown, unknown>,
    private readonly me: PlayerSlot,
    private readonly send: (message: FogMessage) => void,
    private readonly cheat: (detail: string) => void,
  ) {
    this.opponent = otherPlayer(me);
  }

  begin(viewOf: (player: PlayerSlot) => unknown): void {
    const view = viewOf(this.me);
    this.segment = this.rules.segment(view);
    this.own = this.rules.start(view, this.me);
    this.views.set(0, { A: viewOf('A'), B: viewOf('B') });
    this.ownAt.set(0, this.own);
    this.segmentStart.set(this.segment, 0);
    this.observe(0, null);
  }

  stage(player: PlayerSlot, view: unknown, move: unknown): boolean {
    if (player !== this.me) return false;
    const next = this.rules.advance(view, player, this.own, move);
    if (next === null) return false;
    this.staged = { value: next };
    return true;
  }

  record(
    index: number,
    player: PlayerSlot,
    move: unknown,
    viewOf: (player: PlayerSlot) => unknown,
  ): void {
    this.lastIndex = index;
    this.views.set(index, { A: viewOf('A'), B: viewOf('B') });
    this.moves.set(index, { player, move: this.rules.publicMove(move) });
    if (player === this.me) {
      this.ownMoves.set(index, move);
      if (this.staged) this.own = this.staged.value;
    }
    this.staged = null;
    const segment = this.rules.segment(viewOf(this.me));
    if (segment !== this.segment) {
      this.closeSegment(this.segment);
      this.segment = segment;
      this.own = this.rules.start(viewOf(this.me), this.me);
      this.segmentStart.set(segment, index);
    }
    this.ownAt.set(index, this.own);
    if (this.rules.observes(move)) this.observe(index, player);
  }

  ready(): boolean {
    for (const obs of this.observations.values()) if (!obs.observed.done) return false;
    return true;
  }

  knowledge(player: PlayerSlot): FogKnowledge | null {
    if (player !== this.me) return null;
    return { own: this.own, sightings: this.sightings, revealed: this.revealed };
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.closeSegment(this.segment);
  }

  onChange(cb: () => void): () => void {
    return this.listeners.add(cb);
  }

  receive(message: FogMessage): void {
    if (this.problem) return;
    switch (message.kind) {
      case 'fog-query': {
        const obs = this.observations.get(message.index);
        if (obs) void this.answer(obs, message.values);
        else if (message.index > this.lastIndex) this.queued.set(message.index, message.values);
        else this.fail(t.badQuery);
        break;
      }
      case 'fog-answer':
        void this.finishObservation(message);
        break;
      case 'fog-audit':
        if (this.audits.has(message.segment)) return;
        this.audits.set(message.segment, message);
        void this.tryVerify(message.segment);
        break;
    }
  }

  /**
   * Konec kola: počká na ověření všech úseků. Vrací popis problému, nebo null.
   * `schedule` spustí po limitu odpověď „soupeř trasu neodhalil“.
   */
  waitAudit(schedule: (cb: () => void) => void): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const check = (): boolean => {
        if (settled) return true;
        const status = this.auditStatus();
        if (status === undefined) return false;
        settled = true;
        resolve(status);
        return true;
      };
      if (check()) return;
      this.waiters.push(check);
      schedule(() => {
        if (settled) return;
        settled = true;
        resolve(this.problem ?? t.auditMissing);
      });
    });
  }

  // ---------- Pozorování ----------

  private observe(index: number, mover: PlayerSlot | null): void {
    const obs: Observation = {
      index,
      segment: this.segment,
      mover,
      own: this.own,
      observeKey: randomKey(),
      labels: null,
      values: null,
      theirDoubles: null,
      theirExposed: null,
      theirQuery: null,
      targetKey: null,
      observed: deferred(),
      answered: deferred(),
    };
    this.observations.set(index, obs);
    void this.sendQuery(obs);
    const queued = this.queued.get(index);
    if (queued) {
      this.queued.delete(index);
      void this.answer(obs, queued);
    }
  }

  private async sendQuery(obs: Observation): Promise<void> {
    const view = this.views.get(obs.index)?.[this.me];
    const labels = padLabels(
      this.rules.queries(view, this.me, obs.own),
      this.rules.maxQueries,
      `${obs.index}:q`,
    );
    if (!labels) throw new Error(`Mlha: příliš mnoho štítků po tahu ${obs.index}`);
    obs.labels = labels;
    obs.values = await blindLabels(labels, obs.observeKey);
    this.send({ kind: 'fog-query', index: obs.index, values: obs.values.map(fogHex) });
  }

  /** Soupeř se dívá: jeho dotaz zašifruji svým klíčem a přidám, čím se prozrazuji. */
  private async answer(obs: Observation, raw: readonly string[]): Promise<void> {
    if (obs.theirQuery) {
      this.fail(t.badQuery);
      return;
    }
    const values = parseList(raw, this.rules.maxQueries);
    if (!values) {
      this.fail(t.badQuery);
      return;
    }
    obs.theirQuery = values;
    const key = randomKey();
    obs.targetKey = key;
    const view = this.views.get(obs.index)?.[this.me];
    const labels = padLabels(
      this.rules.exposed(view, this.me, obs.own),
      this.rules.maxExposed,
      `${obs.index}:x`,
    );
    if (!labels) throw new Error(`Mlha: příliš mnoho štítků po tahu ${obs.index}`);
    const doubles = await blindAll(values, key);
    const exposed = await blindLabels(labels, key);
    this.send({
      kind: 'fog-answer',
      index: obs.index,
      doubles: doubles.map(fogHex),
      exposed: exposed.map(fogHex),
    });
    obs.answered.resolve();
  }

  /** Odpověď na můj dotaz: shodné prvky = štítky soupeře, které vidím. */
  private async finishObservation(
    message: Extract<FogMessage, { kind: 'fog-answer' }>,
  ): Promise<void> {
    const obs = this.observations.get(message.index);
    if (!obs?.labels || !obs.values || obs.theirDoubles) {
      this.fail(t.badAnswer);
      return;
    }
    const doubles = parseList(message.doubles, obs.values.length);
    const exposed = parseList(message.exposed, this.rules.maxExposed);
    if (!doubles || !exposed) {
      this.fail(t.badAnswer);
      return;
    }
    obs.theirDoubles = doubles;
    obs.theirExposed = exposed;
    const shown = new Set(await blindAll(exposed, obs.observeKey));
    const labels = obs.labels;
    const seen = labels.filter(
      (label, i) => !label.startsWith('X:') && shown.has(doubles[i] ?? 0n),
    );
    this.sightings.push({
      index: obs.index,
      segment: obs.segment,
      mover: obs.mover,
      own: obs.own,
      seen,
    });
    this.sightings.sort((a, b) => a.index - b.index);
    obs.observed.resolve();
    this.listeners.emit();
  }

  // ---------- Odhalení a ověření úseku ----------

  /** Úsek skončil: až budou hotová všechna jeho pozorování, pošlu tahy i klíče. */
  private closeSegment(segment: number): void {
    if (this.closed.has(segment)) return;
    this.closed.add(segment);
    const start = this.segmentStart.get(segment) ?? 0;
    const end = this.lastIndex;
    this.segmentEnd.set(segment, end);
    const observations = this.segmentObservations(segment);
    const pending = observations.flatMap((o) => [o.observed.promise, o.answered.promise]);
    void Promise.all(pending).then(() => {
      this.send({
        kind: 'fog-audit',
        segment,
        moves: [...this.ownMoves]
          .filter(([index]) => index > start && index <= end)
          .map(([index, move]) => ({ index, move })),
        keys: observations.map((o) => ({
          index: o.index,
          observe: o.observeKey.toString(16),
          target: (o.targetKey ?? 0n).toString(16),
        })),
      });
      void this.tryVerify(segment);
    });
  }

  private segmentObservations(segment: number): Observation[] {
    return [...this.observations.values()]
      .filter((o) => o.segment === segment)
      .sort((a, b) => a.index - b.index);
  }

  private async tryVerify(segment: number): Promise<void> {
    if (this.verifying.has(segment) || !this.closed.has(segment)) return;
    const audit = this.audits.get(segment);
    if (!audit) return;
    const observations = this.segmentObservations(segment);
    if (observations.some((o) => !o.observed.done || !o.answered.done)) return;
    this.verifying.add(segment);
    let problem: string | null;
    try {
      problem = await this.verifySegment(segment, audit);
    } catch {
      problem = t.routeMismatch;
    }
    this.verified.set(segment, problem);
    if (problem) this.fail(problem);
    else this.listeners.emit();
    this.notify();
  }

  /** Přehraje soupeřovu trasu z odhalených tahů a přepočítá jeho šifrované zprávy. */
  private async verifySegment(segment: number, audit: Audit): Promise<string | null> {
    const start = this.segmentStart.get(segment) ?? 0;
    const end = this.segmentEnd.get(segment) ?? this.lastIndex;
    const theirMoves = new Map(audit.moves.map((m) => [m.index, m.move]));
    const keys = new Map(audit.keys.map((k) => [k.index, k]));
    const expected: number[] = [];
    for (let i = start + 1; i <= end; i++) {
      if (this.moves.get(i)?.player === this.opponent) expected.push(i);
    }
    if (theirMoves.size !== expected.length || expected.some((i) => !theirMoves.has(i))) {
      return t.routeMismatch;
    }
    const at = (i: number): PerPlayer<unknown> | undefined => this.views.get(i);
    let theirs = this.rules.start(at(start)?.[this.opponent], this.opponent);
    const first = this.observations.get(start);
    if (first?.segment === segment) {
      const problem = await this.verifyObservation(first, theirs, keys.get(start));
      if (problem) return problem;
    }
    for (let i = start + 1; i <= end; i++) {
      const record = this.moves.get(i);
      const before = at(i - 1);
      if (!record || !before) return t.routeMismatch;
      const theirMove = record.player === this.opponent;
      const full = theirMove ? theirMoves.get(i) : (this.ownMoves.get(i) ?? record.move);
      if (theirMove && canonicalJson(this.rules.publicMove(full)) !== canonicalJson(record.move)) {
        return t.routeMismatch;
      }
      const privates = { A: null, B: null } as PerPlayer<unknown>;
      privates[this.me] = this.ownAt.get(i - 1);
      privates[this.opponent] = theirs;
      if (!this.rules.check(before[record.player], record.player, full, privates)) {
        return t.badReport;
      }
      if (theirMove) {
        const next = this.rules.advance(before[this.opponent], this.opponent, theirs, full);
        if (next === null) return t.badRoute;
        theirs = next;
      }
      const obs = this.observations.get(i);
      if (obs?.segment === segment) {
        const problem = await this.verifyObservation(obs, theirs, keys.get(i));
        if (problem) return problem;
      }
    }
    this.revealed.set(segment, theirs);
    return null;
  }

  private async verifyObservation(
    obs: Observation,
    theirs: unknown,
    key: { readonly observe: string; readonly target: string } | undefined,
  ): Promise<string | null> {
    if (!key || !KEY.test(key.observe) || !KEY.test(key.target)) return t.auditIncomplete;
    if (!obs.values || !obs.theirQuery || !obs.theirDoubles || !obs.theirExposed) {
      return t.auditIncomplete;
    }
    const observe = BigInt(`0x${key.observe}`);
    const target = BigInt(`0x${key.target}`);
    const view = this.views.get(obs.index)?.[this.opponent];
    // Soupeř jako pozorovatel: díval se jen tam, kam ze své polohy dohlédl.
    const queries = padLabels(
      this.rules.queries(view, this.opponent, theirs),
      this.rules.maxQueries,
      `${obs.index}:q`,
    );
    if (!queries || !sameList(await blindLabels(queries, observe), obs.theirQuery)) {
      return t.lookedTooFar;
    }
    // Soupeř jako cíl: poctivě zašifroval můj dotaz a prozradil svou skutečnou polohu.
    if (!sameList(await blindAll(obs.values, target), obs.theirDoubles)) return t.hidPosition;
    const exposed = padLabels(
      this.rules.exposed(view, this.opponent, theirs),
      this.rules.maxExposed,
      `${obs.index}:x`,
    );
    if (!exposed || !sameList(await blindLabels(exposed, target), obs.theirExposed)) {
      return t.hidPosition;
    }
    return null;
  }

  /** undefined = ještě se čeká; null = vše ověřeno; text = problém. */
  private auditStatus(): string | null | undefined {
    if (this.problem) return this.problem;
    if (!this.finished) return undefined;
    for (const segment of this.closed) {
      if (!this.verified.has(segment)) return undefined;
    }
    return null;
  }

  private notify(): void {
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      if (this.waiters[i]?.()) this.waiters.splice(i, 1);
    }
  }

  private fail(detail: string): void {
    if (this.problem) return;
    this.problem = detail;
    this.cheat(detail);
    this.notify();
  }
}
