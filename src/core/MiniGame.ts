import type { ZodType } from 'zod';
import type {
  CognitiveProfile,
  Difficulty,
  GameId,
  GameLength,
  GameMode,
  GameType,
  Outcome,
  PerPlayer,
  PlayerSlot,
} from './types';
import type { Clock } from './util/clock';
import type { Rng } from './util/rng';

export interface GameInfo {
  readonly id: GameId;
  readonly name: string;
  readonly type: GameType;
  readonly length: GameLength;
}

export interface SetupEnv {
  readonly rng: Rng;
  readonly starter: PlayerSlot;
}

/** Čistá herní pravidla – žádný DOM, síť ani časovače. Stav je neměnný. */
export interface GameLogic<S, M, V> {
  setup(env: SetupEnv): S;
  /** Kdo smí právě táhnout; oba hráči = současný tah. */
  toMove(state: S): readonly PlayerSlot[];
  legal(state: S, player: PlayerSlot, move: M): boolean;
  apply(state: S, player: PlayerSlot, move: M): S;
  /** null = hraje se dál. Tady každá hra definuje, co je remíza. */
  outcome(state: S): Outcome | null;
  /** Jen to, co daný hráč smí vidět. */
  view(state: S, viewer: PlayerSlot): V;
}

/** Paměť AI napříč koly (např. historie tahů soupeře v KNP). */
export class AIMemory {
  private readonly store = new Map<string, unknown>();

  get<T>(key: string, init: () => T): T {
    if (!this.store.has(key)) this.store.set(key, init());
    return this.store.get(key) as T;
  }
}

/** Karty, které hráč zná: pozice v zamíchaném balíčku → karta. */
export type KnownCards = ReadonlyMap<number, number>;

export interface AIContext {
  readonly difficulty: Difficulty;
  readonly rng: Rng;
  readonly me: PlayerSlot;
  readonly memory: AIMemory;
  /** Karetní hry: karty, které AI smí znát (vlastní ruka a veřejné karty). */
  readonly cards?: KnownCards;
  /** Hry v mlze: co AI ví (vlastní poloha a co viděla). */
  readonly fog?: FogKnowledge;
}

export interface Prefs {
  readonly reducedMotion: boolean;
}

export type SfxName = 'signal' | 'click' | 'win' | 'lose' | 'draw' | 'tick';

export interface Sfx {
  play(name: SfxName): void;
  vibrate(pattern: number | readonly number[]): void;
}

export interface ViewContext<M> {
  readonly root: HTMLElement;
  readonly mode: GameMode;
  readonly names: PerPlayer<string>;
  /** Hráči, kteří hrají na tomto zařízení (PvE: ['A'], lokálně: ['A','B']). */
  readonly localPlayers: readonly PlayerSlot[];
  submit(player: PlayerSlot, move: M): void;
  /** Hry se skrytou informací: hráč potvrdil svá tajná data (rozmístění lodí, kód). */
  submitSecret(player: PlayerSlot, secret: unknown): void;
  readonly clock: Clock;
  readonly prefs: Prefs;
  readonly sfx: Sfx;
}

export interface RenderFrame {
  /** Čí pohled se vykresluje (v lokální hře se mění po předání zařízení). */
  readonly perspective: PlayerSlot;
  /** Lokální hráči, kteří právě smí zadat tah. */
  readonly canAct: readonly PlayerSlot[];
  readonly finished: Outcome | null;
  /** Online: hráči, kteří už poslali zapečetěný tah (commit), ale ještě ho neodhalili. */
  readonly committed: readonly PlayerSlot[];
  /** Tajná data hráče z `perspective`, pokud je toto zařízení zná (jinak null). */
  readonly secret: unknown;
  /**
   * Tajná data soupeře – jen po konci hry, když je toto zařízení zná (lokálně hned,
   * online až po odhalení a ověření). Jinak null.
   */
  readonly opponentSecret: unknown;
  /** Karetní hry: karty, které zná hráč z `perspective`; null = balíček se ještě míchá. */
  readonly cards: KnownCards | null;
  /** Hry v mlze: co ví hráč z `perspective` (jinak null). */
  readonly fog: FogKnowledge | null;
}

export interface CardAt {
  readonly pos: number;
  readonly card: number;
}

/**
 * Karetní hry. Logika zná jen pozice v zamíchaném balíčku (kdo má kterou v ruce, co leží
 * na stole) a karty, které už jsou veřejně odhalené. Identity karet drží „rozdávající“
 * (CardDealer): lokálně zná celý balíček, online ho nahrazuje mental poker.
 */
