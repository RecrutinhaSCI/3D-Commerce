import { useMemo, useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
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
  const [importOpen, setImportOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  // Inativo = fora da loja, mas ainda cadastrado (pode ser reativado).
  // Excluído = apagado do banco — nunca volta para esta lista.
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all');
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

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (cat !== 'all' && !p.categoryIds.includes(cat)) return false;
      if (status === 'active' && !p.active) return false;
      if (status === 'inactive' && p.active) return false;
      if (lowStockOnly && p.stock > 5) return false;
      if (q && !`${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [products, cat, q, lowStockOnly, status]);

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

  async function toggleActive(id: string, active: boolean) {
    try {
      await updateProduct(id, { active });
      toast.success(active ? 'Produto ativado (visível na loja)' : 'Produto desativado (oculto da loja)');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível alterar o status do produto.');
    }
  }

  async function doRemove(id: string) {
    setConfirm(null);
    try {
      await removeProduct(id);
      toast.success('Produto excluído');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível excluir o produto.');
    }
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

  async function doBulkRemove() {
    if (selected.size === 0) return;
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
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Produtos</h1>
          <p className="text-sm text-ink-mute">
            {filtered.length} produto(s)
            {products.some((p) => !p.active) && (
              <> · {products.filter((p) => !p.active).length} inativo(s)</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={doExport} loading={exporting} disabled={products.length === 0}>
            <Download className="h-4 w-4" /> Exportar Excel
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Importar Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={downloadProductTemplate}>
            <FileSpreadsheet className="h-4 w-4" /> Baixar modelo
          </Button>
          <Link to="/admin/produtos/novo" className="btn-primary">
            <Plus className="h-4 w-4" /> Novo produto
          </Link>
        </div>
      </header>

      {lowStockOnly && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
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

      <div className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar produto..." className="!pl-9" />
        </div>
        <Select value={cat} onChange={(e) => setCat(e.target.value)} className="max-w-[220px]">
          <option value="all">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="max-w-[180px]"
          aria-label="Filtrar por status"
        >
          <option value="all">Todos os status</option>
          <option value="active">Somente ativos</option>
          <option value="inactive">Somente inativos</option>
        </Select>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-line bg-bg-soft px-4 py-3 text-sm">
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

      <div className="card overflow-x-auto">
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
    </div>
  );
}
