import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, Keyboard, LockKeyhole, PackageMinus, ScanBarcode, Search, Trash2, User, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useSEO } from '@/utils/seo';
import { formatBRL } from '@/utils/price';
import { ApiError } from '@/services/api';
import type { Customer } from '@/services/customerService';
import {
  newRequestId,
  posService,
  type CashSession,
  type PosPaymentMethod,
  type PosProduct,
  type PosSale,
  type SessionReport,
} from '@/services/posService';
import { PosNav } from './PosNav';
import { addFreeItem, addProduct, cartTotals, lineTotal, parseScan, removeLine, setQuantity, toSaleItems, type CartLine, type CartResult } from './posCart';
import { POS_SHORTCUTS, usePosShortcuts, type PosAction } from './posShortcuts';
import { ConfirmModal, CustomerModal, FreeItemModal, InternalUseModal, parseMoney, PaymentModal, ProductSearchModal, QuantityModal } from './PosModals';

type ModalName = 'search' | 'quantity' | 'free' | 'customer' | 'payment' | 'cancel' | 'internal' | 'close' | 'done' | 'inactive' | null;

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

export default function Pos() {
  useSEO('PDV');
  const [session, setSession] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { session: current } = await posService.currentSession();
      setSession(current);
    } catch (err) {
      setLoadError(true);
      toast.error(errorMessage(err, 'Não foi possível consultar o caixa.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PosNav />
      {loading && <p className="py-16 text-center text-sm text-ink-mute">Carregando caixa...</p>}
      {!loading && loadError && (
        <div className="card mx-auto max-w-md p-6 text-center">
          <p className="font-semibold">Não foi possível consultar o caixa.</p>
          <Button className="mt-4" variant="secondary" onClick={load}>Tentar de novo</Button>
        </div>
      )}
      {!loading && !loadError && !session && <OpenCash onOpened={setSession} />}
      {!loading && !loadError && session && <Terminal session={session} />}
    </div>
  );
}

function OpenCash({ onOpened }: { onOpened: (s: CashSession) => void }) {
  const [cash, setCash] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const openingCash = cash.trim() ? parseMoney(cash) : 0;
    if (openingCash === null) return void toast.error('Valor de abertura inválido.');
    setSaving(true);
    try {
      const { session } = await posService.openSession({ openingCash, note: note.trim() || null });
      toast.success('Caixa aberto.');
      onOpened(session);
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível abrir o caixa.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="card mx-auto mt-10 max-w-md space-y-4 p-6">
      <div>
        <h1 className="text-xl font-bold">Abrir caixa</h1>
        <p className="mt-1 text-sm text-ink-mute">O estoque atual fica registrado como ponto de partida do relatório de fechamento.</p>
      </div>
      <div><Label>Fundo de troco (R$)</Label><Input autoFocus inputMode="decimal" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0,00" /></div>
      <div><Label>Observação (opcional)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
      <Button type="submit" fullWidth size="lg" loading={saving}>Abrir caixa</Button>
    </form>
  );
}

function Terminal({ session }: { session: CashSession }) {
  const navigate = useNavigate();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [discount, setDiscount] = useState(0);
  const [modal, setModal] = useState<ModalName>(null);
  // Busca de cliente por cima do pagamento, que continua aberto por baixo.
  const [customerOverPayment, setCustomerOverPayment] = useState(false);
  const [scan, setScan] = useState('');
  const [searchSeed, setSearchSeed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [lastSale, setLastSale] = useState<PosSale | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  // Leitor bipa mais rápido que a resposta da API: as leituras entram numa fila
  // e o carrinho mais recente fica neste ref, para nenhum bipe se perder.
  const cartRef = useRef<CartLine[]>([]);
  const scanQueue = useRef<Promise<void>>(Promise.resolve());
  const [inactiveName, setInactiveName] = useState('');
  const inactiveAnswer = useRef<((ok: boolean) => void) | null>(null);
  // Mesma venda (itens/pagamento iguais) reusa o id: se a resposta se perdeu,
  // tentar de novo devolve a venda já feita em vez de vender duas vezes.
  const attempt = useRef<{ hash: string; id: string } | null>(null);

  const totals = useMemo(() => cartTotals(cart, discount), [cart, discount]);
  const selectedLine = cart.find((l) => l.key === selected) ?? null;

  const focusScan = useCallback(() => setTimeout(() => scanRef.current?.focus(), 0), []);
  useEffect(() => { if (modal === null) focusScan(); }, [modal, focusScan]);

  function commitCart(next: CartLine[]) {
    cartRef.current = next;
    setCart(next);
  }

  function applyResult(result: CartResult) {
    if (!result.ok) {
      toast.error(result.error);
      return false;
    }
    commitCart(result.cart);
    setSelected(result.key);
    return true;
  }

  /** Pergunta e espera a resposta; a fila de bipes aguarda junto. */
  function askInactive(name: string): Promise<boolean> {
    setInactiveName(name);
    setModal('inactive');
    return new Promise((resolve) => { inactiveAnswer.current = resolve; });
  }

  function answerInactive(ok: boolean) {
    inactiveAnswer.current?.(ok);
    inactiveAnswer.current = null;
    setModal(null);
  }

  async function addChecked(product: PosProduct, quantity = 1): Promise<boolean> {
    let confirmed = false;
    if (!product.active) {
      confirmed = cartRef.current.some((l) => l.kind === 'product' && l.productId === product.id && l.inactiveConfirmed === true);
      if (!confirmed && !(await askInactive(product.name))) return false;
      confirmed = true;
    }
    return applyResult(addProduct(cartRef.current, product, quantity, confirmed));
  }

  async function processScan(raw: string) {
    const { code, quantity } = parseScan(raw);
    try {
      const { product } = await posService.lookupProduct(code);
      if (product) {
        await addChecked(product, quantity);
      } else {
        // Não é um código exato: vira pesquisa por nome.
        setSearchSeed(code);
        setModal('search');
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Erro ao consultar o produto.'));
    }
  }

  function submitScan(e: FormEvent) {
    e.preventDefault();
    const raw = scan;
    if (!raw.trim()) return;
    setScan('');
    scanQueue.current = scanQueue.current.then(() => processScan(raw));
  }

  function resetSale() {
    commitCart([]);
    setSelected(null);
    setCustomer(null);
    setDiscount(0);
    attempt.current = null;
  }

  function onAction(action: PosAction) {
    switch (action) {
      case 'focusScan': return void scanRef.current?.focus();
      case 'search': setSearchSeed(scan); setScan(''); return setModal('search');
      case 'quantity': return selectedLine ? setModal('quantity') : void toast.error('Selecione um item.');
      case 'remove':
        if (!selectedLine) return void toast.error('Selecione um item.');
        return removeSelected();
      case 'freeItem': return setModal('free');
      case 'cancel': return cart.length ? setModal('cancel') : undefined;
      case 'payment': return cart.length ? setModal('payment') : void toast.error('Adicione ao menos um item.');
      case 'customer': return modal === 'payment' ? setCustomerOverPayment(true) : setModal('customer');
    }
  }

  function closeCustomer() {
    if (customerOverPayment) setCustomerOverPayment(false);
    else setModal(null);
  }

  function removeSelected() {
    if (!selectedLine) return;
    const index = cart.findIndex((l) => l.key === selectedLine.key);
    const next = removeLine(cart, selectedLine.key);
    commitCart(next);
    setSelected(next[Math.min(index, next.length - 1)]?.key ?? null);
  }

  usePosShortcuts({ onAction, onEscape: () => { if (customerOverPayment) setCustomerOverPayment(false); else if (modal === 'inactive') answerInactive(false); else if (!submitting) setModal(null); }, modalOpen: modal !== null || customerOverPayment, allowedInModal: modal === 'payment' && !customerOverPayment && !submitting ? 'customer' : null, enabled: true });

  async function finishSale(p: { paymentMethod: PosPaymentMethod; amountReceived: number | null; notes: string | null }, saleDiscount: number) {
    const body = {
      items: toSaleItems(cart),
      discount: saleDiscount,
      paymentMethod: p.paymentMethod,
      amountReceived: p.amountReceived,
      notes: p.notes,
      customerId: customer?.id ?? null,
      expectedTotal: cartTotals(cart, saleDiscount).total,
    };
    const hash = JSON.stringify(body);
    if (attempt.current?.hash !== hash) attempt.current = { hash, id: newRequestId() };

    setSubmitting(true);
    try {
      const { sale } = await posService.createSale({ clientRequestId: attempt.current.id, ...body });
      setLastSale(sale);
      resetSale();
      setModal('done');
    } catch (err) {
      // Recusa do servidor é definitiva para esta tentativa. Falha de rede
      // mantém o id, porque a venda pode ter sido gravada.
      if (err instanceof ApiError && err.status > 0) attempt.current = null;
      if (err instanceof ApiError && err.code === 'INACTIVE_PRODUCT_NOT_CONFIRMED') {
        // Ficou inativo depois de entrar no carrinho.
        const products = (err.details as { products?: Array<{ id: string; name: string }> } | undefined)?.products ?? [];
        for (const p of products) {
          if (!(await askInactive(p.name))) return;
          commitCart(cartRef.current.map((l) => (l.kind === 'product' && l.productId === p.id ? { ...l, inactiveConfirmed: true } : l)));
        }
        toast.success('Produto confirmado. Finalize a venda novamente (F9).');
        return;
      }
      toast.error(errorMessage(err, 'Não foi possível concluir a venda.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 space-y-4">
        <div className="card p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink-mute">Frente de caixa · Leitura do código de barras</p>
          <form onSubmit={submitScan} className="mt-2 flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-ink-mute" />
              <Input
                ref={scanRef}
                value={scan}
                onChange={(e) => setScan(e.target.value)}
                placeholder="Bipe o código ou digite nome, SKU, EAN (3*código para quantidade)"
                className="py-3 pl-10 text-base"
                aria-label="Leitura de produto"
                autoComplete="off"
              />
            </div>
            <Button type="button" variant="secondary" onClick={() => onAction('search')}><Search className="h-4 w-4" /> Pesquisar F3</Button>
            <Button type="button" variant="secondary" onClick={() => onAction('freeItem')}>Item livre F7</Button>
            <Button type="button" variant="secondary" onClick={() => setModal('internal')}><PackageMinus className="h-4 w-4" /> Uso interno</Button>
          </form>
        </div>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-line px-4 py-3">
            <h2 className="text-sm font-bold">Itens da venda</h2>
            <span className="text-xs text-ink-mute">{totals.items} {totals.items === 1 ? 'item' : 'itens'}</span>
          </div>
          {cart.length === 0 ? (
            <p className="px-4 py-16 text-center text-sm text-ink-mute">Bipe um produto para começar a venda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-bg-soft text-left text-[11px] uppercase tracking-wide text-ink-mute">
                  <tr>
                    <th className="px-4 py-2">Produto</th>
                    <th className="px-4 py-2 text-right">Qtd.</th>
                    <th className="px-4 py-2 text-right">Unitário</th>
                    <th className="px-4 py-2 text-right">Subtotal</th>
                    <th className="w-10 px-2 py-2"><span className="sr-only">Remover</span></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l) => (
                    <tr
                      key={l.key}
                      onClick={() => setSelected(l.key)}
                      aria-selected={l.key === selected}
                      className={`cursor-pointer border-t border-ink-line ${l.key === selected ? 'bg-accent/10' : 'hover:bg-ink/[0.03]'}`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-semibold">{l.name}</span>
                        <span className="block text-xs text-ink-mute">{l.kind === 'free' ? 'Item livre · sem baixa de estoque' : `${l.sku ?? 'Sem SKU'} · estoque ${l.stock}`}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{l.quantity}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatBRL(l.unitPrice)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{formatBRL(lineTotal(l))}</td>
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          aria-label={`Remover ${l.name}`}
                          className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-600"
                          onClick={(e) => { e.stopPropagation(); commitCart(removeLine(cart, l.key)); if (selected === l.key) setSelected(null); }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card p-4">
          <button type="button" onClick={() => setModal('customer')} className="flex w-full items-center justify-between gap-2 text-left">
            <span className="flex min-w-0 items-center gap-2">
              <User className="h-4 w-4 shrink-0 text-ink-mute" />
              <span className="min-w-0">
                <span className="block text-[11px] font-bold uppercase tracking-widest text-ink-mute">Cliente · F10</span>
                <span className="block truncate text-sm font-semibold">{customer?.name ?? 'Consumidor não identificado'}</span>
              </span>
            </span>
          </button>
          {customer && (
            <button type="button" onClick={() => setCustomer(null)} className="mt-2 inline-flex items-center gap-1 text-xs text-ink-mute hover:text-ink">
              <X className="h-3 w-3" /> Remover cliente
            </button>
          )}
        </div>

        <div className="card p-4">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-ink-mute">Itens</dt><dd className="tabular-nums">{totals.items}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Subtotal</dt><dd className="tabular-nums">{formatBRL(totals.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Desconto</dt><dd className="tabular-nums">- {formatBRL(totals.discount)}</dd></div>
          </dl>
          <div className="mt-3 rounded-xl bg-ink p-4 text-bg">
            <p className="text-[11px] font-bold uppercase tracking-widest opacity-70">Total da compra</p>
            <p className="mt-1 text-3xl font-bold tabular-nums">{formatBRL(totals.total)}</p>
          </div>
          <Button fullWidth size="lg" className="mt-3" disabled={cart.length === 0} onClick={() => onAction('payment')}>Finalizar / Pagamento F9</Button>
          <Button fullWidth variant="ghost" className="mt-1" disabled={cart.length === 0} onClick={() => onAction('cancel')}>Cancelar compra F8</Button>
        </div>

        <div className="card p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-ink-mute"><Keyboard className="h-3.5 w-3.5" /> Atalhos</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {POS_SHORTCUTS.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <kbd className="rounded border border-ink-line bg-bg-soft px-1.5 py-0.5 font-mono text-[10px] font-bold">{s.key}</kbd>
                <span className="truncate text-ink-soft">{s.label}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-4 text-xs text-ink-mute">
          <p>Caixa #{session.number} · {session.openedByName}</p>
          <p>Aberto em {new Date(session.openedAt).toLocaleString('pt-BR')}</p>
          <div className="mt-3 flex gap-2">
            <Link to={`/admin/pdv/historico/${session.id}`} className="btn-secondary flex-1 justify-center !py-2 !text-xs">Ver parcial</Link>
            <Button variant="secondary" size="sm" className="flex-1" disabled={cart.length > 0} title={cart.length > 0 ? 'Conclua ou cancele a venda em andamento' : undefined} onClick={() => setModal('close')}>
              <LockKeyhole className="h-3.5 w-3.5" /> Fechar caixa
            </Button>
          </div>
        </div>
      </aside>

      <ProductSearchModal
        open={modal === 'search'}
        initialQuery={searchSeed}
        onClose={() => setModal(null)}
        onPick={(p) => { void addChecked(p).then((ok) => { if (ok) setModal(null); }); }}
      />
      <QuantityModal
        open={modal === 'quantity'}
        name={selectedLine?.name ?? ''}
        current={selectedLine?.quantity ?? 1}
        onClose={() => setModal(null)}
        onConfirm={(q) => { if (selected && applyResult(setQuantity(cartRef.current, selected, q))) setModal(null); }}
      />
      <FreeItemModal open={modal === 'free'} onClose={() => setModal(null)} onConfirm={(i) => { applyResult(addFreeItem(cartRef.current, i)); setModal(null); }} />
      <InternalUseModal open={modal === 'internal'} onClose={() => setModal(null)} onDone={() => setModal(null)} />
      <PaymentModal
        open={modal === 'payment'}
        subtotal={totals.subtotal}
        discount={discount}
        submitting={submitting}
        customerName={customer?.name ?? null}
        customerOpen={customerOverPayment}
        onSelectCustomer={() => setCustomerOverPayment(true)}
        onClose={() => { if (!submitting) setModal(null); }}
        onConfirm={(p) => { setDiscount(p.discount); void finishSale(p, p.discount); }}
      />
      {/* Depois do pagamento no DOM, para abrir por cima dele. */}
      <CustomerModal
        open={modal === 'customer' || customerOverPayment}
        onClose={closeCustomer}
        onPick={(c) => { setCustomer(c); closeCustomer(); }}
      />
      <ConfirmModal
        open={modal === 'cancel'}
        title="Cancelar compra"
        message="Os itens desta venda em andamento serão descartados. Nenhum estoque foi baixado."
        confirmLabel="Descartar venda"
        onClose={() => setModal(null)}
        onConfirm={() => { resetSale(); setModal(null); }}
      />
      <ConfirmModal
        open={modal === 'inactive'}
        title={inactiveName}
        message="Este produto está inativo no e-commerce. Deseja continuar?"
        confirmLabel="Continuar"
        safeFocus
        onClose={() => answerInactive(false)}
        onConfirm={() => answerInactive(true)}
      />
      <CloseCashModal
        open={modal === 'close'}
        session={session}
        onClose={() => setModal(null)}
        onClosed={() => navigate(`/admin/pdv/historico/${session.id}`)}
      />
      <Modal open={modal === 'done'} onClose={() => setModal(null)} title="Venda concluída">
        {lastSale && (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-2 text-sm text-ink-mute">{lastSale.label}</p>
            <p className="text-3xl font-bold">{formatBRL(lastSale.total)}</p>
            {lastSale.changeAmount !== null && lastSale.changeAmount > 0 && (
              <p className="mt-2 text-lg font-semibold text-emerald-700">Troco: {formatBRL(lastSale.changeAmount)}</p>
            )}
            <Button autoFocus fullWidth className="mt-5" onClick={() => setModal(null)}>Nova venda</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CloseCashModal({ open, session, onClose, onClosed }: { open: boolean; session: CashSession; onClose: () => void; onClosed: () => void }) {
  const [preview, setPreview] = useState<SessionReport | null>(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCounted('');
    setNote('');
    setPreview(null);
    posService.getSession(session.id).then((r) => setPreview(r.report)).catch((err) => toast.error(errorMessage(err, 'Erro ao carregar a prévia.')));
  }, [open, session.id]);

  async function close(e: FormEvent) {
    e.preventDefault();
    const countedCash = counted.trim() ? parseMoney(counted) : null;
    if (counted.trim() && countedCash === null) return void toast.error('Valor contado inválido.');
    setSaving(true);
    try {
      await posService.closeSession(session.id, { countedCash, note: note.trim() || null });
      toast.success('Caixa fechado.');
      onClosed();
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível fechar o caixa.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Fechar caixa">
      {!preview ? (
        <p className="py-6 text-center text-sm text-ink-mute">Calculando...</p>
      ) : (
        <form onSubmit={close} className="space-y-3">
          <dl className="space-y-1 rounded-xl bg-bg-soft p-3 text-sm">
            <div className="flex justify-between"><dt className="text-ink-mute">Vendas</dt><dd>{preview.summary.salesCount}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Total vendido</dt><dd className="font-semibold">{formatBRL(preview.summary.totalSold)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-mute">Dinheiro esperado na gaveta</dt><dd className="font-semibold">{formatBRL(preview.cash.expected)}</dd></div>
          </dl>
          <div><Label>Dinheiro contado (R$, opcional)</Label><Input autoFocus inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="0,00" /></div>
          <div><Label>Observação</Label><Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} /></div>
          <p className="text-xs text-ink-mute">Depois de fechar, vendas deste caixa só podem ser desfeitas por devolução.</p>
          <Button type="submit" fullWidth size="lg" loading={saving}>Fechar caixa e gerar relatório</Button>
        </form>
      )}
    </Modal>
  );
}
