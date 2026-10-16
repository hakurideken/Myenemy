import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// GitHub Pages neumí vlastní HTTP hlavičky, proto CSP přes <meta> – jen v buildu,
// protože dev server Vite vkládá styly inline.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const CHARSET_META = '<meta charset="UTF-8" />';

/** CSP hned za charset – <meta> CSP platí jen pro obsah, který následuje po ní. */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'myenemy-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes(CHARSET_META)) throw new Error('index.html: chybí <meta charset> pro CSP');
      return html.replace(
        CHARSET_META,
        `${CHARSET_META}\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  // GitHub Pages servíruje projekt na /Myenemy/; dev server běží na kořeni.
  base: command === 'build' || isPreview ? '/Myenemy/' : '/',
  plugins: [contentSecurityPolicy()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
}));
