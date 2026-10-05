/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Chave da API de rastreio SeuRastreio (formato sr_live_...). */
  readonly VITE_SEURASTREIO_API_KEY: string;
  /** Public key do Mercado Pago (TEST-/APP_USR-). Sem ela o cartão fica indisponível. */
  readonly VITE_MP_PUBLIC_KEY?: string;
  /** Domínio público da loja (https://...), usado no sitemap/robots/og:image. */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
