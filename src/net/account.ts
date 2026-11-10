import { z } from 'zod';
import type { SupabaseConfig } from './config';
import type {
  Friend,
  FriendRequest,
  GameInvite,
  InviteResult,
  Notifications,
  ReportResult,
  SendRequestResult,
} from './friends';

/**
 * Účet hráče (přihlášení přes Google / Discord). Hrát jde i bez něj – účet je jen pro
 * kamarády a vzájemné výsledky. Knihovna Supabase Auth se stahuje, až když je potřeba.
 */

export type AuthProvider = 'google' | 'discord';
export const AUTH_PROVIDERS: readonly AuthProvider[] = ['google', 'discord'];

/** Klíč, pod kterým si Supabase Auth ukládá přihlášení v prohlížeči. */
export const AUTH_STORAGE_KEY = 'myenemy-auth';

export interface Profile {
  readonly nickname: string;
  /** Kód za přezdívkou (Pepa#0042). */
  readonly tag: number;
}

export const profileSchema = z.object({
  nickname: z.string().min(1).max(64),
  tag: z.number().int().min(1).max(9999),
});

/** Přezdívka s kódem, jak ji hráč sdílí kamarádům: Pepa#0042. */
export function formatHandle(profile: Profile): string {
  return `${profile.nickname}#${String(profile.tag).padStart(4, '0')}`;
}

export type AccountState =
  /** Supabase není nastavený – účty na tomhle webu nejsou. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'guest'; readonly error?: AccountErrorCode }
  | { readonly kind: 'loading' }
  /**
   * profile null = první přihlášení, ještě bez přezdívky.
   * incoming = počet žádostí o přátelství, které čekají na odpověď (tečka na účtu).
   */
  | {
      readonly kind: 'signed-in';
      readonly profile: Profile | null;
      readonly incoming: number;
      /** Pozvánky do hry od kamarádů (obnovují se průběžně). */
      readonly invites: readonly GameInvite[];
      /** Ukazuji kamarádům, že jsem online. */
      readonly showOnline: boolean;
    };

export type AccountErrorCode =
  'invalid' | 'full' | 'too-soon' | 'limit' | 'network' | 'login-failed' | 'sign-out-failed';

export class AccountError extends Error {
  override name = 'AccountError';
  constructor(readonly code: AccountErrorCode) {
    super(code);
  }
}

/** Spojení se Supabase (skutečné v accountClient.ts, v testech podvržené). */
export interface AccountBackend {
  /** Načte uložené přihlášení (i návrat z přihlášení u Googlu / Discordu). */
  init(): Promise<{ readonly userId: string } | null>;
  onUserChange(handler: (userId: string | null) => void): void;
  /** Přesměruje na přihlášení u poskytovatele. */
  signIn(provider: AuthProvider): Promise<void>;
  signOut(): Promise<void>;
  profile(userId: string): Promise<Profile | null>;
  setNickname(nickname: string): Promise<Profile>;
  /** Všechna data účtu (GDPR – právo na přístup). */
  exportData(): Promise<unknown>;
  deleteAccount(): Promise<void>;
  friends(): Promise<Friend[]>;
  friendRequests(): Promise<FriendRequest[]>;
  sendFriendRequest(profile: Profile): Promise<SendRequestResult>;
  respondFriendRequest(requestId: string, accept: boolean): Promise<void>;
  cancelFriendRequest(requestId: string): Promise<void>;
  removeFriend(userId: string): Promise<void>;
  /** Výsledek online zápasu; započítá se, až ho shodně nahlásí i soupeř (kamarád). */
  reportMatch(matchKey: string, won: boolean): Promise<ReportResult>;
  /** Ozvání „jsem tady“ (inMatch = hraju zápas) + souhrn žádostí a pozvánek. */
  ping(inMatch: boolean): Promise<Notifications>;
  /** Hned offline (zavření stránky, odhlášení). */
  presenceOffline(): Promise<void>;
  setShowOnline(show: boolean): Promise<void>;
  sendGameInvite(friendId: string, room: string): Promise<InviteResult>;
  dismissGameInvite(inviteId: string): Promise<void>;
  cancelGameInvites(room: string): Promise<void>;
}

export interface Account {
  readonly state: AccountState;
  onChange(handler: (state: AccountState) => void): () => void;
  /** Při startu: když je v prohlížeči přihlášení nebo se vracíme od poskytovatele. */
  start(): void;
  signIn(provider: AuthProvider): Promise<void>;
  signOut(): Promise<void>;
  setNickname(nickname: string): Promise<Profile>;
  exportData(): Promise<unknown>;
  deleteAccount(): Promise<void>;
  friends(): Promise<Friend[]>;
  /** Žádosti o přátelství; zároveň obnoví počet čekajících (tečka na účtu). */
  friendRequests(): Promise<FriendRequest[]>;
  sendFriendRequest(profile: Profile): Promise<SendRequestResult>;
  respondFriendRequest(requestId: string, accept: boolean): Promise<void>;
  cancelFriendRequest(requestId: string): Promise<void>;
  removeFriend(userId: string): Promise<void>;
  reportMatch(matchKey: string, won: boolean): Promise<ReportResult>;
  /** Průběžné obnovení žádostí a pozvánek; zároveň kamarádům hlásí „jsem online“. */
  refreshNotifications(inMatch?: boolean): Promise<void>;
  /** Zavírám stránku – kamarádům hned offline. */
  goOffline(): void;
  setShowOnline(show: boolean): Promise<void>;
  sendGameInvite(friendId: string, room: string): Promise<InviteResult>;
  dismissGameInvite(inviteId: string): Promise<void>;
  /** Hostitel ruší místnost – pozvánky do ní zmizí. */
  cancelGameInvites(room: string): Promise<void>;
}

