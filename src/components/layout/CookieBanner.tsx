import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';
import { analyticsEnabled, loadAnalytics, readConsent, saveConsent } from '@/lib/analytics';

/**
 * Banner de cookies (LGPD). Não bloqueia a navegação nem escurece a tela.
 * - Sem analytics configurado: só cookies essenciais → um botão "Entendi".
 * - Com analytics (VITE_GA_MEASUREMENT_ID): o cliente escolhe; o script de
 *   análise só carrega depois de "Aceitar todos".
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = readConsent();
    if (!consent) setVisible(true);
    else loadAnalytics(); // já aceitou antes → carrega (no-op se recusou)
  }, []);

  function choose(analytics: boolean) {
    saveConsent(analytics);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] md:inset-x-auto md:right-4 md:max-w-md">
      <div className="flex items-start gap-3 rounded-xl border border-ink-line bg-bg-card p-4 shadow-card">
        <Cookie className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" aria-hidden="true" />
        <div className="text-sm text-ink-soft">
          <p>
            Usamos cookies essenciais para o carrinho e o checkout
            {analyticsEnabled ? ' e, com a sua permissão, cookies de análise para melhorar a loja' : ''}. Saiba mais na
            nossa{' '}
            <Link to="/privacidade" className="font-semibold text-ink underline">
              Política de Privacidade
            </Link>
            .
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {analyticsEnabled ? (
              <>
                <button
                  type="button"
                  onClick={() => choose(false)}
                  className="rounded-lg border border-ink-line px-4 py-1.5 text-xs font-semibold text-ink transition hover:border-ink"
                >
                  Só essenciais
                </button>
                <button
                  type="button"
                  onClick={() => choose(true)}
                  className="rounded-lg bg-ink px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-graphite"
                >
                  Aceitar todos
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => choose(false)}
                className="rounded-lg bg-ink px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-graphite"
              >
                Entendi
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
