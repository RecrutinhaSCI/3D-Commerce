/**
 * Google Analytics 4 com consentimento (LGPD).
 *
 * - Só existe se `VITE_GA_MEASUREMENT_ID` estiver definido (ex.: G-XXXXXXX).
 * - O script do Google NUNCA é carregado antes do cliente aceitar cookies de
 *   análise no banner. "Só essenciais" = nenhum script de terceiros.
 * - Consentimento fica em localStorage['cookie-consent'] = { analytics, date }.
 */
const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
const STORAGE_KEY = 'cookie-consent';

export const analyticsEnabled = Boolean(GA_ID);

interface Consent {
  analytics: boolean;
  date: string;
}

export function readConsent(): Consent | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Consent> & { accepted?: boolean };
    // Formato antigo ({ accepted: true }) = só essenciais; com GA ativo,
    // pergunta de novo (retorna null) para colher a escolha de análise.
    if (typeof parsed.analytics !== 'boolean') return analyticsEnabled ? null : { analytics: false, date: parsed.date ?? '' };
    return { analytics: parsed.analytics, date: parsed.date ?? '' };
  } catch {
    return null;
  }
}

export function saveConsent(analytics: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics, date: new Date().toISOString() }));
  } catch {
    // modo privado: segue sem persistir
  }
  if (analytics) loadAnalytics();
}

type Gtag = (...args: unknown[]) => void;
declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

let loaded = false;

/** Injeta o gtag.js (uma vez) — só com GA configurado E consentimento. */
export function loadAnalytics() {
  if (loaded || !GA_ID || !readConsent()?.analytics) return;
  loaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  // page_view manual (SPA): enviado a cada troca de rota em trackPageView.
  window.gtag('config', GA_ID, { send_page_view: false, anonymize_ip: true });
}

/** page_view da SPA — no-op sem GA/consentimento. */
export function trackPageView(path: string) {
  if (!loaded || !window.gtag || !GA_ID) return;
  window.gtag('event', 'page_view', { page_path: path, page_location: window.location.href, page_title: document.title });
}
