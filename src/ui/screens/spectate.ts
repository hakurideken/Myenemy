import type { AnyMiniGameModule, GameView, Sfx } from '../../core/MiniGame';
import type { PerPlayer, PlayerSlot } from '../../core/types';
import { systemClock } from '../../core/util/clock';
import { getGame } from '../../games/registry';
import { translations } from '../../i18n';
import type { MatchRef } from '../../net/tournament';
import { TOURNAMENT_FORMAT } from '../../net/tournament';
import { SpectateReceiver, type SpectateBody } from '../../online/spectate';
import type { App, Mount } from '../App';
import { bigScore, button, versus } from '../components/common';
import { h, setText } from '../dom';

const t = translations(
  {
    kicker: 'Turnaj · sledování',
    connecting: 'Připojuji se k vysílání…',
    unavailable: 'Sledování teď nejde spustit (online server neodpovídá).',
    silent: 'Vysílání se odmlčelo – hráči možná zrovna přecházejí mezi hrami…',
    waiting: 'Hráči se připojují do zápasu…',
    intro: (game: string) => `Za chvíli začne: ${game}`,
    playing: (game: string) => `Hraje se: ${game}`,
    gameNo: (no: number, of: number) => `Hra ${no} z ${of}`,
    roundWon: (name: string) => `Hru vyhrál(a) ${name}.`,
    roundDraw: 'Hra skončila remízou.',
    matchWon: (name: string) => `Zápas vyhrál(a) ${name}!`,
    ended: 'Vysílání skončilo.',
    local: (game: string) =>
      `${game}: každý hráč hraje u sebe, živě to vidět nejde. Výsledek uvidíš hned po dohrání.`,
    eyes: 'Sleduješ očima hráče:',
    privacy:
      'Vidíš jen to, co je ve hře veřejné – karty v ruce, lodě ani polohu v mlze ne. „Ty“ ve hře je hráč, kterého sleduješ.',
    history: 'Průběh zápasu',
    draw: 'remíza',
    back: 'Zpět na turnaj',
  },
  {
    kicker: 'Tournament · watching',
    connecting: 'Connecting to the broadcast…',
    unavailable: 'Watching is not available right now (the online server is not responding).',
    silent: 'The broadcast has gone quiet – the players may be moving between games…',
    waiting: 'The players are joining the match…',
    intro: (game: string) => `Starting soon: ${game}`,
    playing: (game: string) => `Now playing: ${game}`,
    gameNo: (no: number, of: number) => `Game ${no} of ${of}`,
    roundWon: (name: string) => `${name} won the game.`,
    roundDraw: 'The game ended in a draw.',
    matchWon: (name: string) => `${name} wins the match!`,
    ended: 'The broadcast has ended.',
    local: (game: string) =>
      `${game}: each player plays on their own device, so it cannot be shown live. You will see the result right after.`,
    eyes: 'You are watching through the eyes of:',
    privacy:
      'You only see what is public in the game – no cards in hand, ships or positions in the fog. “You” in the game is the player you are watching.',
    history: 'Match history',
    draw: 'draw',
    back: 'Back to the tournament',
  },
);

const SILENT: Sfx = { play: () => undefined, vibrate: () => undefined };
/** Bez snímku déle než tohle = „odmlčelo se“. */
const SILENT_AFTER_MS = 12_000;

export interface WatchTarget {
  readonly match: MatchRef;
  readonly token: string;
  readonly publicKey: string;
  /** Jména podle pavouku (než dorazí první snímek). */
  readonly names: PerPlayer<string>;
}

function findGame(id: string): AnyMiniGameModule | null {
  try {
    return getGame(id);
  } catch {
    return null;
  }
}

