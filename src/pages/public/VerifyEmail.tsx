import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { authService } from '@/services/authService';
import { ApiError } from '@/services/api';
import { useCustomerAuthStore } from '@/store/useCustomerAuthStore';
import { useSEO } from '@/utils/seo';

type Status = 'loading' | 'success' | 'error';

export default function VerifyEmail() {
  useSEO('Confirmar e-mail', 'Confirme seu endereço de e-mail na 3DCommerce.');
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [status, setStatus] = useState<Status>('loading');
  const [message, setMessage] = useState('');
  const init = useCustomerAuthStore((s) => s.init);
  // Evita chamada dupla (StrictMode monta o efeito duas vezes em dev).
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    if (!token) {
      setStatus('error');
      setMessage('Link de verificação incompleto ou inválido.');
      return;
    }

    (async () => {
      try {
        await authService.verifyEmail(token);
        setStatus('success');
        setMessage('Seu e-mail foi confirmado com sucesso!');
        // Se houver cliente logado, atualiza emailVerified na store.
        void init();
      } catch (err) {
        setStatus('error');
        setMessage(err instanceof ApiError ? err.message : 'Não foi possível confirmar seu e-mail.');
      }
    })();
  }, [token, init]);

  return (
    <div className="container-x flex items-center justify-center py-16">
      <div className="w-full max-w-md text-center">
        <p className="eyebrow">Confirmação de e-mail</p>
        <h1 className="section-title">Verificar e-mail</h1>

        <div className="card mt-6 space-y-4 p-8">
          {status === 'loading' && (
            <>
              <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-ink/20 border-t-ink" aria-label="Verificando" />
              <p className="text-sm text-ink-mute">Confirmando seu e-mail...</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <p className="text-sm font-semibold text-ink">{message}</p>
              <Link to="/minha-conta" className="inline-block font-semibold text-ink hover:underline">
                Ir para minha conta →
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="mx-auto h-12 w-12 text-red-500" />
              <p className="text-sm font-semibold text-ink">{message}</p>
              <p className="text-xs text-ink-mute">
                O link pode ter expirado. Entre na sua conta para solicitar um novo.
              </p>
              <Link to="/login" className="inline-block font-semibold text-ink hover:underline">
                Ir para entrar →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