/** Parametry, které po přihlášení přidá Supabase do adresy (kód pro výměnu, chyba). */
const OAUTH_PARAMS = ['code', 'error', 'error_code', 'error_description', 'state'];

export function isOAuthReturn(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has('code') || params.has('error');
}

/** Adresa bez parametrů přihlášení – ať je obnovení stránky nepoužije znovu. */
export function withoutOAuthParams(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of OAUTH_PARAMS) params.delete(key);
  const rest = params.toString();
  return rest ? `?${rest}` : '';
}

export function hasStoredSession(storage: Pick<Storage, 'getItem'> | null): boolean {
  try {
    return storage?.getItem(AUTH_STORAGE_KEY) != null;
  } catch {
    return false;
  }
}

export interface AccountOptions {
  readonly config: SupabaseConfig | null;
  readonly load?: (config: SupabaseConfig) => Promise<AccountBackend>;
  readonly storage?: Pick<Storage, 'getItem'> | null;
  readonly search?: () => string;
}

const UNAVAILABLE: Account = {
  state: { kind: 'unavailable' },
  onChange: () => () => undefined,
  start: () => undefined,
  signIn: () => Promise.reject(new AccountError('network')),
  signOut: () => Promise.resolve(),
  setNickname: () => Promise.reject(new AccountError('network')),
  exportData: () => Promise.reject(new AccountError('network')),
  deleteAccount: () => Promise.reject(new AccountError('network')),
  friends: () => Promise.resolve([]),
  friendRequests: () => Promise.resolve([]),
  sendFriendRequest: () => Promise.reject(new AccountError('network')),
  respondFriendRequest: () => Promise.reject(new AccountError('network')),
  cancelFriendRequest: () => Promise.reject(new AccountError('network')),
  removeFriend: () => Promise.reject(new AccountError('network')),
  reportMatch: () => Promise.resolve('ignored'),
  refreshNotifications: () => Promise.resolve(),
  goOffline: () => undefined,
  setShowOnline: () => Promise.reject(new AccountError('network')),
  sendGameInvite: () => Promise.reject(new AccountError('network')),
  dismissGameInvite: () => Promise.resolve(),
  cancelGameInvites: () => Promise.resolve(),
};

