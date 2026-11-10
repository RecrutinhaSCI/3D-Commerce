import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import toast from 'react-hot-toast';
import { Search, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ApiError } from '@/services/api';
import { customerService, type Customer, type CustomerRow } from '@/services/customerService';
import {
  newRequestId,
  PAYMENT_LABELS,
  posService,
  type PosPaymentMethod,
  type PosProduct,
} from '@/services/posService';
import { formatBRL } from '@/utils/price';
import { changeFor } from './posCart';

const errorMessage = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/** Aceita "12,50" e "12.50". Vazio ou inválido vira null. */
export function parseMoney(value: string): number | null {
  const normalized = value.trim().replace(/\./g, (m, i, s) => (s.includes(',') ? '' : m)).replace(',', '.');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function useDebounced<T>(value: T, ms = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Lista navegável por teclado: ↑/↓ movem e Enter escolhe. */
function useListKeys<T>(items: T[], onPick: (item: T) => void) {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [items]);
  function onKeyDown(e: KeyboardEvent) {
    // Enter num botão focado (ex.: "Novo") é o clique dele, não a escolha da lista.
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'BUTTON') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && items[index]) {
      e.preventDefault();
      onPick(items[index]);
    }
  }
  return { index, onKeyDown };
}

function ProductPicker({ initialQuery = '', onPick }: { initialQuery?: string; onPick: (p: PosProduct) => void }) {
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [material, setMaterial] = useState('');
  const [results, setResults] = useState<PosProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const filters = useDebounced(useMemo(() => ({ q, category, brand, material }), [q, category, brand, material]));
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    posService
      .searchProducts({ ...filters, limit: 30 })
      .then((r) => active && setResults(r.products))
      .catch((err) => active && toast.error(errorMessage(err, 'Erro ao pesquisar produtos.')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [filters]);

  const { index, onKeyDown } = useListKeys(results, onPick);

  return (
    <div onKeyDown={onKeyDown}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
        <Input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, SKU, código de barras..." className="pl-9" aria-label="Pesquisar produto" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoria" aria-label="Filtrar por categoria" />
        <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Marca" aria-label="Filtrar por marca" />
        <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="Material" aria-label="Filtrar por material" />
      </div>
      <ul className="mt-3 max-h-80 divide-y divide-ink-line overflow-y-auto rounded-xl border border-ink-line" role="listbox" aria-label="Produtos">
        {results.map((p, i) => (
          <li key={p.id} role="option" aria-selected={i === index}>
            <button
              type="button"
              disabled={p.stock <= 0}
              onClick={() => onPick(p)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm disabled:opacity-50 ${i === index ? 'bg-ink/5' : 'hover:bg-ink/5'}`}
            >
              <span className="min-w-0">
                <span className="block truncate font-semibold">
                  {p.name}
                  {!p.active && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">Inativo na loja</span>}
                </span>
                <span className="block truncate text-xs text-ink-mute">
                  {[p.sku, p.brand, p.material, p.category].filter(Boolean).join(' · ') || 'Sem detalhes'}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-bold">{formatBRL(p.price)}</span>
                <span className={`block text-xs ${p.stock <= 0 ? 'font-semibold text-rose-600' : 'text-ink-mute'}`}>Estoque: {p.stock}</span>
              </span>
            </button>
          </li>
        ))}
        {!loading && results.length === 0 && <li className="p-6 text-center text-sm text-ink-mute">Nenhum produto encontrado.</li>}
        {loading && results.length === 0 && <li className="p-6 text-center text-sm text-ink-mute">Pesquisando...</li>}
      </ul>
      <p className="mt-2 text-xs text-ink-mute">↑ ↓ para navegar · Enter para adicionar · Esc para fechar</p>
    </div>
  );
}

export function ProductSearchModal({ open, initialQuery, onClose, onPick }: {
  open: boolean; initialQuery?: string; onClose: () => void; onPick: (p: PosProduct) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Pesquisar produto" maxWidth="max-w-2xl">
      {open && <ProductPicker initialQuery={initialQuery} onPick={onPick} />}
    </Modal>
  );
}

export function QuantityModal({ open, name, current, onClose, onConfirm }: {
  open: boolean; name: string; current: number; onClose: () => void; onConfirm: (qty: number) => void;
}) {
  const [value, setValue] = useState(String(current));
  useEffect(() => { if (open) setValue(String(current)); }, [open, current]);
  return (
    <Modal open={open} onClose={onClose} title="Alterar quantidade">
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(Number(value)); }}>
        <p className="mb-3 text-sm text-ink-mute">{name}</p>
        <Input autoFocus type="number" min={1} step={1} value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} aria-label="Quantidade" />
        <Button type="submit" fullWidth className="mt-4">Confirmar</Button>
      </form>
    </Modal>
  );
}

export function FreeItemModal({ open, onClose, onConfirm }: {
  open: boolean; onClose: () => void; onConfirm: (item: { description: string; quantity: number; unitPrice: number }) => void;
}) {
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  useEffect(() => { if (open) { setDescription(''); setQuantity('1'); setPrice(''); } }, [open]);
  function submit(e: FormEvent) {
    e.preventDefault();
    const unitPrice = parseMoney(price);
    const qty = Number(quantity);
    if (description.trim().length < 2) return void toast.error('Descreva o item.');
    if (!Number.isInteger(qty) || qty < 1) return void toast.error('Quantidade inválida.');
    if (!unitPrice) return void toast.error('Informe o valor unitário.');
    onConfirm({ description: description.trim(), quantity: qty, unitPrice });
  }
  return (
    <Modal open={open} onClose={onClose} title="Item livre">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-xs text-ink-mute">Cobrado na venda, sem cadastro no catálogo e sem baixa de estoque.</p>
        <div><Label>Descrição</Label><Input autoFocus value={description} onChange={(e) => setDescription(e.target.value)} placeholder="ex.: Peça personalizada" maxLength={200} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Quantidade</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
          <div><Label>Valor unitário (R$)</Label><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" /></div>
        </div>
        <Button type="submit" fullWidth>Adicionar à venda</Button>
      </form>
    </Modal>
  );
}

export function InternalUseModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [product, setProduct] = useState<PosProduct | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const requestId = useRef('');

  useEffect(() => {
    if (open) { setProduct(null); setQuantity('1'); setNote(''); }
  }, [open]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!product) return;
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1) return void toast.error('Quantidade inválida.');
    if (qty > product.stock) return void toast.error(`Estoque insuficiente (disponível: ${product.stock}).`);
    setSaving(true);
    requestId.current ||= newRequestId();
    try {
      await posService.internalUse({ clientRequestId: requestId.current, productId: product.id, quantity: qty, note: note.trim() || null });
      requestId.current = '';
      toast.success(`Uso interno registrado. Estoque: ${product.stock} → ${product.stock - qty}`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status > 0) requestId.current = '';
      toast.error(errorMessage(err, 'Não foi possível registrar o uso interno.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Uso interno" maxWidth="max-w-2xl">
      {open && !product && (
        <>
          <p className="mb-3 text-xs text-ink-mute">Saída de estoque para consumo próprio (produção, testes, impressoras). Não é venda.</p>
          <ProductPicker onPick={(p) => { requestId.current = ''; setProduct(p); }} />
        </>
      )}
      {open && product && (
        <form onSubmit={submit} className="space-y-3">
          <div className="rounded-xl bg-bg-soft p-3 text-sm">
            <p className="font-semibold">{product.name}</p>
            <p className="text-xs text-ink-mute">Estoque atual: {product.stock}</p>
          </div>
          <div><Label>Quantidade</Label><Input autoFocus type="number" min={1} max={product.stock} value={quantity} onChange={(e) => setQuantity(e.target.value)} onFocus={(e) => e.target.select()} /></div>
          <div><Label>Observação (opcional)</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: Produção interna, teste de impressão" maxLength={300} /></div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setProduct(null)}>Trocar produto</Button>
            <Button type="submit" className="flex-1" loading={saving}>Registrar uso interno</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function CustomerModal({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (c: Customer) => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CustomerRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', document: '' });
  const [saving, setSaving] = useState(false);
  const query = useDebounced(search);

  useEffect(() => {
    if (open) { setSearch(''); setCreating(false); setForm({ name: '', phone: '', email: '', document: '' }); }
  }, [open]);

  useEffect(() => {
    if (!open || creating) return;
    let active = true;
    customerService
      .list({ search: query || undefined, limit: 20 })
      .then((r) => active && setResults(r.customers))
      .catch((err) => active && toast.error(errorMessage(err, 'Erro ao buscar clientes.')));
    return () => { active = false; };
  }, [open, creating, query]);

  const { index, onKeyDown } = useListKeys(results, onPick);

  async function create(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { customer } = await customerService.create({
        name: form.name, phone: form.phone || null, email: form.email || null, document: form.document || null,
      });
      toast.success('Cliente cadastrado.');
      onPick(customer);
    } catch (err) {
      toast.error(errorMessage(err, 'Não foi possível cadastrar o cliente.'));
    } finally {
      setSaving(false);
    }
  }

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <Modal open={open} onClose={onClose} title={creating ? 'Novo cliente' : 'Cliente da venda'} maxWidth="max-w-xl">
      {!creating ? (
        <div onKeyDown={onKeyDown}>
          <div className="flex gap-2">
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome, telefone, e-mail ou CPF" aria-label="Buscar cliente" />
            <Button type="button" variant="secondary" onClick={() => { setForm((f) => ({ ...f, name: search })); setCreating(true); }}>
              <UserPlus className="h-4 w-4" /> Novo
            </Button>
          </div>
          <ul className="mt-3 max-h-80 divide-y divide-ink-line overflow-y-auto rounded-xl border border-ink-line" role="listbox" aria-label="Clientes">
            {results.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === index}>
                <button type="button" onClick={() => onPick(c)} className={`w-full px-3 py-2 text-left text-sm ${i === index ? 'bg-ink/5' : 'hover:bg-ink/5'}`}>
                  <span className="block font-semibold">{c.name}</span>
                  <span className="block text-xs text-ink-mute">{[c.phone, c.email].filter(Boolean).join(' · ') || 'Sem contato'}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && <li className="p-6 text-center text-sm text-ink-mute">Nenhum cliente encontrado.</li>}
          </ul>
        </div>
      ) : (
        <form onSubmit={create} className="space-y-3">
          <div><Label>Nome *</Label><Input autoFocus required minLength={2} {...field('name')} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Telefone</Label><Input {...field('phone')} placeholder="(54) 99999-9999" /></div>
            <div><Label>CPF (opcional)</Label><Input {...field('document')} /></div>
          </div>
          <div><Label>E-mail (opcional)</Label><Input type="email" {...field('email')} /></div>
          <p className="text-xs text-ink-mute">Não cria login nem senha no site.</p>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Voltar</Button>
            <Button type="submit" className="flex-1" loading={saving}>Cadastrar e usar na venda</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function PaymentModal({ open, subtotal, discount, submitting, onClose, onConfirm }: {
  open: boolean;
  subtotal: number;
  discount: number;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (p: { paymentMethod: PosPaymentMethod; amountReceived: number | null; notes: string | null; discount: number }) => void;
}) {
  const [method, setMethod] = useState<PosPaymentMethod>('PIX');
  const [discountText, setDiscountText] = useState('');
  const [received, setReceived] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) { setMethod('PIX'); setDiscountText(discount ? String(discount).replace('.', ',') : ''); setReceived(''); setNotes(''); }
    // Só ao abrir: depois o campo é a fonte do desconto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const discountValue = parseMoney(discountText) ?? 0;
  const invalidDiscount = discountValue > subtotal;
  const total = Math.max(0, Math.round((subtotal - discountValue) * 100) / 100);
  const receivedValue = method === 'CASH' ? parseMoney(received) : null;
  const change = changeFor(total, receivedValue);
  const insufficient = method === 'CASH' && receivedValue !== null && change === null;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (invalidDiscount || insufficient || submitting) return;
    onConfirm({ paymentMethod: method, amountReceived: receivedValue, notes: notes.trim() || null, discount: discountValue });
  }

  return (
    <Modal open={open} onClose={onClose} title="Pagamento" maxWidth="max-w-lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Forma de pagamento">
          {(Object.keys(PAYMENT_LABELS) as PosPaymentMethod[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${method === m ? 'border-ink bg-ink text-bg' : 'border-ink-line hover:bg-ink/5'}`}
            >
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Desconto (R$)</Label>
            <Input inputMode="decimal" autoFocus={method !== 'CASH'} value={discountText} onChange={(e) => setDiscountText(e.target.value)} placeholder="0,00" aria-label="Desconto" error={invalidDiscount ? 'Maior que o subtotal' : undefined} />
          </div>
          {method === 'CASH' && (
            <div>
              <Label>Valor recebido (R$)</Label>
              <Input inputMode="decimal" autoFocus aria-label="Valor recebido" value={received} onChange={(e) => setReceived(e.target.value)} placeholder="0,00" error={insufficient ? 'Menor que o total' : undefined} />
            </div>
          )}
        </div>
        <div><Label>Observação</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="min-h-[60px]" /></div>
        <div className="rounded-xl bg-bg-soft p-4">
          <div className="flex justify-between text-sm text-ink-mute"><span>Subtotal</span><span>{formatBRL(subtotal)}</span></div>
          <div className="flex justify-between text-sm text-ink-mute"><span>Desconto</span><span>- {formatBRL(discountValue)}</span></div>
          <div className="mt-1 flex items-baseline justify-between"><span className="font-semibold">Total</span><span className="text-2xl font-bold">{formatBRL(total)}</span></div>
          {change !== null && <div className="mt-1 flex justify-between text-sm font-semibold text-emerald-700"><span>Troco</span><span>{formatBRL(change)}</span></div>}
        </div>
        <Button type="submit" fullWidth size="lg" loading={submitting} disabled={invalidDiscount || insufficient}>Confirmar venda</Button>
      </form>
    </Modal>
  );
}

export function ConfirmModal({ open, title, message, confirmLabel, onClose, onConfirm }: {
  open: boolean; title: string; message: string; confirmLabel: string; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-sm text-ink-soft">{message}</p>
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose}>Voltar</Button>
        <Button variant="danger" className="flex-1" autoFocus onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}

