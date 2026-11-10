import { describe, expect, it, vi } from 'vitest';
import {
  AccountError,
  AUTH_STORAGE_KEY,
  createAccount,
  formatHandle,
  hasStoredSession,
  isOAuthReturn,
  withoutOAuthParams,
  type AccountBackend,
  type AccountState,
  type Profile,
} from './account';

const config = { url: 'https://x.supabase.co', anonKey: 'anon' };
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function fakeBackend(options: { user?: string | null; profile?: Profile | null } = {}) {
  let userHandler: ((id: string | null) => void) | null = null;
  let profile = options.profile ?? null;
  const signOut = vi.fn(() => Promise.resolve());
  const deleteAccount = vi.fn(() => Promise.resolve());
  const backend: AccountBackend = {
    init: vi.fn(() => Promise.resolve(options.user ? { userId: options.user } : null)),
    onUserChange: (handler) => {
      userHandler = handler;
    },
    signIn: vi.fn(() => Promise.resolve()),
    signOut,
    profile: vi.fn(() => Promise.resolve(profile)),
    setNickname: vi.fn((nickname: string) => {
      if (nickname === 'zlé') return Promise.reject(new AccountError('invalid'));
      profile = { nickname, tag: 42 };
      return Promise.resolve(profile);
    }),
    exportData: () => Promise.resolve({ profile }),
    friends: () => Promise.resolve([]),
    friendRequests: vi.fn(() =>
      Promise.resolve([
        { id: '00000000-0000-4000-8000-000000000001', nickname: 'Ema', tag: 5, incoming: true },
      ]),
    ),
    sendFriendRequest: () => Promise.resolve('sent' as const),
    respondFriendRequest: () => Promise.resolve(),
    cancelFriendRequest: () => Promise.resolve(),
    removeFriend: () => Promise.resolve(),
    reportMatch: () => Promise.resolve('pending' as const),
    notifications: () =>
      Promise.resolve({
        requests: 1,
        invites: [
          { id: '00000000-0000-4000-8000-000000000009', nickname: 'Ema', tag: 5, room: 'ABCDE' },
        ],
      }),
    sendGameInvite: () => Promise.resolve('sent' as const),
    dismissGameInvite: () => Promise.resolve(),
    cancelGameInvites: () => Promise.resolve(),
    deleteAccount,
  };
  return { backend, signOut, deleteAccount, emitUser: (id: string | null) => userHandler?.(id) };
}

function setup(
  backend: AccountBackend,
  { stored = false, search = '' }: { stored?: boolean; search?: string } = {},
) {
  const load = vi.fn(() => Promise.resolve(backend));
  const account = createAccount({
    config,
    load,
    storage: { getItem: (key) => (stored && key === AUTH_STORAGE_KEY ? '{}' : null) },
    search: () => search,
  });
  const states: AccountState['kind'][] = [];
  account.onChange((s) => states.push(s.kind));
  return { account, load, states };
}

describe('účet – pomocné funkce', () => {
  it('jméno pro kamarády: přezdívka a čtyřmístný kód', () => {
    expect(formatHandle({ nickname: 'Pepa', tag: 42 })).toBe('Pepa#0042');
    expect(formatHandle({ nickname: 'Žofie', tag: 9999 })).toBe('Žofie#9999');
  });

  it('návrat z přihlášení: pozná ho a parametry z adresy odstraní', () => {
    expect(isOAuthReturn('?code=abc')).toBe(true);
    expect(isOAuthReturn('?error=access_denied&error_description=x')).toBe(true);
    expect(isOAuthReturn('?room=ABCDE')).toBe(false);
    expect(withoutOAuthParams('?code=abc&room=ABCDE')).toBe('?room=ABCDE');
    expect(withoutOAuthParams('?code=abc')).toBe('');
  });

  it('uložené přihlášení – i když úložiště nejde číst', () => {
    expect(hasStoredSession({ getItem: () => '{}' })).toBe(true);
    expect(hasStoredSession({ getItem: () => null })).toBe(false);
    expect(
      hasStoredSession({
        getItem: () => {
          throw new Error('blokováno');
        },
      }),
    ).toBe(false);
    expect(hasStoredSession(null)).toBe(false);
  });
});

