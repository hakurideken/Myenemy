import type { TransportFactory } from './Transport';

export interface SupabaseConfig {
  readonly url: string;
  readonly anonKey: string;
}

/** Konfigurace z VITE_… proměnných; bez nich (nebo s nesmyslnou URL) je online režim vypnutý. */
export function readSupabaseConfig(env: ImportMetaEnv = import.meta.env): SupabaseConfig | null {
  const url = env.VITE_SUPABASE_URL?.trim();
  const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  try {
    const parsed = new URL(url);
    const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), anonKey };
}

/** Supabase klient se stáhne až při prvním online zápase – PvE a lokální hra ho nepotřebují. */
export function supabaseTransportFactory(config: SupabaseConfig): TransportFactory {
  return async () => {
    const { SupabaseTransport } = await import('./SupabaseTransport');
    return new SupabaseTransport(config);
  };
}
