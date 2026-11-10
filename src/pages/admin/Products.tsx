import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Edit, FileSpreadsheet, Plus, Search, Trash2, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';
import { formatBRL } from '@/utils/price';
import { Modal } from '@/components/ui/Modal';
import { useSEO } from '@/utils/seo';
import { exportProductsXlsx, downloadProductTemplate } from '@/utils/productExcel';
import { ProductImportModal } from '@/components/admin/ProductImportModal';
import { ApiError } from '@/services/api';
import { productService } from '@/services/productService';
import { editOnDoubleClick } from '@/utils/rowEdit';
import { ProductForm } from './ProductForm';
import { hasAllPhysical } from '@/shared/physicalLimits';

/**
 * Filtros no celular: dois por linha, mais baixos; do `md` para cima voltam ao
 * tamanho de antes (largura própria, `max-w-*` de cada um).
 */
const FILTER_SELECT =
  'min-w-0 flex-1 basis-[calc(50%-0.25rem)] pl-3 py-2 md:flex-initial md:basis-auto md:pl-4 md:py-2.5';

/** R19-E — dd/MM/aaaa HH:mm em pt-BR; `null` → traço. */
function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Products() {
  useSEO('Admin Produtos');
  const { products, categories, removeProduct, updateProduct, bulkRemoveProducts, refresh } = useAdminDataStore();
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editorVersion, setEditorVersion] = useState(0);
  const [statusBusy, setStatusBusy] = useState(false);
  const editorGuard = useRef({ dirty: false, busy: false });
  const onGuardChange = useCallback((dirty: boolean, busy: boolean) => {
    editorGuard.current = { dirty, busy };
  }, []);
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingLeave = useRef<(() => void) | null>(null);
  /**
   * Roda `proceed` se dá para sair do editor; com rascunho, pergunta antes.
   * A confirmação é um modal do sistema: `window.confirm` pode ser recusado em
   * silêncio pelo navegador, e a troca de produto "não acontecia".
   */
  function leaveEditor(proceed: () => void) {
    if (statusBusy || editorGuard.current.busy) {
      toast.error('Aguarde a operação do produto terminar.');
      return;
    }
    if (!editorGuard.current.dirty) {
      proceed();
      return;
    }
    pendingLeave.current = proceed;
    setDiscardOpen(true);
  }
  function answerDiscard(discard: boolean) {
    const proceed = pendingLeave.current;
    pendingLeave.current = null;
    setDiscardOpen(false);
    if (!discard) return;
    editorGuard.current = { dirty: false, busy: false };
    proceed?.();
  }
  function openProduct(id: string) {
    if (!window.matchMedia('(min-width: 1280px)').matches) {
      leaveEditor(() => navigate(`/admin/produtos/${id}`));
      return;
    }
    if (id === editingId) return;
    leaveEditor(() => setEditingId(id));
  }
  // No documento, e não só nesta página: o menu (Drawer) e o cabeçalho ficam fora dela.
  const linkGuard = useRef({ leaveEditor, navigate, blocked: false });
  linkGuard.current = { leaveEditor, navigate, blocked: statusBusy };
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank') return;
      const guard = linkGuard.current;
      if (!guard.blocked && !editorGuard.current.dirty && !editorGuard.current.busy) return;
      event.preventDefault();
      event.stopPropagation();
      const href = link.getAttribute('href')!;
      guard.leaveEditor(() => guard.navigate(href));
    }
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  const editingProduct = products.find((p) => p.id === editingId);
  const [importOpen, setImportOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  // Filtros vivem na URL (?busca=&categoria=&marca=&status=): sobrevivem a
  // abrir um produto e voltar, e o link pode ser compartilhado/recarregado.
  const q = params.get('busca') ?? '';
  const catSlug = params.get('categoria') ?? '';
  const cat = categories.find((c) => c.slug === catSlug)?.id ?? 'all';
  const brand = params.get('marca') ?? '';
  // Inativo = fora da loja, mas ainda cadastrado (pode ser reativado).
  // Excluído = apagado do banco — nunca volta para esta lista.
  const statusParam = params.get('status');
  const status: 'all' | 'active' | 'inactive' =
    statusParam === 'ativos' ? 'active' : statusParam === 'inativos' ? 'inactive' : 'all';
  /** Atualiza um filtro na URL sem empilhar histórico a cada tecla. */
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }
  // Sem peso/medidas completos = não cota frete pelo Melhor Envio.
  const missingOnly = params.get('medidas') === 'faltando';
  const hasFilters = ['busca', 'categoria', 'marca', 'status', 'filter', 'medidas'].some((k) => params.has(k));
  function clearFilters() {
    const next = new URLSearchParams(params);
    ['busca', 'categoria', 'marca', 'status', 'filter', 'medidas'].forEach((k) => next.delete(k));
    setParams(next, { replace: true });
  }
  // Marcas REAIS do catálogo (nada fixo), com contagem, em ordem alfabética.
  const brands = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of products) {
      const b = p.brand?.trim();
      if (b) count.set(b, (count.get(b) ?? 0) + 1);
    }
    return [...count].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [products]);
  const [exporting, setExporting] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(params.get('filter') === 'low-stock');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // R19-E — colunas de data são ocultáveis (default: visíveis).
  const [showDates, setShowDates] = useState(true);

  useEffect(() => {
    setLowStockOnly(params.get('filter') === 'low-stock');
  }, [params]);

  const missingCount = useMemo(() => products.filter((p) => !hasAllPhysical(p)).length, [products]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (cat !== 'all' && !p.categoryIds.includes(cat)) return false;
      if (brand && (p.brand ?? '').trim() !== brand) return false;
      if (status === 'active' && !p.active) return false;
      if (status === 'inactive' && p.active) return false;
      if (lowStockOnly && p.stock > 5) return false;
      if (missingOnly && hasAllPhysical(p)) return false;
      if (q && !`${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [products, cat, brand, q, lowStockOnly, missingOnly, status]);

  // R19-E — Ao trocar filtros, remove da seleção quaisquer IDs que saíram
  // da lista visível — evita deletar produto que o admin não vê mais.
  useEffect(() => {
    const visible = new Set(filtered.map((p) => p.id));
    setSelected((prev) => {
      const next = new Set<string>();
      for (const id of prev) if (visible.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [filtered]);

  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const someSelected = selected.size > 0;

  function toggleActive(id: string, active: boolean) {
    const run = async () => {
      if (id === editingId) setStatusBusy(true);
      try {
        await updateProduct(id, { active });
        if (id === editingId) setEditorVersion((v) => v + 1);
        toast.success(active ? 'Produto ativado (visível na loja)' : 'Produto desativado (oculto da loja)');
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Não foi possível alterar o status do produto.');
      } finally {
        if (id === editingId) setStatusBusy(false);
      }
    };
    if (id === editingId) leaveEditor(() => void run());
    else void run();
  }

  function doRemove(id: string) {
    const run = async () => {
      setConfirm(null);
      try {
        await removeProduct(id);
        toast.success('Produto excluído');
      } catch (err) {
        toast.error(err instanceof ApiError ? err.message : 'Não foi possível excluir o produto.');
      }
    };
    if (id === editingId) leaveEditor(() => void run());
    else void run();
  }

  /** Exporta direto do banco (não do cache da tela) — SKU e imagem reais. */
  async function doExport() {
    setExporting(true);
    try {
      const all = await productService.listAllAdmin();
      if (all.length === 0) {
        toast.error('Nenhum produto para exportar.');
        return;
      }
      exportProductsXlsx(all);
      toast.success(`${all.length} produto(s) exportado(s).`);
    } catch {
      toast.error('Falha ao exportar os produtos.');
    } finally {
      setExporting(false);
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        // Desmarca só os visíveis; preserva seleções fora da vista atual.
        const next = new Set(prev);
        for (const p of filtered) next.delete(p.id);
        return next;
      }
      const next = new Set(prev);
      for (const p of filtered) next.add(p.id);
      return next;
    });
  }

  function doBulkRemove() {
    if (selected.size === 0) return;
    if (editingId && selected.has(editingId)) leaveEditor(() => void runBulkRemove());
    else void runBulkRemove();
  }

  async function runBulkRemove() {
    setBulkBusy(true);
    const ids = Array.from(selected);
    const report = await bulkRemoveProducts(ids);
    setBulkBusy(false);
    setConfirmBulk(false);
    if (!report) {
      toast.error('Falha ao excluir os produtos selecionados.');
      return;
    }
    // Sucesso parcial: mostra números para o admin, sem esconder nada.
    const parts = [`${report.deleted} excluído(s)`];
    if (report.notFound.length) parts.push(`${report.notFound.length} já não existiam`);
    if (report.failed) {
      parts.push(`${report.failed} não puderam ser excluídos (tente de novo)`);
      toast.error(parts.join(', '));
    } else {
      toast.success(parts.join(', '));
    }
    setSelected(new Set());
  }

  return (
    <div>
      {/* Celular: "Novo produto" na linha do título e os botões de Excel abaixo.
          Do `md` para cima: mesma ordem de antes (Excel… e depois Novo produto). */}
      <header className="mb-4 flex flex-wrap items-end gap-x-2 gap-y-3 md:mb-6">
        <div className="mr-auto">
          <h1 className="text-xl font-bold md:text-2xl">Produtos</h1>
          <p className="text-xs text-ink-mute md:text-sm">
            {filtered.length} produto(s)
            {products.some((p) => !p.active) && (
              <> · {products.filter((p) => !p.active).length} inativo(s)</>
            )}
          </p>
        </div>
        <div className="order-last flex w-full flex-wrap items-center gap-2 md:order-none md:w-auto">
          <Button variant="secondary" size="sm" onClick={doExport} loading={exporting} disabled={products.length === 0}>
            <Download className="h-4 w-4" /> Exportar<span className="hidden sm:inline"> Excel</span>
          </Button>
          <Button variant="secondary" size="sm" onClick={() => leaveEditor(() => setImportOpen(true))}>
            <Upload className="h-4 w-4" /> Importar<span className="hidden sm:inline"> Excel</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadProductTemplate}>
            <FileSpreadsheet className="h-4 w-4" /> <span className="sm:hidden">Modelo</span>
            <span className="hidden sm:inline">Baixar modelo</span>
          </Button>
        </div>
        <Link to="/admin/produtos/novo" className="btn-primary px-3 py-1.5 text-xs md:px-4 md:py-2.5 md:text-sm">
          <Plus className="h-4 w-4" /> Novo produto
        </Link>
      </header>

      <div className="xl:grid xl:grid-cols-[minmax(320px,2fr)_minmax(0,3fr)] xl:items-start xl:gap-6">
      <div className="min-w-0 xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)] xl:overflow-y-auto">
      {lowStockOnly && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 md:px-4 md:py-3 md:text-sm">
          <span className="font-semibold">Mostrando apenas produtos com estoque baixo (≤ 5 unidades)</span>
          <button
            onClick={() => {
              setLowStockOnly(false);
              const next = new URLSearchParams(params);
              next.delete('filter');
              setParams(next);
            }}
            className="text-xs font-semibold underline"
          >
            Limpar filtro
          </button>
        </div>
      )}

      <div className="card mb-4 flex flex-wrap items-center gap-2 p-3 md:gap-3 md:p-4">
        <div className="relative min-w-[220px] flex-1 basis-full md:basis-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
          <Input value={q} onChange={(e) => setFilter('busca', e.target.value)} placeholder="Buscar produto..." className="!pl-9 py-2 md:py-2.5" />
        </div>
        <Select
          value={cat === 'all' ? '' : catSlug}
          onChange={(e) => setFilter('categoria', e.target.value)}
          className={`max-w-[220px] ${FILTER_SELECT}`}
          aria-label="Filtrar por categoria"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={brand}
          onChange={(e) => setFilter('marca', e.target.value)}
          className={`max-w-[200px] ${FILTER_SELECT}`}
          aria-label="Filtrar por marca"
        >
          <option value="">Todas as marcas</option>
          {brands.map(([b, n]) => (
            <option key={b} value={b}>
              {b} ({n})
            </option>
          ))}
          {/* Marca da URL que não existe mais no catálogo: mantém visível para dar para limpar. */}
          {brand && !brands.some(([b]) => b === brand) && <option value={brand}>{brand} (0)</option>}
        </Select>
        <Select
          value={status === 'active' ? 'ativos' : status === 'inactive' ? 'inativos' : ''}
          onChange={(e) => setFilter('status', e.target.value)}
          className={`max-w-[180px] ${FILTER_SELECT}`}
          aria-label="Filtrar por status"
        >
          <option value="">Todos os status</option>
          <option value="ativos">Somente ativos</option>
          <option value="inativos">Somente inativos</option>
        </Select>
        <label
          className="flex items-center gap-2 text-xs text-ink-soft"
          title="Produtos sem peso e medidas da embalagem não têm frete calculado por CEP"
        >
          <input
            type="checkbox"
            checked={missingOnly}
            onChange={(e) => setFilter('medidas', e.target.checked ? 'faltando' : '')}
            className="accent-ink"
          />
          Sem medidas ({missingCount})
        </label>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Limpar filtros
          </Button>
        )}
        {/* Datas só existem na tabela larga (lg+): no celular o controle não faria nada. */}
        <label className="ml-auto hidden items-center gap-2 text-xs text-ink-soft lg:flex">
          <input
            type="checkbox"
            checked={showDates}
            onChange={(e) => setShowDates(e.target.checked)}
            className="accent-ink"
          />
          Mostrar datas
        </label>
      </div>

      {/* R19-E — Barra de ação em massa. Só aparece quando há seleção. */}
      {someSelected && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-line bg-bg-soft px-3 py-2 text-xs md:gap-3 md:px-4 md:py-3 md:text-sm">
          <span className="font-semibold">
            {selected.size} produto(s) selecionado(s)
          </span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
            <Button variant="danger" size="sm" onClick={() => setConfirmBulk(true)}>
              <Trash2 className="h-4 w-4" /> Excluir selecionados
            </Button>
          </div>
        </div>
      )}

      {/* Celular: lista compacta (mais produtos por tela, sem rolagem lateral). */}
      <div className="card overflow-hidden md:hidden xl:block">
        <div className="flex items-center justify-between gap-2 border-b border-ink-line bg-bg-soft px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-mute">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Selecionar todos"
              checked={allVisibleSelected}
              ref={(el) => {
                if (el) el.indeterminate = someSelected && !allVisibleSelected;
              }}
              onChange={toggleAllVisible}
              className="accent-ink"
            />
            Produto
          </label>
          <span>Ativo</span>
        </div>
        <ul className="divide-y divide-ink-line">
          {filtered.map((p) => {
            const meta = [p.brand?.trim(), p.material && p.material !== '-' ? p.material : '', p.purchaseMode]
              .filter(Boolean)
              .join(' · ');
            return (
              <li
                key={p.id}
                {...editOnDoubleClick(() => openProduct(p.id))}
                onClick={(event) => {
                  if (window.matchMedia('(min-width: 1280px)').matches &&
                      !(event.target as HTMLElement).closest('button, input, a, label')) openProduct(p.id);
                }}
                className={`flex items-start gap-2.5 px-3 py-2 ${editingId === p.id ? 'bg-bg-soft ring-2 ring-inset ring-ink/30' : selected.has(p.id) ? 'bg-bg-soft/60' : ''} ${p.active ? '' : 'text-ink-mute'}`}
              >
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${p.name}`}
                  checked={selected.has(p.id)}
                  onChange={() => toggleOne(p.id)}
                  className="mt-3.5 shrink-0 accent-ink"
                />
                <img
                  src={p.images[0]}
                  alt=""
                  className={`h-11 w-11 shrink-0 rounded-md object-cover ${p.active ? '' : 'opacity-50 grayscale'}`}
                />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => openProduct(p.id)} aria-pressed={editingId === p.id} className="line-clamp-2 text-left text-[13px] font-semibold leading-snug">
                    {p.name}
                  </button>
                  {meta && <p className="truncate text-[11px] capitalize leading-tight text-ink-mute">{meta}</p>}
                  {showDates && <p className="hidden text-[10px] text-ink-mute xl:block">
                    Cadastro: {formatDateTime(p.createdAt)} · Estoque: {p.stockUpdatedAt ? formatDateTime(p.stockUpdatedAt) : 'Sem histórico'}
                  </p>}
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-tight">
                    <span className="text-xs font-semibold text-ink">{formatBRL(p.promoPrice ?? p.price)}</span>
                    <span className={p.stock <= 5 ? 'font-semibold text-rose-600' : 'text-ink-mute'}>Estq. {p.stock}</span>
                    {!p.active && (
                      <span className="rounded-full bg-ink/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-ink-mute">
                        Inativo
                      </span>
                    )}
                    {!hasAllPhysical(p) && (
                      <span
                        title="Sem peso/medidas da embalagem — não tem frete calculado por CEP. Edite o produto para completar."
                        className="rounded-full bg-amber-100 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-amber-700"
                      >
                        Sem medidas
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <input
                    type="checkbox"
                    checked={p.active}
                    onChange={(e) => toggleActive(p.id, e.target.checked)}
                    className="m-1.5 accent-ink"
                    aria-label={p.active ? `Desativar ${p.name}` : `Ativar ${p.name}`}
                  />
                  <div className="flex items-center">
                    <button type="button" onClick={() => openProduct(p.id)} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5 hover:text-ink" aria-label="Editar">
                      <Edit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setConfirm(p.id)}
                      className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
          {filtered.length === 0 && <li className="px-3 py-8 text-center text-sm text-ink-mute">Nenhum produto encontrado.</li>}
        </ul>
      </div>

      <div className="card hidden overflow-x-auto md:block xl:hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  checked={allVisibleSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected && !allVisibleSelected;
                  }}
                  onChange={toggleAllVisible}
                  className="accent-ink"
                />
              </th>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Marca</th>
              <th className="hidden px-4 py-3 md:table-cell">Material</th>
              <th className="px-4 py-3">Preço</th>
              <th className="px-4 py-3">Estoque</th>
              <th className="px-4 py-3">Modo</th>
              <th className="px-4 py-3">Ativo</th>
              {showDates && <th className="hidden px-4 py-3 lg:table-cell">Adicionado em</th>}
              {showDates && <th className="hidden px-4 py-3 lg:table-cell">Estoque atualizado em</th>}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {filtered.map((p) => (
              <tr
                key={p.id}
                {...editOnDoubleClick(() => navigate(`/admin/produtos/${p.id}`))}
                className={`hover:bg-bg-soft/50 ${selected.has(p.id) ? 'bg-bg-soft/40' : ''} ${p.active ? '' : 'text-ink-mute'}`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${p.name}`}
                    checked={selected.has(p.id)}
                    onChange={() => toggleOne(p.id)}
                    className="accent-ink"
                  />
                </td>
                <td className="flex items-center gap-3 px-4 py-3">
                  <img
                    src={p.images[0]}
                    alt=""
                    className={`h-10 w-10 rounded-lg object-cover ${p.active ? '' : 'opacity-50 grayscale'}`}
                  />
                  <div>
                    <span className="block font-semibold">{p.name}</span>
                    {!p.active && (
                      <span
                        title="Fora da loja — reative marcando Ativo"
                        className="mt-0.5 inline-block whitespace-nowrap rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-mute"
                      >
                        Inativo
                      </span>
                    )}
                    {!hasAllPhysical(p) && (
                      <span
                        title="Sem peso/medidas da embalagem — não tem frete calculado por CEP. Edite o produto para completar."
                        className="ml-1 mt-0.5 inline-block whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
                      >
                        Sem medidas
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink-mute">{p.brand?.trim() || '—'}</td>
                <td className="hidden px-4 py-3 text-ink-mute md:table-cell">
                  {p.material && p.material !== '-' ? p.material : '—'}
                </td>
                <td className="px-4 py-3">{formatBRL(p.promoPrice ?? p.price)}</td>
                <td className="px-4 py-3">{p.stock}</td>
                <td className="px-4 py-3 text-ink-mute capitalize">{p.purchaseMode}</td>
                <td className="px-4 py-3">
                  <label className="inline-flex cursor-pointer items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.active}
                      onChange={(e) => toggleActive(p.id, e.target.checked)}
                      className="accent-ink"
                      aria-label={p.active ? `Desativar ${p.name}` : `Ativar ${p.name}`}
                    />
                  </label>
                </td>
                {showDates && (
                  <td className="hidden px-4 py-3 text-xs text-ink-mute lg:table-cell whitespace-nowrap">
                    {formatDateTime(p.createdAt)}
                  </td>
                )}
                {showDates && (
                  <td className="hidden px-4 py-3 text-xs text-ink-mute lg:table-cell whitespace-nowrap">
                    {p.stockUpdatedAt ? formatDateTime(p.stockUpdatedAt) : 'Sem histórico'}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <Link to={`/admin/produtos/${p.id}`} className="rounded-lg p-1.5 text-ink-mute hover:bg-ink/5 hover:text-ink" aria-label="Editar">
                      <Edit className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => setConfirm(p.id)}
                      className="rounded-lg p-1.5 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Remover"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showDates ? 11 : 9} className="px-4 py-10 text-center text-sm text-ink-mute">
                  Nenhum produto encontrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      </div>
      <section className="hidden min-w-0 xl:block" aria-label="Produto selecionado">
        {editingProduct ? (
          <ProductForm key={`${editingProduct.id}-${editorVersion}`} id={editingProduct.id} embedded externalBusy={statusBusy} onGuardChange={onGuardChange} />
        ) : (
          <div className="card p-8 text-center text-sm text-ink-mute">Selecione um produto na lista para editar.</div>
        )}
      </section>
      </div>

      <ProductImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => refresh()}
      />

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Excluir produto?">
        <p className="text-sm text-ink-mute">
          O produto e as fotos dele são <b>apagados definitivamente</b>. Pedidos antigos continuam com nome,
          SKU e preço registrados. Para apenas tirar da loja sem apagar, desmarque <b>Ativo</b>.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirm && doRemove(confirm)}>Excluir</Button>
        </div>
      </Modal>

      <Modal open={confirmBulk} onClose={() => setConfirmBulk(false)} title={`Excluir ${selected.size} produto(s)?`}>
        <p className="text-sm text-ink-mute">
          {selected.size} produto(s) e suas fotos serão <b>apagados definitivamente</b> — não dá para desfazer.
          Pedidos antigos continuam com nome, SKU e preço registrados.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmBulk(false)} disabled={bulkBusy}>Cancelar</Button>
          <Button variant="danger" onClick={doBulkRemove} loading={bulkBusy}>
            Confirmar exclusão
          </Button>
        </div>
      </Modal>

      {/* No body: precisa ficar acima do Drawer do menu, que vem depois no DOM. */}
      {createPortal(
        <Modal open={discardOpen} onClose={() => answerDiscard(false)} title="Descartar alterações?">
          <p className="text-sm text-ink-mute">As alterações deste produto ainda não foram salvas.</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" autoFocus onClick={() => answerDiscard(false)}>Continuar editando</Button>
            <Button variant="danger" onClick={() => answerDiscard(true)}>Descartar alterações</Button>
          </div>
        </Modal>,
        document.body,
      )}
    </div>
  );
}
