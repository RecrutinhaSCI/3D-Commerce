import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useSEO } from '@/utils/seo';
import { formatBRL } from '@/utils/price';
import { ApiError } from '@/services/api';
import { posService, type CashSession } from '@/services/posService';
import { Button } from '@/components/ui/Button';
import { PosNav } from './PosNav';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export default function PosHistory() {
  useSEO('Histórico de caixas');
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    posService
      .listSessions({ page })
      .then((r) => {
        if (!active) return;
        setSessions(r.sessions);
        setTotalPages(r.pagination.totalPages);
      })
      .catch((err) => active && toast.error(err instanceof ApiError ? err.message : 'Erro ao carregar o histórico.'))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [page]);

  return (
    <div>
      <PosNav />
      <h1 className="text-2xl font-bold">Histórico de caixas</h1>
      <div className="card mt-4 divide-y divide-ink-line">
        {loading && <p className="p-10 text-center text-sm text-ink-mute">Carregando...</p>}
        {!loading && sessions.length === 0 && <p className="p-10 text-center text-sm text-ink-mute">Nenhum caixa aberto ainda.</p>}
        {!loading && sessions.map((s) => (
          <Link key={s.id} to={`/admin/pdv/historico/${s.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-ink/[0.03]">
            <div>
              <p className="font-semibold">{dateFmt.format(new Date(s.openedAt))} <span className="ml-1 text-xs font-normal text-ink-mute">Caixa #{s.number}</span></p>
              <p className="text-xs text-ink-mute">
                Aberto {timeFmt.format(new Date(s.openedAt))} por {s.openedByName}
                {s.closedAt ? ` · Fechado ${timeFmt.format(new Date(s.closedAt))}` : ''}
              </p>
            </div>
            <div className="text-right">
              {s.status === 'OPEN'
                ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">Aberto</span>
                : <><p className="font-bold">{formatBRL(s.totalSold)}</p><p className="text-xs text-ink-mute">{s.salesCount} {s.salesCount === 1 ? 'venda' : 'vendas'}</p></>}
            </div>
          </Link>
        ))}
      </div>
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Anterior</Button>
          <span className="text-ink-mute">Página {page} de {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Próxima</Button>
        </div>
      )}
    </div>
  );
}
