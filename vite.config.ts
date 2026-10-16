import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import pkg from './package.json' with { type: 'json' };

/** Povolené cíle síťového spojení: Supabase z konfigurace, jinak libovolný *.supabase.co. */
function connectSources(supabaseUrl: string | undefined): string {
  if (supabaseUrl) {
    try {
      const { host, protocol } = new URL(supabaseUrl);
      const ws = protocol === 'http:' ? 'ws:' : 'wss:';
      return `'self' ${protocol}//${host} ${ws}//${host}`;
    } catch {
      /* neplatná URL – zachytí ji i aplikace a online režim vypne */
    }
  }
  return "'self' https://*.supabase.co wss://*.supabase.co";
}

const CHARSET_META = '<meta charset="UTF-8" />';

/**
 * GitHub Pages neumí vlastní HTTP hlavičky, proto CSP přes <meta> – jen v buildu,
 * protože dev server Vite vkládá styly inline. <meta> CSP platí jen pro obsah za ní,
 * proto hned za charset.
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connectSources(supabaseUrl)}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ');
  return {
    name: 'myenemy-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(CHARSET_META)) throw new Error('index.html: chybí <meta charset> pro CSP');
      return html.replace(
        CHARSET_META,
        `${CHARSET_META}\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

export default defineConfig(({ command, mode, isPreview }) => {
  const env = loadEnv(mode, '.', 'VITE_');
  return {
    // GitHub Pages servíruje projekt na /Myenemy/; dev server běží na kořeni.
    base: command === 'build' || isPreview ? '/Myenemy/' : '/',
    define: {
      // Dva hráči s různým buildem (jiné nasazení) se nespojí – musí obnovit stránku.
      __BUILD_ID__: JSON.stringify(`${pkg.version}+${new Date().toISOString()}`),
    },
    plugins: [contentSecurityPolicy(env.VITE_SUPABASE_URL)],
    test: {
      include: ['src/**/*.test.ts'],
      environment: 'node',
      // Online testy simulují desítky sekund sítě s opravdovou kryptografií.
      testTimeout: 20_000,
    },
  };
});
