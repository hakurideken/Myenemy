/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Identita buildu (verze + čas sestavení) – dva hráči musí mít stejnou. */
declare const __BUILD_ID__: string;
