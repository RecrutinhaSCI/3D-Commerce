import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cookie } from 'lucide-react';

const STORAGE_KEY = 'cookie-consent';

/**
 * Banner de cookies simples e não-intrusivo (LGPD).
 * Ao aceitar, grava o consentimento em localStorage e o banner some.
 * Não bloqueia a navegação nem escurece a tela.
 */
export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      // localStorage indisponível (modo privado): não exibe.
    }
  }, []);

  function accept() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ accepted: true, date: new Date().toISOString() }));
    } catch {
      // ignora falha de escrita
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] md:inset-x-auto md:right-4 md:max-w-md">
      <div className="flex items-start gap-3 rounded-xl border border-ink-line bg-bg-card p-4 shadow-card">
        <Cookie className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent" aria-hidden="true" />
        <div className="text-sm text-ink-soft">
          <p>
            Usamos cookies essenciais para o funcionamento do carrinho e do checkout. Ao continuar,
            você concorda com nossa{' '}
            <Link to="/privacidade" className="font-semibold text-ink underline">
              Política de Privacidade
            </Link>
            .
          </p>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={accept}
              className="rounded-lg bg-ink px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-graphite"
            >
              Aceitar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
