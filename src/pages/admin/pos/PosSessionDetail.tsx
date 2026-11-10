import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useSEO } from '@/utils/seo';
import { formatBRL } from '@/utils/price';
import { ApiError } from '@/services/api';
import {
  MOVEMENT_LABELS,
  newRequestId,
  PAYMENT_LABELS,
  posService,
  type PosSale,
  type ReportProductRow,
  type SessionReport,
} from '@/services/posService';
import { PosNav } from './PosNav';

const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR') : '—');
const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const signed = (n: number) => (n === 0 ? '0' : n > 0 ? `+${n}` : String(n));
const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function PosSessionDetail() {
  useSEO('Fechamento de caixa');
  const { id = '' } = useParams();
  const [report, setReport] = useState<SessionReport | null>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saleId, setSaleId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await posService.getSession(id);
      setReport(r.report);
      setLive(r.live);
    } catch (err) {
      setFailed(true);
      toast.error(errorMessage(err, 'Erro ao carregar o relatório.'));
    }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <div><PosNav /><p className="py-16 text-center text-sm text-ink-mute">Relatório indisponível.</p></div>;
  if (!report) return <div><PosNav /><p className="py-16 text-center text-sm text-ink-mute">Carregando relatório...</p></div>;

  const { session, summary, payments, cash, stock, sales, returns } = report;

  return (
    <div>
      <PosNav />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/admin/pdv/historico" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink print:hidden"><ChevronLeft className="h-3 w-3" /> Histórico</Link>
          <h1 className="mt-1 text-2xl font-bold">Fechamento de caixa #{session.number}</h1>
          {live && <p className="mt-1 text-sm font-semibold text-amber-700">Parcial: o caixa ainda está aberto.</p>}
        </div>
        <Button variant="secondary" className="print:hidden" onClick={() => window.print()}><Printer className="h-4 w-4" /> Imprimir / salvar PDF</Button>
      </div>

      {stock.discrepancies > 0 && (
        <div className="mt-4 flex gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{stock.discrepancies} {stock.discrepancies === 1 ? 'produto teve' : 'produtos tiveram'} alteração de estoque sem registro no sistema. Confira as linhas marcadas.</span>
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card p-4">
          <h2 className="text-sm font-bold">Resumo</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Row label="Abertura" value={dt(session.openedAt)} />
            <Row label="Fechamento" value={dt(session.closedAt)} />
            <Row label="Operador" value={session.openedByName} />
            <Row label="Vendas" value={String(summary.salesCount)} />
            <Row label="Itens vendidos" value={String(summary.itemsSold)} />
            <Row label="Total vendido" value={formatBRL(summary.totalSold)} strong />
            <Row label="Ticket médio" value={formatBRL(summary.averageTicket)} />
            <Row label="Descontos" value={formatBRL(summary.discounts)} />
            <Row label={`Itens livres (${summary.freeItemsCount})`} value={formatBRL(summary.freeItemsTotal)} />
            <Row label={`Canceladas (${summary.canceledCount})`} value={formatBRL(summary.canceledTotal)} />
            <Row label={`Devoluções (${summary.refundsCount})`} value={`- ${formatBRL(summary.refundsTotal)}`} />
            <Row label="Líquido" value={formatBRL(summary.netAfterRefunds)} strong />
          </dl>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-bold">Pagamentos</h2>
          <dl className="mt-2 space-y-1 text-sm">
            {payments.map((p) => <Row key={p.method} label={`${PAYMENT_LABELS[p.method]} (${p.count})`} value={formatBRL(p.net)} />)}
          </dl>
          <p className="mt-2 text-xs text-ink-mute">Valores líquidos de devolução. Só vendas físicas deste caixa.</p>
        </section>

        <section className="card p-4">
          <h2 className="text-sm font-bold">Dinheiro na gaveta</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Row label="Fundo de troco" value={formatBRL(cash.opening)} />
            <Row label="Esperado" value={formatBRL(cash.expected)} strong />
            <Row label="Contado" value={cash.counted === null ? 'Não informado' : formatBRL(cash.counted)} />
            {cash.difference !== null && <Row label="Diferença" value={formatBRL(cash.difference)} strong />}
          </dl>
          {(session.openingNote || session.closingNote) && (
            <p className="mt-3 text-xs text-ink-mute">{[session.openingNote, session.closingNote].filter(Boolean).join(' · ')}</p>
          )}
        </section>
      </div>

      <section className="card mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-line px-4 py-3">
          <h2 className="text-sm font-bold">Estoque: todas as origens</h2>
          <span className="text-xs text-ink-mute">Inicial + movimentações = final. Pedidos online aparecem aqui, mas não entram no caixa. Clique para ver cada movimentação.</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-soft text-right text-[11px] uppercase tracking-wide text-ink-mute">
              <tr>
                <th className="px-4 py-2 text-left">Produto</th>
                <th className="px-3 py-2">Inicial</th>
                <th className="px-3 py-2">E-commerce</th>
                <th className="px-3 py-2">PDV</th>
                <th className="px-3 py-2">Uso interno</th>
                <th className="px-3 py-2">Ajustes</th>
                <th className="px-3 py-2">Importação</th>
                <th className="px-3 py-2">Cancel.</th>
                <th className="px-3 py-2">Devol.</th>
                <th className="px-4 py-2">Final</th>
              </tr>
            </thead>
            <tbody>
              {stock.products.map((p) => <StockRow key={p.productId} row={p} />)}
              {stock.products.length === 0 && <tr><td colSpan={10} className="p-8 text-center text-ink-mute">Nenhuma movimentação de estoque neste caixa.</td></tr>}
            </tbody>
            {stock.products.length > 0 && (
              <tfoot className="border-t-2 border-ink-line bg-bg-soft text-right font-semibold tabular-nums">
                <tr>
                  <td className="px-4 py-2 text-left">Totais</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2">{signed(stock.totals.ecommerce)}</td>
                  <td className="px-3 py-2">{signed(stock.totals.pos)}</td>
                  <td className="px-3 py-2">{signed(stock.totals.internalUse)}</td>
                  <td className="px-3 py-2">{signed(stock.totals.adjustments)}</td>
                  <td className="px-3 py-2">{signed(stock.totals.imports)}</td>
                  <td className="px-3 py-2">{signed(stock.totals.cancellations)}</td>
                  <td className="px-3 py-2">{signed(stock.totals.returns)}</td>
                  <td className="px-4 py-2" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {stock.untracked.length > 0 && (
          <div className="border-t border-ink-line p-4 text-sm">
            <p className="font-semibold text-rose-700">Alterados sem nenhum registro:</p>
            <ul className="mt-1 text-xs">{stock.untracked.map((u) => <li key={u.productId}>{u.name}: {u.initial} → {u.final}</li>)}</ul>
          </div>
        )}
      </section>

      <section className="card mt-4 overflow-hidden">
        <h2 className="border-b border-ink-line px-4 py-3 text-sm font-bold">Vendas</h2>
        <div className="divide-y divide-ink-line">
          {sales.map((s) => (
            <button key={s.id} type="button" onClick={() => setSaleId(s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-left text-sm hover:bg-ink/[0.03] print:hover:bg-transparent">
              <span>
                <span className="font-semibold">PDV-{s.number}</span>
                <span className="ml-2 text-xs text-ink-mute">{time(s.createdAt)} · {s.itemsCount} {s.itemsCount === 1 ? 'item' : 'itens'} · {PAYMENT_LABELS[s.paymentMethod]}{s.customerName ? ` · ${s.customerName}` : ''}</span>
              </span>
              <span className={s.status === 'CANCELED' ? 'font-semibold text-rose-600 line-through' : 'font-semibold'}>{formatBRL(s.total)}</span>
            </button>
          ))}
          {sales.length === 0 && <p className="p-8 text-center text-sm text-ink-mute">Nenhuma venda neste caixa.</p>}
        </div>
      </section>

      {returns.length > 0 && (
        <section className="card mt-4 overflow-hidden">
          <h2 className="border-b border-ink-line px-4 py-3 text-sm font-bold">Devoluções</h2>
          <ul className="divide-y divide-ink-line text-sm">
            {returns.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 px-4 py-2.5">
                <span>Venda PDV-{r.saleNumber} <span className="ml-2 text-xs text-ink-mute">{time(r.createdAt)} · {r.reason}</span></span>
                <span className="font-semibold">- {formatBRL(r.refund)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <SaleModal saleId={saleId} sessionLive={live} onClose={() => setSaleId(null)} onChanged={load} />
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-mute">{label}</dt><dd className={`text-right tabular-nums ${strong ? 'font-bold' : ''}`}>{value}</dd></div>;
}

function StockRow({ row }: { row: ReportProductRow }) {
  const [open, setOpen] = useState(false);
  const flagged = row.discrepancy !== 0;
  return (
    <Fragment>
      <tr onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`cursor-pointer border-t border-ink-line text-right tabular-nums ${flagged ? 'bg-rose-50' : 'hover:bg-ink/[0.03]'}`}>
        <td className="px-4 py-2 text-left">
          <span className="inline-flex items-center gap-1 font-semibold">
            {open ? <ChevronDown className="h-3.5 w-3.5 print:hidden" /> : <ChevronRight className="h-3.5 w-3.5 print:hidden" />} {row.name}
          </span>
          {flagged && <span className="block text-xs font-semibold text-rose-700">Divergência: {signed(row.discrepancy)} (esperado {row.expectedFinal})</span>}
        </td>
        <td className="px-3 py-2">{row.initial}</td>
        <td className="px-3 py-2">{row.ecommerce ? signed(row.ecommerce) : '—'}</td>
        <td className="px-3 py-2">{row.pos ? signed(row.pos) : '—'}</td>
        <td className="px-3 py-2">{row.internalUse ? signed(row.internalUse) : '—'}</td>
        <td className="px-3 py-2">{row.adjustments ? signed(row.adjustments) : '—'}</td>
        <td className="px-3 py-2">{row.imports ? signed(row.imports) : '—'}</td>
        <td className="px-3 py-2">{row.cancellations ? signed(row.cancellations) : '—'}</td>
        <td className="px-3 py-2">{row.returns ? signed(row.returns) : '—'}</td>
        <td className="px-4 py-2 font-bold">{row.final}</td>
      </tr>
      {/* Na impressão o detalhe sai sempre: é o papel da auditoria. */}
      <tr className={`bg-bg-soft ${open ? '' : 'hidden print:table-row'}`} data-testid="stock-detail">
          <td colSpan={10} className="px-4 py-2">
            <ul className="space-y-1 text-xs">
              {row.movements.map((m) => (
                <li key={m.seq} className="grid grid-cols-[52px_100px_1fr_auto] items-baseline gap-2">
                  <span className="tabular-nums text-ink-mute">{time(m.at)}</span>
                  <span className="font-semibold">{MOVEMENT_LABELS[m.type]}</span>
                  <span className="min-w-0 truncate text-ink-soft">{[m.reference, m.note, m.userName].filter(Boolean).join(' · ') || '—'}</span>
                  <span className={`font-bold tabular-nums ${m.delta < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{signed(m.delta)}</span>
                </li>
              ))}
            </ul>
          </td>
      </tr>
    </Fragment>
  );
}

function SaleModal({ saleId, sessionLive, onClose, onChanged }: { saleId: string | null; sessionLive: boolean; onClose: () => void; onChanged: () => void }) {
  const [sale, setSale] = useState<PosSale | null>(null);
  const [mode, setMode] = useState<'view' | 'cancel' | 'return'>('view');
  const [reason, setReason] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const requestId = useRef('');

  useEffect(() => {
    setSale(null);
    setMode('view');
    setReason('');
    setQuantities({});
    requestId.current = '';
    if (!saleId) return;
    posService.getSale(saleId).then((r) => setSale(r.sale)).catch((err) => toast.error(errorMessage(err, 'Erro ao carregar a venda.')));
  }, [saleId]);

  async function confirmCancel() {
    if (!sale) return;
    setSaving(true);
    try {
      await posService.cancelSale(sale.id, reason.trim());
      toast.success('Venda cancelada e estoque devolvido.');
      onChanged();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível cancelar a venda.'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmReturn() {
    if (!sale) return;
    const items = sale.items
      .map((i) => ({ saleItemId: i.id, quantity: Number(quantities[i.id] || 0) }))
      .filter((i) => i.quantity > 0);
    if (items.length === 0) return void toast.error('Informe a quantidade a devolver.');
    setSaving(true);
    requestId.current ||= newRequestId();
    try {
      const r = await posService.createReturn(sale.id, { clientRequestId: requestId.current, reason: reason.trim(), items });
      toast.success(`Devolução registrada: ${formatBRL(r.return.refundAmount)}.`);
      onChanged();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status > 0) requestId.current = '';
      toast.error(errorMessage(err, 'Não foi possível registrar a devolução.'));
    } finally {
      setSaving(false);
    }
  }

  const reasonOk = reason.trim().length >= 3;

  return (
    <Modal open={saleId !== null} onClose={onClose} title={sale ? `Venda ${sale.label}` : 'Venda'} maxWidth="max-w-xl">
      {!sale ? <p className="py-6 text-center text-sm text-ink-mute">Carregando...</p> : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-ink-mute">
            {dt(sale.createdAt)} · {PAYMENT_LABELS[sale.paymentMethod]} · {sale.operatorName}{sale.customerName ? ` · ${sale.customerName}` : ''}
          </p>
          {sale.status === 'CANCELED' && (
            <p className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">Cancelada em {dt(sale.canceledAt)} por {sale.canceledByName}. Motivo: {sale.cancelReason}</p>
          )}
          <ul className="divide-y divide-ink-line rounded-xl border border-ink-line">
            {sale.items.map((i) => {
              const left = i.quantity - i.returnedQuantity;
              return (
                <li key={i.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{i.description}</span>
                    <span className="block text-xs text-ink-mute">{i.quantity} × {formatBRL(i.unitPrice)}{i.isFreeItem ? ' · item livre' : ''}{i.returnedQuantity ? ` · ${i.returnedQuantity} devolvido(s)` : ''}</span>
                  </span>
                  {mode === 'return' && left > 0 ? (
                    <Input type="number" min={0} max={left} className="w-20 !py-1.5" aria-label={`Quantidade a devolver de ${i.description}`} value={quantities[i.id] ?? ''} onChange={(e) => setQuantities((q) => ({ ...q, [i.id]: e.target.value }))} />
                  ) : (
                    <span className="font-semibold tabular-nums">{formatBRL(i.netTotal)}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex justify-between font-bold"><span>Total</span><span>{formatBRL(sale.total)}</span></div>
          {sale.refundedTotal > 0 && <div className="flex justify-between text-xs text-ink-mute"><span>Já devolvido</span><span>{formatBRL(sale.refundedTotal)}</span></div>}

          {sale.status === 'COMPLETED' && mode === 'view' && (
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" className="flex-1" onClick={() => setMode('return')}>Devolver itens</Button>
              {sessionLive && sale.refundedTotal === 0 && <Button variant="danger" className="flex-1" onClick={() => setMode('cancel')}>Cancelar venda</Button>}
            </div>
          )}
          {mode !== 'view' && (
            <div className="space-y-3">
              <div><Label>Motivo</Label><Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setMode('view')}>Voltar</Button>
                <Button
                  variant={mode === 'cancel' ? 'danger' : 'primary'}
                  className="flex-1"
                  loading={saving}
                  disabled={!reasonOk}
                  onClick={mode === 'cancel' ? confirmCancel : confirmReturn}
                >
                  {mode === 'cancel' ? 'Confirmar cancelamento' : 'Confirmar devolução'}
                </Button>
              </div>
              {mode === 'return' && <p className="text-xs text-ink-mute">O valor sai do caixa aberto por você e os produtos voltam ao estoque.</p>}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
