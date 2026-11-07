import { GoTrueClient } from '@supabase/auth-js';
import { z } from 'zod';
import {
  AccountError,
  AUTH_STORAGE_KEY,
  profileSchema,
  withoutOAuthParams,
  type AccountBackend,
  type Profile,
} from './account';
import type { SupabaseConfig } from './config';

/**
 * Skutečné spojení se Supabase: přihlášení přes Supabase Auth (PKCE – kód z adresy se
 * vymění za přihlášení, žádné tokeny v URL) a dvě volání databáze přes REST.
 * Do databáze klient smí jen číst svůj profil; zapisuje se funkcemi (viz supabase/migrations).
 */
export function createSupabaseAccountBackend(config: SupabaseConfig): AccountBackend {
  const auth = new GoTrueClient({
    url: `${config.url}/auth/v1`,
    headers: { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` },
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'pkce',
  });

  async function rest(path: string, init: RequestInit = {}): Promise<unknown> {
    const { data } = await auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AccountError('network');
    let response: Response;
    try {
      response = await fetch(`${config.url}/rest/v1/${path}`, {
        ...init,
        headers: {
          apikey: config.anonKey,
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
    } catch {
      throw new AccountError('network');
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { code?: string } | null;
      // Kódy chyb z funkcí v SQL: 22023 neplatná přezdívka, 23505 všechny kódy obsazené.
      if (body?.code === '22023') throw new AccountError('invalid');
      if (body?.code === '23505') throw new AccountError('full');
      if (body?.code === 'MYE01') throw new AccountError('too-soon');
      throw new AccountError('network');
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  const profiles = z.array(profileSchema).max(1);

  return {
    async init() {
      await auth.initialize();
      // Po návratu od poskytovatele zbyde v adrese ?code=… – pryč s ním.
      // Chyba od poskytovatele může přijít i v části za #.
      const clean = withoutOAuthParams(window.location.search);
      const hash = /(?:^#|&)error=/.test(window.location.hash) ? '' : window.location.hash;
      if (clean !== window.location.search || hash !== window.location.hash) {
        window.history.replaceState(null, '', `${window.location.pathname}${clean}${hash}`);
      }
      const { data } = await auth.getSession();
      const user = data.session?.user;
      return user ? { userId: user.id } : null;
    },
    onUserChange(handler) {
      auth.onAuthStateChange((_event, session) => {
        // Uvnitř zpětného volání se nesmí volat další metody auth (zámek) – odložit.
        setTimeout(() => handler(session?.user.id ?? null), 0);
      });
    },
    async signIn(provider) {
      const { error } = await auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
      });
      if (error) throw new AccountError('login-failed');
    },
    async signOut() {
      // Chyba se nevyhazuje, jen vrací – bez kontroly by zůstalo přihlášení na serveru.
      const { error } = await auth.signOut();
      if (error) throw new AccountError('sign-out-failed');
    },
    async exportData() {
      return rest('rpc/export_my_data', { method: 'POST', body: '{}' });
    },
    async profile(userId): Promise<Profile | null> {
      const rows = profiles.parse(
        await rest(`profiles?select=nickname,tag&id=eq.${encodeURIComponent(userId)}`),
      );
      return rows[0] ?? null;
    },
    async setNickname(nickname) {
      const rows = profiles.min(1).parse(
        await rest('rpc/set_nickname', {
          method: 'POST',
          body: JSON.stringify({ new_nickname: nickname }),
        }),
      );
      const profile = rows[0];
      if (!profile) throw new AccountError('network');
      return profile;
    },
    async deleteAccount() {
      await rest('rpc/delete_my_account', { method: 'POST', body: '{}' });
      // Účet na serveru už není – zbývá zapomenout přihlášení v prohlížeči.
      await auth.signOut({ scope: 'local' }).catch(() => undefined);
    },
  };
}
