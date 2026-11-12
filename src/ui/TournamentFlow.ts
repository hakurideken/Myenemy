import type { PerPlayer } from '../core/types';
import {
  createTournamentApi,
  myReadyMatch,
  playerAt,
  POLL_IN_MATCH_MS,
  POLL_MS,
  type MatchRef,
  type TournamentApi,
  type TournamentMatch,
  type TournamentPlayer,
  type TournamentState,
} from '../net/tournament';
import { SpectateCaster } from '../online/spectate';
import type { App } from './App';

/**
 * Spojení rozehraného zápasu s turnajem: kam nahlásit výsledek a kam se vrátit.
 * slots = který hráč místnosti (A = hostitel, B = host) je na které pozici pavouku;
 * výsledek se hlásí v pořadí pavouku (top = horní hráč zápasu).
 */
export interface TournamentLink {
  readonly match: MatchRef;
  readonly slots: PerPlayer<number>;
  /** Pozice horního hráče zápasu v pavouku (skóre se hlásí jako horní : dolní). */
  readonly top: number;
  /** Výsledek zápasu (vítěz jako slot pavouku, skóre A : B pavouku). */
  finish(winnerSlot: number, scoreA: number, scoreB: number): void;
  /** Hostitel založil místnost – kód uvidí soupeř. */
  roomCreated(code: string): void;
  /** Zpět na pavouka; failedRoom = do této místnosti se nepovedlo připojit. */
  back(failedRoom?: string): void;
  /** Začít vysílat divákům (kanál se zapíše k zápasu); null = nejde (síť). */
  broadcast(): Promise<SpectateCaster | null>;
}

type Mode = 'off' | 'screen' | 'background';

const key = (m: MatchRef & { readonly replays?: number }): string =>
  `${m.round}/${m.idx}/${m.replays ?? 0}`;

/**
 * Turnaj v aplikaci: průběžně čte stav (na obrazovce turnaje každé 4 s, jinak každých
 * 20 s jako „jsem tady“ – kdo se 3 minuty neozve, prohraje kontumací) a na obrazovce
 * turnaje sám spouští zápasy proti lidem (hostitel založí místnost, soupeř se připojí).
 */
export class TournamentFlow {
  readonly api: TournamentApi;
  private value: TournamentState | null | undefined = undefined;
  private lastJson = '';
  private failed = false;
  private readonly listeners = new Set<() => void>();
  private mode: Mode = 'off';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  /** Zápasy, ke kterým se už jednou samo založilo / připojilo (pak jen tlačítkem). */
  private readonly autoTried = new Set<string>();
  private readonly failedRooms = new Set<string>();
  /** Místnosti, které jsem založil sám (do těch se nepřipojuji jako host). */
  private readonly myRooms = new Set<string>();
  /** Právě hraný zápas (nezakládat ho podruhé). */
  private playing: string | null = null;
  /** Nenahlášený výsledek (výpadek sítě) – pošle se při dalším obnovení. */
  private pendingReport: {
    readonly match: MatchRef;
    readonly winner: number;
    readonly scoreA: number;
    readonly scoreB: number;
  } | null = null;
  /** Poslední odpověď na hlášení (pro text na pavouku). */
  lastReport: 'pending' | 'replay' | null = null;

  constructor(private readonly app: App) {
    this.api = createTournamentApi((fn, args, keepalive) => app.account.call(fn, args, keepalive));
  }

  /** undefined = ještě nenačteno, null = v žádném turnaji nejsem. */
  get state(): TournamentState | null | undefined {
    return this.value;
  }

  /** Poslední načtení selhalo (síť) – ukazuje se upozornění. */
  get offline(): boolean {
    return this.failed;
  }

  /** Probíhá (nebo čeká na start) turnaj, ve kterém jsem. */
  get active(): boolean {
    return this.value?.status === 'lobby' || this.value?.status === 'running';
  }

  /** Můj zápas je připravený a ještě se nehraje (upozornění mimo obrazovku turnaje). */
  get matchWaiting(): boolean {
    const m = this.value ? myReadyMatch(this.value) : null;
    return m !== null && !m.reported && this.playing === null;
  }