describe('účet – průběh', () => {
  it('bez nastaveného Supabase účty nejsou', () => {
    const account = createAccount({ config: null });
    expect(account.state.kind).toBe('unavailable');
  });

  it('host bez uloženého přihlášení: knihovna se vůbec nestahuje', async () => {
    const { backend } = fakeBackend();
    const { account, load } = setup(backend);
    account.start();
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(account.state.kind).toBe('guest');
  });

  it('uložené přihlášení s profilem: rovnou přihlášený s přezdívkou a kódem', async () => {
    const { backend } = fakeBackend({ user: 'u1', profile: { nickname: 'Pepa', tag: 7 } });
    const { account, states } = setup(backend, { stored: true });
    account.start();
    await flush();
    // Po profilu se načtou upozornění – čeká žádost o přátelství a pozvánka do hry.
    expect(states).toEqual(['loading', 'signed-in', 'signed-in']);
    expect(account.state).toEqual({
      kind: 'signed-in',
      profile: { nickname: 'Pepa', tag: 7 },
      incoming: 1,
      invites: [
        { id: '00000000-0000-4000-8000-000000000009', nickname: 'Ema', tag: 5, room: 'ABCDE' },
      ],
    });
  });

  it('první přihlášení (návrat od Googlu): bez profilu, po zvolení přezdívky má kód', async () => {
    const { backend } = fakeBackend({ user: 'u2' });
    const { account } = setup(backend, { search: '?code=xyz' });
    account.start();
    await flush();
    expect(account.state).toEqual({ kind: 'signed-in', profile: null, incoming: 0, invites: [] });
    await expect(account.setNickname('zlé')).rejects.toMatchObject({ code: 'invalid' });
    const profile = await account.setNickname('Jana');
    expect(profile).toEqual({ nickname: 'Jana', tag: 42 });
    expect(account.state).toEqual({ kind: 'signed-in', profile, incoming: 0, invites: [] });
  });

  it('nepovedené odhlášení na serveru: tady host, chyba se ohlásí', async () => {
    const { backend, signOut } = fakeBackend({ user: 'u4', profile: { nickname: 'Eva', tag: 3 } });
    signOut.mockImplementationOnce(() => Promise.reject(new AccountError('sign-out-failed')));
    const { account } = setup(backend, { stored: true });
    account.start();
    await flush();
    await expect(account.signOut()).rejects.toMatchObject({ code: 'sign-out-failed' });
    expect(account.state.kind).toBe('guest');
  });

  it('nepovedené přihlášení: zpět host s chybou', async () => {
    const { backend } = fakeBackend();
    backend.init = () => Promise.reject(new Error('síť'));
    const { account } = setup(backend, { stored: true });
    account.start();
    await flush();
    expect(account.state).toEqual({ kind: 'guest', error: 'login-failed' });
  });

  it('odhlášení i smazání účtu vrátí hosta; odhlášení v jiné záložce se projeví', async () => {
    const { backend, signOut, deleteAccount, emitUser } = fakeBackend({
      user: 'u3',
      profile: { nickname: 'Ota', tag: 1 },
    });
    const { account } = setup(backend, { stored: true });
    account.start();
    await flush();
    await account.signOut();
    expect(signOut).toHaveBeenCalled();
    expect(account.state.kind).toBe('guest');

    emitUser('u3'); // znovu přihlášen (jiná záložka)
    await flush();
    expect(account.state.kind).toBe('signed-in');
    emitUser(null); // odhlášen jinde
    await flush();
    expect(account.state.kind).toBe('guest');

    emitUser('u3');
    await flush();
    await account.deleteAccount();
    expect(deleteAccount).toHaveBeenCalled();
    expect(account.state.kind).toBe('guest');
  });
});