export interface CardRules<S, M, V> {
  /** Počet karet; karta = číslo 0..deckSize−1 (význam určuje hra). */
  readonly deckSize: number;
  /** Pozice, které smí znát jen daný hráč (jeho ruka). */
  privateFor(view: V, player: PlayerSlot): readonly number[];
  /** Karty, které jsou už veřejně známé (vyložené, otočené, odhalené na konci). */
  publicCards(view: V): readonly CardAt[];
  /** Pozice, na jejichž veřejné odhalení hra čeká – do té doby nikdo netáhne. */
  pendingPublic(view: V): readonly number[];
  /** Zapíše odhalené karty do stavu (online to obě strany udělají stejně). */
  reveal(state: S, cards: readonly CardAt[]): S;
  /** Karty, které tah tvrdí (vyložení z ruky) – rozdávající je před provedením ověří. */
  claims(move: M): readonly CardAt[];
  /** Tah, který plyne z vlastních karet (např. přetažení v Oko bere = stát). */
  autoMove?(view: V, player: PlayerSlot, known: KnownCards): M | null;
}

/** Kdo zná karty: lokálně celý balíček, online mental poker (klíče od soupeře). */
export interface CardDealer {
  /** Balíček je zamíchaný a připravený. */
  ready(): Promise<void>;
  /** Na co mají hráči nárok – online se soupeři pošlou klíče k jeho kartám. */
  entitle(entitled: PerPlayer<readonly number[]>): void;
  /** Karty, které hráč zná (jen v mezích nároku). */
  known(player: PlayerSlot): KnownCards;
  /** Karty na pozicích, pokud je toto zařízení už zná (jinak null). */
  peek(positions: readonly number[]): CardAt[] | null;
  /** Leží na pozicích opravdu tvrzené karty? */
  check(claims: readonly CardAt[]): boolean;
  /** Přibyla znalost (online: dorazil klíč). Vrací odhlášení. */
  onChange(cb: () => void): () => void;
}

/**
 * Hry se skrytou informací (Lodě, Logik). Logika tajná data vůbec nezná – stav obsahuje
 * jen veřejné dotazy a odpovědi. Odpovědi počítá klient vlastníka z jeho tajných dat;
 * online se data na začátku zavážou hashem a na konci odhalí a ověří.
 */
export interface HiddenInfo<Sec, M, V> {
  readonly secretSchema: ZodType<Sec>;
  isValidSecret(secret: Sec): boolean;
  randomSecret(rng: Rng): Sec;
  /**
   * Tah vynucený tajnými daty hráče – „připraven“ po zadání dat nebo odpověď na dotaz
   * soupeře. null = hráč teď nic automaticky neodpovídá.
   */
  respond(view: V, player: PlayerSlot, secret: Sec): M | null;
  /**
   * Čeká se na tah, který plyne z tajných dat hráče (rozmístění, odpověď)? Za takový tah
   * nejde zahrát náhodně – bez dat se hráči přidělí náhodná, vzdálenému hráči nic.
   */
  awaitsSecret(view: V, player: PlayerSlot): boolean;
  /** Od této chvíle už musí mít oba hráči závazek (hra začala). */
  locked(view: V): boolean;
  /** Odpovídají všechny odpovědi hráče v závěrečném pohledu jeho tajným datům? */
  consistent(finalView: V, player: PlayerSlot, secret: Sec): boolean;
  /** Výsledek spočítaný jen z veřejného závěrečného pohledu (pro kontrolu u hosta). */
  outcome(finalView: V): Outcome | null;
}

export interface GameView<V> {
  render(view: V, frame: RenderFrame): void;
  destroy(): void;
}

/**
 * Jak se hra hraje lokálně na jednom zařízení:
 * split   – každý hráč má svou polovinu obrazovky / své klávesy (reakční hry),
 * shared  – společná deska bez tajných informací,
 * hotseat – tajná volba, mezi tahy obrazovka „Předej zařízení“.
 */
export type LocalLayout = 'split' | 'shared' | 'hotseat';

/** Co hráč viděl po veřejném tahu `index` (hry v mlze). */
export interface Sighting {
  readonly index: number;
  /** Úsek hry (např. poločas) – soukromé stavy se na začátku úseku vrací na start. */
  readonly segment: number;
  /** Kdo tahem pohnul; null = začátek úseku. */
  readonly mover: PlayerSlot | null;
  /** Vlastní soukromý stav v tu chvíli. */
  readonly own: unknown;
  /** Štítky soupeře, které hráč viděl (např. „F:23“ = liška na poli 23). */
  readonly seen: readonly string[];
}

/** Co ví hráč v mlze. */
export interface FogKnowledge {
  /** Vlastní soukromý stav (poloha, trasa). */
  readonly own: unknown;
  readonly sightings: readonly Sighting[];
  /** Soukromé stavy soupeře z uzavřených úseků – lokálně hned, online po ověření. */
  readonly revealed: ReadonlyMap<number, unknown>;
}

