import { z } from 'zod';
import type { SupabaseConfig } from './config';

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
  /** profile null = první přihlášení, ještě bez přezdívky. */
  | { readonly kind: 'signed-in'; readonly profile: Profile | null };

export type AccountErrorCode =
  'invalid' | 'full' | 'too-soon' | 'network' | 'login-failed' | 'sign-out-failed';

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
      if (userId === id) set({ kind: 'signed-in', profile });
    } catch {
      // Profil se nenačetl (výpadek) – přihlášení zůstává, zkusí se znovu příště.
      if (userId === id) set({ kind: 'signed-in', profile: null });
    }
  }

  function ensureBackend(): Promise<AccountBackend> {
    backend ??= load(config as SupabaseConfig).then((api) => {
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
      set({ kind: 'signed-in', profile });
      return profile;
    },
    async deleteAccount() {
      const api = await ensureBackend();
      await api.deleteAccount();
      userId = null;
      set({ kind: 'guest' });
    },
  };
}