export function createAccount(options: AccountOptions): Account {
  const { config } = options;
  if (!config) return UNAVAILABLE;
  const load =
    options.load ??
    (async (c: SupabaseConfig): Promise<AccountBackend> => {
      const { createSupabaseAccountBackend } = await import('./accountClient');
      return createSupabaseAccountBackend(c);
    });
  const storage =
    options.storage === undefined
      ? typeof localStorage === 'undefined'
        ? null
        : localStorage
      : options.storage;
  const search = options.search ?? (() => window.location.search);

  let state: AccountState = { kind: 'guest' };
  let backend: Promise<AccountBackend> | null = null;
  /** Načtený backend (synchronně – kvůli zavírání stránky). */
  let loaded: AccountBackend | null = null;
  let userId: string | null = null;
  const handlers = new Set<(state: AccountState) => void>();

  const set = (next: AccountState): void => {
    state = next;
    for (const handler of handlers) handler(next);
  };

  /** Profil k přihlášenému uživateli (null = ještě nemá přezdívku). */
  async function refresh(api: AccountBackend, id: string | null): Promise<void> {
    userId = id;
    if (!id) {
      set({ kind: 'guest' });
      return;
    }
    try {
      const profile = await api.profile(id);
      if (userId === id)
        set({ kind: 'signed-in', profile, incoming: 0, invites: [], showOnline: true });
    } catch {
      // Profil se nenačetl (výpadek) – přihlášení zůstává, zkusí se znovu příště.
      if (userId === id)
        set({ kind: 'signed-in', profile: null, incoming: 0, invites: [], showOnline: true });
    }
    if (userId === id && state.kind === 'signed-in' && state.profile) {
      void loadNotifications(api).catch(() => undefined);
    }
  }

  async function loadRequests(api: AccountBackend): Promise<FriendRequest[]> {
    const id = userId;
    const requests = await api.friendRequests();
    const incoming = requests.filter((r) => r.incoming).length;
    if (userId === id && state.kind === 'signed-in' && state.incoming !== incoming) {
      set({ ...state, incoming });
    }
    return requests;
  }

  async function loadNotifications(api: AccountBackend, inMatch = false): Promise<void> {
    const id = userId;
    const { requests, invites, showOnline } = await api.ping(inMatch);
    if (userId !== id || state.kind !== 'signed-in') return;
    const same =
      state.incoming === requests &&
      state.invites.length === invites.length &&
      state.invites.every((inv, i) => inv.id === invites[i]?.id) &&
      state.showOnline === showOnline;
    if (!same) set({ ...state, incoming: requests, invites, showOnline });
  }

  /** Volání, která dávají smysl jen přihlášenému (s přezdívkou). */
  async function signedIn(): Promise<AccountBackend> {
    if (state.kind !== 'signed-in') throw new AccountError('network');
    return ensureBackend();
  }

  function ensureBackend(): Promise<AccountBackend> {
    backend ??= load(config as SupabaseConfig).then((api) => {
      loaded = api;
      api.onUserChange((id) => {
        if (id !== userId) void refresh(api, id);
      });
      return api;
    });
    // Nepovedené stažení knihovny zkusit znovu při dalším pokusu.
    backend.catch(() => {
      backend = null;
    });
    return backend;
  }

  async function init(): Promise<void> {
    set({ kind: 'loading' });
    try {
      const api = await ensureBackend();
      const session = await api.init();
      await refresh(api, session?.userId ?? null);
    } catch {
      set({ kind: 'guest', error: 'login-failed' });
    }
  }

  return {
    get state() {
      return state;
    },
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    start() {
      // Bez uloženého přihlášení se knihovna vůbec nestahuje.
      if (hasStoredSession(storage) || isOAuthReturn(search())) void init();
    },
    async signIn(provider) {
      try {
        const api = await ensureBackend();
        await api.signIn(provider);
      } catch {
        throw new AccountError('network');
      }
    },
    async signOut() {
      const api = await ensureBackend();
      // Kamarádům hned offline (dokud ještě platí přihlášení).
      await api.presenceOffline().catch(() => undefined);
      userId = null;
      try {
        await api.signOut();
      } finally {
        // V tomhle prohlížeči je hráč odhlášený vždy; chyba znamená, že se nepodařilo
        // zneplatnit přihlášení na serveru (jiná zařízení) – volající ji ohlásí.
        set({ kind: 'guest' });
      }
    },
    async exportData() {
      const api = await ensureBackend();
      return api.exportData();
    },
    async setNickname(nickname) {
      const api = await ensureBackend();
      const profile = await api.setNickname(nickname);
      const incoming = state.kind === 'signed-in' ? state.incoming : 0;
      const invites = state.kind === 'signed-in' ? state.invites : [];
      const showOnline = state.kind === 'signed-in' ? state.showOnline : true;
      set({ kind: 'signed-in', profile, incoming, invites, showOnline });
      return profile;
    },
    async deleteAccount() {
      const api = await ensureBackend();
      await api.deleteAccount();
      userId = null;
      set({ kind: 'guest' });
    },
    async friends() {
      return (await signedIn()).friends();
    },
    async friendRequests() {
      return loadRequests(await signedIn());
    },
    async sendFriendRequest(profile) {
      return (await signedIn()).sendFriendRequest(profile);
    },
    async respondFriendRequest(id, accept) {
      const api = await signedIn();
      await api.respondFriendRequest(id, accept);
      await loadRequests(api).catch(() => undefined);
    },
    async cancelFriendRequest(id) {
      return (await signedIn()).cancelFriendRequest(id);
    },
    async removeFriend(id) {
      return (await signedIn()).removeFriend(id);
    },
    async refreshNotifications(inMatch = false) {
      if (state.kind !== 'signed-in' || !state.profile) return;
      await loadNotifications(await ensureBackend(), inMatch);
    },
    goOffline() {
      if (state.kind !== 'signed-in' || !loaded) return;
      // Bez čekání na Promise – při zavírání stránky musí požadavek odejít hned.
      void loaded.presenceOffline().catch(() => undefined);
    },
    async setShowOnline(show) {
      const api = await signedIn();
      await api.setShowOnline(show);
      if (state.kind === 'signed-in') set({ ...state, showOnline: show });
    },
    async sendGameInvite(friendId, room) {
      return (await signedIn()).sendGameInvite(friendId, room);
    },
    async dismissGameInvite(inviteId) {
      const api = await signedIn();
      // Hned schovat (i kdyby síť chvíli trvala).
      if (state.kind === 'signed-in') {
        set({ ...state, invites: state.invites.filter((i) => i.id !== inviteId) });
      }
      await api.dismissGameInvite(inviteId);
    },
    async cancelGameInvites(room) {
      if (state.kind !== 'signed-in' || !state.profile) return;
      await (await ensureBackend()).cancelGameInvites(room);
    },
    async reportMatch(matchKey, won) {
      if (state.kind !== 'signed-in' || !state.profile) return 'ignored';
      return (await ensureBackend()).reportMatch(matchKey, won);
    },
  };
}