/**
 * Hry v mlze (Hon v mlze): kde kdo stojí, zná jen jeho zařízení. Logika vede jen veřejný
 * průběh (kdo je na tahu, kdy byl kdo chycen). Tah může mít soukromou část (cestu), která
 * se online nikam neposílá. Co kdo vidí, je průnik štítků „kam pozorovatel dohlédne“
 * (queries) a „čím se soupeř prozrazuje“ (exposed) – lokálně se spočítá přímo, online
 * šifrovaně, takže se nikdo nedozví nic navíc. Po každém úseku se trasy odhalí a ověří.
 */
export interface FogRules<M, V, Pv> {
  /** Nejvíc štítků, kam hráč dohlédne (online se doplní na tento počet). */
  readonly maxQueries: number;
  /** Nejvíc štítků, kterými se hráč prozrazuje. */
  readonly maxExposed: number;
  /** Úsek hry; při změně se soukromé stavy vrátí na start a předchozí úsek se odhalí. */
  segment(view: V): number;
  start(view: V, player: PlayerSlot): Pv;
  /** Soukromý stav po vlastním tahu; null = neplatný krok (nebo chybí soukromá část). */
  advance(view: V, player: PlayerSlot, own: Pv, move: M): Pv | null;
  /** Tah bez soukromých údajů – jde do sítě a do záznamu. */
  publicMove(move: M): M;
  /** Zjišťuje se po tomto tahu znovu, kdo co vidí? */
  observes(move: M): boolean;
  exposed(view: V, player: PlayerSlot, own: Pv): readonly string[];
  queries(view: V, player: PlayerSlot, own: Pv): readonly string[];
  /** Tah vynucený tím, co hráč ví (např. ohlášení chycení). */
  respond(view: V, player: PlayerSlot, knowledge: FogKnowledge): M | null;
  /** Ověření veřejného tahu se znalostí obou soukromých stavů (po odhalení). */
  check(view: V, player: PlayerSlot, move: M, privates: PerPlayer<Pv>): boolean;
}

/** Kdo co ví v mlze: lokálně obě strany, online jen vlastní (zbytek šifrovaně). */
export interface FogKeeper {
  /** Začátek hry: výchozí soukromé stavy a první pozorování. */
  begin(viewOf: (player: PlayerSlot) => unknown): void;
  /** Lokální hráč chce táhnout – platí soukromá část? (zapíše se až s veřejným tahem) */
  stage(player: PlayerSlot, view: unknown, move: unknown): boolean;
  /** Veřejný tah číslo `index` je zapsaný (u obou klientů ve stejném pořadí). */
  record(
    index: number,
    player: PlayerSlot,
    move: unknown,
    viewOf: (player: PlayerSlot) => unknown,
  ): void;
  /** Pozorování po posledním tahu jsou hotová – do té doby nikdo netáhne. */
  ready(): boolean;
  knowledge(player: PlayerSlot): FogKnowledge | null;
  /** Konec hry – online se odhalí poslední úsek. */
  finish(): void;
  /** Přibyla znalost (dorazilo pozorování nebo odhalení). Vrací odhlášení. */
  onChange(cb: () => void): () => void;
}

export interface MiniGameModule<S, M, V, Sec = unknown> extends GameInfo {
  /** Kognitivní skupiny hry – podle hlavní se budou počítat statistiky hráče. */
  readonly cognitive: CognitiveProfile;
  readonly rules: readonly string[];
  controls(mode: GameMode): readonly string[];
  readonly localLayout: LocalLayout;
  /** Limit na tah (neaktivita → automatický tah). null = hra si časování řídí sama. */
  readonly moveTimeoutMs: number | null;
  /** Limit na tah podle fáze hry (např. delší na rozmístění lodí); přebíjí moveTimeoutMs. */
  moveTimeout?(view: V): number | null;
  /** Skrytá informace (tajná data hráčů) – viz HiddenInfo. */
  readonly hidden?: HiddenInfo<Sec, M, V>;
  /** Karetní hra – viz CardRules. */
  readonly cards?: CardRules<S, M, V>;
  /** Hra v mlze – viz FogRules. */
  readonly fog?: FogRules<M, V, unknown>;
  /** Hotseat: jak dlouho nechat hráče vidět výsledek jeho tahu, než se zařízení předá. */
  readonly handoffDelayMs?: number;
  /** Jak dlouho nechat vidět konec hry, než přijde výsledek kola. */
  readonly revealMs: number;
  /**
   * Výsledek kola ukáže i závěrečnou desku s odhalenými tajnými daty obou hráčů
   * (Lodě: kam kdo střílel a kde lodě opravdu byly). Vykreslí ji `createView`.
   */
  readonly showFinalBoard?: boolean;
  readonly logic: GameLogic<S, M, V>;
  /** Validace vstupu (hlavně ze sítě). */
  readonly moveSchema: ZodType<M>;
  /** Validace pohledu, který online host dostává od hostitele. */
  readonly viewSchema: ZodType<V>;
  /**
   * Online: tahy se posílají zapečetěné (commit-reveal), protože hostitel je zároveň hráč
   * a jinak by viděl volbu soupeře dřív, než zvolí sám. Jen pro hry s jedním současným
   * tajným tahem na hráče – host pak výsledek ověří přehráním z odhalených tahů.
   */
  readonly sealed?: {
    /** Tah hráče, jak je vidět v závěrečném pohledu (pro kontrolu proti odhalení). */
    moveOf(finalView: V, player: PlayerSlot): M | null;
  };
  /**
   * Lehká obtížnost musí vždy vrátit platný tah – používá se i jako automatický tah.
   * U her se skrytou informací se volá jen mimo tahy z tajných dat (viz awaitsSecret).
   */
  getAIMove(view: V, ai: AIContext): M;
  /** Tah za hráče, který nereaguje (výchozí: tah lehké AI). */
  inactiveMove?(view: V): M;
  /** Za jak dlouho AI tah odehraje; výchozí je „přemýšlení“ 0,5–1,5 s. */
  aiDelayMs?(view: V, move: M, ai: AIContext): number;
  aiObserve?(finalView: V, ai: AIContext): void;
  summarize(finalView: V, names: PerPlayer<string>): string;
  createView(ctx: ViewContext<M>): GameView<V>;
}