/** Divák: živý průběh turnajového zápasu (veřejné pohledy, skóre, historie). */
export function spectateScreen(app: App, target: WatchTarget): Mount {
  return (root) => {
    let alive = true;
    let body: SpectateBody | null = null;
    let lastAt = Date.now();
    let perspective: PlayerSlot = 'A';
    let view: GameView<unknown> | null = null;
    let viewKey = '';

    const title = h('h1', { class: 'screen-title', tabindex: '-1' }, versus(target.names));
    const status = h('p', { class: 'spectate-status', role: 'status' }, t.connecting);
    const score = h('div', { class: 'spectate-score' });
    const gameLine = h('p', { class: 'spectate-game' });
    const eyes = h('div', { class: 'spectate-eyes', role: 'group', 'aria-label': t.eyes });
    // Styly her jsou vázané na .game--ID a .game-stage (jako na herní obrazovce).
    const board = h('div', { class: 'game-stage spectate-board' });
    const historyBox = h('div');

    const main = h(
      'main',
      { class: 'screen screen--spectate' },
      h('p', { class: 'kicker' }, t.kicker),
      title,
      score,
      gameLine,
      status,
      eyes,
      board,
      h('p', { class: 'note' }, t.privacy),
      historyBox,
      button(t.back, () => app.goTournament(), 'btn btn-ghost', { 'data-autofocus': true }),
    );
    root.append(main);

    const destroyView = (): void => {
      view?.destroy();
      view = null;
      viewKey = '';
      board.replaceChildren();
    };

    const renderEyes = (names: PerPlayer<string>): void => {
      eyes.replaceChildren(
        h('span', { class: 'field-label' }, t.eyes),
        ...(['A', 'B'] as const).map((p) =>
          button(
            names[p],
            () => {
              if (perspective === p) return;
              perspective = p;
              if (body) render(body);
            },
            perspective === p ? 'btn btn-small btn-primary' : 'btn btn-small',
            { 'aria-pressed': perspective === p ? 'true' : 'false' },
          ),
        ),
      );
    };

    const renderBoard = (b: SpectateBody, game: AnyMiniGameModule): void => {
      if (game.spectator === false || !b.views || !b.game) {
        destroyView();
        if (game.spectator === false && (b.phase === 'playing' || b.phase === 'intro')) {
          board.append(h('p', { class: 'spectate-local' }, t.local(game.name)));
        }
        return;
      }
      const parsed = game.viewSchema.safeParse(b.views[perspective]);
      if (!parsed.success) return;
      const key = `${b.game.no}:${b.game.replay}:${b.game.id}:${perspective}`;
      if (key !== viewKey) {
        destroyView();
        viewKey = key;
        main.className = `screen screen--spectate game--${game.id}`;
        view = game.createView({
          root: board,
          mode: 'online',
          names: b.names,
          localPlayers: [],
          submit: () => undefined,
          submitSecret: () => undefined,
          clock: systemClock,
          prefs: app.prefs(),
          sfx: SILENT,
        });
      }
      const publicView = parsed.data;
      view?.render(publicView, {
        perspective,
        canAct: [],
        finished: b.finished,
        committed: [],
        secret: null,
        opponentSecret: null,
        cards: game.cards
          ? new Map(game.cards.publicCards(publicView).map((c) => [c.pos, c.card]))
          : null,
        fog: null,
      });
    };

    /**
     * Jména ze snímku jen když odpovídají pavouku (strana A/B v místnosti se od pavouku
     * může lišit); jinak jména z pavouku – vysílající nemůže podstrčit cizí jméno.
     */
    const trustedNames = (b: SpectateBody): PerPlayer<string> => {
      const sent = [b.names.A, b.names.B].sort();
      const known = [target.names.A, target.names.B].sort();
      return sent[0] === known[0] && sent[1] === known[1] ? b.names : target.names;
    };

    function render(incoming: SpectateBody): void {
      const b: SpectateBody = { ...incoming, names: trustedNames(incoming) };
      title.replaceChildren(versus(b.names));
      renderEyes(b.names);
      score.replaceChildren(bigScore(b.score, null));
      const game = b.game ? findGame(b.game.id) : null;
      setText(
        gameLine,
        b.game && game
          ? `${t.gameNo(b.game.no, TOURNAMENT_FORMAT.kind === 'vlastni' ? TOURNAMENT_FORMAT.bestOf : 9)} · ${game.name}`
          : '',
      );
      const last = b.history.at(-1);
      let text = '';
      switch (b.phase) {
        case 'waiting':
          text = t.waiting;
          break;
        case 'intro':
          text = game ? t.intro(game.name) : '';
          break;
        case 'playing':
          text = game ? t.playing(game.name) : '';
          break;
        case 'round-result':
          text = last?.winner ? t.roundWon(b.names[last.winner]) : t.roundDraw;
          break;
        case 'match-result':
          text = b.winner ? t.matchWon(b.names[b.winner]) : t.ended;
          break;
        case 'ended':
          text = t.ended;
          break;
      }
      setText(status, text);
      if (game && (b.phase === 'intro' || b.phase === 'playing' || b.phase === 'round-result')) {
        renderBoard(b, game);
      } else {
        destroyView();
      }
      historyBox.replaceChildren(
        b.history.length === 0
          ? ''
          : h(
              'ol',
              { class: 'history', 'aria-label': t.history },
              b.history.map((r) =>
                h(
                  'li',
                  null,
                  h('span', { class: 'history-no' }, `${r.no}.`),
                  h('span', null, findGame(r.id)?.name ?? r.id),
                  h('span', { class: 'history-result' }, r.winner ? b.names[r.winner] : t.draw),
                ),
              ),
            ),
      );
    }

    renderEyes(target.names);
    let receiver: SpectateReceiver | null = null;
    const opening = app.openSpectateTransport();
    if (!opening) {
      setText(status, t.unavailable);
    } else {
      opening
        .then((transport) =>
          SpectateReceiver.open(transport, target.token, target.publicKey, (next) => {
            if (!alive) return;
            body = next;
            lastAt = Date.now();
            render(next);
          }),
        )
        .then(
          (r) => {
            if (alive) receiver = r;
            else void r.close();
          },
          () => {
            if (alive) setText(status, t.unavailable);
          },
        );
    }
    const watchdog = setInterval(() => {
      if (!body || (body.phase !== 'match-result' && body.phase !== 'ended')) {
        if (Date.now() - lastAt > SILENT_AFTER_MS) setText(status, t.silent);
      }
    }, 2_000);

    return () => {
      alive = false;
      clearInterval(watchdog);
      destroyView();
      void receiver?.close();
    };
  };
}