  onChange(handler: () => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emit(): void {
    for (const handler of this.listeners) handler();
  }

  /** Obrazovka turnaje je otevřená (rychlé obnovování a automatické zápasy). */
  enterScreen(): void {
    this.playing = null;
    this.setMode('screen');
    void this.refresh();
  }

  /** Odchod z obrazovky turnaje: dál jen „jsem tady“, pokud turnaj běží. */
  leaveScreen(): void {
    if (this.mode === 'screen') this.setMode(this.active ? 'background' : 'off');
  }

  /** Odhlášení / jiný účet: zapomenout vše. */
  reset(): void {
    this.setMode('off');
    this.value = undefined;
    this.lastJson = '';
    this.pendingReport = null;
    this.playing = null;
    this.emit();
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.mode === 'off') return;
    const ms = this.mode === 'screen' && !document.hidden ? POLL_MS : POLL_IN_MATCH_MS;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh().finally(() => this.schedule());
    }, ms);
  }

  /** Načte stav (souběžná volání se spojí do jednoho). */
  refresh(): Promise<void> {
    this.inFlight ??= this.load().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async load(): Promise<void> {
    const account = this.app.account.state;
    if (account.kind !== 'signed-in' || !account.profile) {
      if (this.value !== undefined) this.reset();
      return;
    }
    try {
      if (this.pendingReport) await this.sendReport();
      const next = await this.api.state();
      const json = JSON.stringify(next);
      const changed = json !== this.lastJson || this.value === undefined || this.failed;
      this.failed = false;
      this.lastJson = json;
      this.value = next;
      if (this.mode === 'off' && this.active) this.setMode('background');
      if (this.mode !== 'off' && !this.active && this.mode !== 'screen') this.setMode('off');
      if (changed) this.emit();
      this.checkAbandoned();
      this.autoPlay();
    } catch {
      if (!this.failed) {
        this.failed = true;
        this.emit();
      }
    }
  }

  // ---------- Akce ----------

  /** Soupeř v mém zápase. */
  opponent(match: TournamentMatch): TournamentPlayer | null {
    const s = this.value;
    if (!s || s.me === null) return null;
    return playerAt(s, match.a === s.me ? match.b : match.a);
  }

  /**
   * Čekám v místnosti na soupeře, ale můj zápas mezitím skončil (kontumace) nebo se kvůli
   * neshodě hraje znovu – zpět na pavouka.
   */
  private checkAbandoned(): void {
    const s = this.value;
    if (!this.playing || !s || !this.app.waitingForOpponent) return;
    const current = myReadyMatch(s);
    if (!current || key(current) !== this.playing) {
      this.playing = null;
      this.app.goTournament();
    }
  }

  /** Místnost soupeře, do které se dá připojit (ne moje, ne nefunkční). */
  private joinableRoom(m: TournamentMatch): string | null {
    return m.room && !this.myRooms.has(m.room) && !this.failedRooms.has(m.room) ? m.room : null;
  }

  /**
   * Smím místnost založit? Horní hráč vždy; dolní, když horní 2 minuty nezaložil
   * funkční místnost (server to hlídá stejně).
   */
  canHost(m: TournamentMatch): boolean {
    const s = this.value;
    if (!s || s.me === null) return false;
    if (m.a === s.me) return true;
    const noRoom = !m.room || this.failedRooms.has(m.room) || this.myRooms.has(m.room);
    return noRoom && (m.readyAge ?? 0) > 130 && (m.roomAge === null || m.roomAge > 130);
  }

  /** Místnost soupeře je připravená k připojení. */
  canJoin(m: TournamentMatch): boolean {
    return this.joinableRoom(m) !== null;
  }

  private autoPlay(): void {
    const s = this.value;
    if (!s || this.mode !== 'screen' || this.playing) return;
    const m = myReadyMatch(s);
    if (!m || m.reported) return;
    const opp = this.opponent(m);
    if (!opp || opp.ai || opp.gone) return;
    const room = this.joinableRoom(m);
    if (room) {
      this.playOnline(m, room);
    } else if (m.a === s.me && !this.autoTried.has(key(m))) {
      // Horní hráč založí místnost sám – jen poprvé, pak tlačítkem.
      this.autoTried.add(key(m));
      this.playOnline(m, null);
    }
  }

  /** Zahrát můj připravený zápas (proti AI v prohlížeči, proti hráči online). */
  play(): void {
    const s = this.value;
    const m = s ? myReadyMatch(s) : null;
    if (!s || !m || m.reported) return;
    const opp = this.opponent(m);
    if (!opp) return;
    if (opp.ai) this.playVsAi(m);
    else if (this.joinableRoom(m)) this.playOnline(m, this.joinableRoom(m));
    else if (this.canHost(m)) this.playOnline(m, null);
  }

  /** host = já zakládám místnost (jsem hráč A místnosti). */
  private link(m: TournamentMatch, host: boolean): TournamentLink {
    const ref: MatchRef = { round: m.round, idx: m.idx };
    const me = this.value?.me ?? m.a ?? 0;
    const other = m.a === me ? (m.b ?? 0) : (m.a ?? 0);
    let finished = false;
    return {
      match: ref,
      slots: host ? { A: me, B: other } : { A: other, B: me },
      top: m.a ?? 0,
      finish: (winner, scoreA, scoreB) => {
        if (finished) return;
        finished = true;
        this.pendingReport = { match: ref, winner, scoreA, scoreB };
        void this.sendReport().then(() => this.refresh());
      },
      roomCreated: (code) => {
        this.myRooms.add(code);
        this.api.setRoom(ref, code).catch(() => undefined);
      },
      back: (failedRoom) => {
        if (failedRoom) this.failedRooms.add(failedRoom);
        this.playing = null;
        this.app.goTournament();
      },
      broadcast: async () => {
        const opening = this.app.openSpectateTransport();
        if (!opening) return null;
        let caster: SpectateCaster | null = null;
        try {
          caster = await SpectateCaster.open(await opening);
          if (await this.api.setWatch(ref, caster.token, caster.publicKey)) return caster;
        } catch {
          // Bez vysílání se hraje dál.
        }
        await caster?.close();
        return null;
      },
    };
  }

  private async sendReport(): Promise<void> {
    const report = this.pendingReport;
    if (!report) return;
    try {
      const result = await this.api.report(
        report.match,
        report.winner,
        report.scoreA,
        report.scoreB,
      );
      this.pendingReport = null;
      this.lastReport = result === 'pending' || result === 'replay' ? result : null;
    } catch {
      // Zkusí se znovu při dalším obnovení.
    }
  }

  /** room = připojit se do místnosti soupeře; null = založit vlastní. */
  private playOnline(m: TournamentMatch, room: string | null): void {
    const s = this.value;
    if (!s || s.me === null) return;
    this.playing = key(m);
    this.lastReport = null;
    this.setMode('background');
    if (room) this.app.joinTournamentMatch(this.link(m, false), room);
    else this.app.hostTournamentMatch(this.link(m, true));
  }

  private playVsAi(m: TournamentMatch): void {
    const s = this.value;
    const opp = this.opponent(m);
    if (!s || s.me === null || !opp) return;
    this.playing = key(m);
    this.lastReport = null;
    this.setMode('background');
    this.app.playTournamentAi(this.link(m, true), opp);
  }

  /** Připojit se kódem (i z pozvánky); po úspěchu obrazovka turnaje. */
  async join(code: string): ReturnType<TournamentApi['join']> {
    const result = await this.api.join(code);
    if (result === 'joined' || result === 'busy') await this.refresh();
    return result;
  }

  async create(): ReturnType<TournamentApi['create']> {
    const result = await this.api.create();
    await this.refresh();
    return result;
  }

  async start(): ReturnType<TournamentApi['start']> {
    const result = await this.api.start();
    await this.refresh();
    return result;
  }

  async leave(): Promise<void> {
    await this.api.leave();
    this.autoTried.clear();
    this.failedRooms.clear();
    this.myRooms.clear();
    this.lastReport = null;
    await this.refresh();
  }
}