export type AnyMiniGameModule = MiniGameModule<unknown, unknown, unknown, unknown>;

export function defineGame<S, M, V, Sec = unknown>(
  game: MiniGameModule<S, M, V, Sec>,
): AnyMiniGameModule {
  return game;
}

export type SeatConfig =
  | { readonly kind: 'human' }
  | { readonly kind: 'ai'; readonly difficulty: Difficulty }
  | { readonly kind: 'remote' };

export interface RoundContext {
  readonly root: HTMLElement;
  readonly mode: GameMode;
  readonly names: PerPlayer<string>;
  readonly seats: PerPlayer<SeatConfig>;
  readonly starter: PlayerSlot;
  /** Herní náhoda (deterministická ze seedu zápasu). */
  readonly rng: Rng;
  readonly aiRng: Rng;
  readonly aiMemory: AIMemory;
  readonly clock: Clock;
  readonly prefs: Prefs;
  readonly sfx: Sfx;
  handoff(to: PlayerSlot): Promise<void>;
  showTurnTimer(deadline: number | null, totalMs: number): void;
  /** Online: napojení na síť. */
  readonly bridge?: RunnerBridge;
  /** Online karetní hry: mental poker místo lokálního rozdávajícího. */
  readonly dealer?: CardDealer;
  /** Online hry v mlze: šifrovaná pozorování místo lokálních. */
  readonly fog?: FogKeeper;
}

export interface RemoteUpdate {
  readonly view: unknown;
  readonly canAct: boolean;
  readonly committed: readonly PlayerSlot[];
  readonly finished: Outcome | null;
}

export interface RunnerBridge {
  /** Po každé změně stavu: pohled vzdáleného hráče, který se pošle soupeři. */
  publish(update: RemoteUpdate): void;
  /**
   * Tah lokálního hráče (kvůli zapečetění a počítání neaktivity).
   * @param simultaneous na tahu byl i soupeř (současný tah – online se pečetí)
   * @param forced tah vynucený znalostí (ohlášení chycení) – nepočítá se do neaktivity
   */
  localMove(
    player: PlayerSlot,
    move: unknown,
    auto: boolean,
    simultaneous: boolean,
    forced?: boolean,
  ): void;
  /** Tajná data lokálního hráče – odešle se závazek (hash) dřív, než hra pokračuje. */
  commitSecret?(player: PlayerSlot, secret: unknown): Promise<void>;
}

/** Závěrečný stav hry pro výsledek kola – deska s odhalenými tajnými daty obou hráčů. */
export interface FinalBoard {
  /** Z čího pohledu je `view`. */
  readonly perspective: PlayerSlot;
  readonly view: unknown;
  /** Tajná data hráčů, která toto zařízení zná (online data soupeře až po ověření). */
  readonly secrets: PerPlayer<unknown>;
}

export interface RoundEnd {
  readonly outcome: Outcome;
  readonly summary: string;
  /** Jen u her s `showFinalBoard`. */
  readonly final?: FinalBoard;
}

/** Instance minihry pro jedno kolo – rozhraní ze zadání, implementuje ho GameRunner. */
export interface MiniGame {
  readonly info: GameInfo;
  init(ctx: RoundContext): void;
  start(): void;
  onInput(player: PlayerSlot, input: unknown): void;
  onEnd(cb: (result: RoundEnd) => void): void;
  destroy(): void;
}
