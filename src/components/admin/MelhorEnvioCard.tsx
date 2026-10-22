import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Link2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/services/api';
import { integrationsService, type ApiMelhorEnvioStatus } from '@/services/integrationsService';

/** Mensagens do retorno do callback (?melhorEnvio=erro&motivo=…) — genéricas. */
const CALLBACK_MESSAGES: Record<string, string> = {
  negado: 'Autorização cancelada no Melhor Envio.',
  sessao: 'A autorização expirou ou já foi usada. Clique em conectar novamente.',
  configuracao: 'Integração não configurada no servidor.',
  falha: 'Não foi possível concluir a conexão com o Melhor Envio. Tente novamente.',
};

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

/**
 * Card "Melhor Envio" em Configurações: status da conexão OAuth e botão para
 * conectar/reconectar. Nunca mostra token (o backend nem envia).
 */
export function MelhorEnvioCard() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<ApiMelhorEnvioStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setStatus(await integrationsService.melhorEnvioStatus());
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Volta do callback: avisa e limpa os parâmetros da URL.
  useEffect(() => {
    const result = params.get('melhorEnvio');
    if (!result) return;
    // `id` fixo: o efeito pode rodar 2x (StrictMode) sem duplicar o aviso.
    if (result === 'conectado') toast.success('Melhor Envio conectado!', { id: 'melhor-envio-callback' });
    else toast.error(CALLBACK_MESSAGES[params.get('motivo') ?? ''] ?? CALLBACK_MESSAGES.falha, { id: 'melhor-envio-callback' });
    const next = new URLSearchParams(params);
    next.delete('melhorEnvio');
    next.delete('motivo');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect() {
    setStarting(true);
    try {
      const { authorizationUrl } = await integrationsService.startMelhorEnvioAuthorization();
      window.location.assign(authorizationUrl);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível iniciar a conexão.');
      setStarting(false);
    }
  }

  const envLabel = status?.environment === 'production' ? 'Produção' : 'Sandbox (testes)';
  const badge = !status
    ? null
    : status.needsReconnect
      ? { text: 'Reconexão necessária', cls: 'bg-rose-100 text-rose-700' }
      : status.connected
        ? { text: 'Conectado', cls: 'bg-emerald-100 text-emerald-700' }
        : { text: 'Desconectado', cls: 'bg-ink/10 text-ink-mute' };

  return (
    <div className="card mt-6 space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Melhor Envio (frete por CEP)</h2>
          <p className="mt-1 text-xs text-ink-mute">
            Conecte a conta da loja para cotar PAC e Sedex. O acesso é renovado automaticamente.
          </p>
        </div>
        {badge && (
          <span className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${badge.cls}`}>{badge.text}</span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-ink-mute">Carregando status…</p>
      ) : !status ? (
        <p className="text-sm text-rose-600">Não foi possível carregar o status da integração.</p>
      ) : !status.oauthConfigured ? (
        <div className="rounded-lg border border-ink-line bg-bg-soft p-3 text-sm text-ink-soft">
          <p>A conexão por aplicativo ainda não está configurada no servidor.</p>
          {status.usingManualToken && <p className="mt-1 text-xs text-ink-mute">A cotação usa o token manual configurado no servidor.</p>}
          {status.issues.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-ink-mute">
              {status.issues.map((i) => <li key={i}>{i}</li>)}
            </ul>
          )}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-2"><dt className="text-ink-mute">Ambiente</dt><dd className="font-medium">{envLabel}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-mute">Acesso válido até</dt><dd>{fmtDate(status.accessTokenExpiresAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-mute">Última renovação</dt><dd>{fmtDate(status.lastRefreshedAt)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-ink-mute">Conectado em</dt><dd>{fmtDate(status.connectedAt)}</dd></div>
          </dl>
          {status.needsReconnect && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              O Melhor Envio recusou a renovação do acesso. Clique em <b>Reconectar</b> para autorizar de novo
              {status.usingManualToken ? ' (enquanto isso, a cotação usa o token manual).' : ' — até lá o checkout oferece só retirada na loja.'}
            </p>
          )}
          {!status.connected && !status.needsReconnect && status.usingManualToken && (
            <p className="text-xs text-ink-mute">Enquanto não conectar, a cotação usa o token manual configurado no servidor.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={connect} loading={starting} variant={status.connected ? 'secondary' : 'primary'}>
              {status.connected || status.needsReconnect ? <RefreshCw className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
              {status.connected || status.needsReconnect ? 'Reconectar' : 'Conectar Melhor Envio'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
