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

export default function Products() {
  useSEO('Admin Produtos');
  const { products, categories, removeProduct, updateProduct, refresh } = useAdminDataStore();
  const [importOpen, setImportOpen] = useState(false);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [lowStockOnly, setLowStockOnly] = useState(params.get('filter') === 'low-stock');
  const [confirm, setConfirm] = useState<string | null>(null);

  useEffect(() => {
    setLowStockOnly(params.get('filter') === 'low-stock');
  }, [params]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (cat !== 'all' && !p.categoryIds.includes(cat)) return false;
      if (lowStockOnly && p.stock > 5) return false;
      if (q && !`${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [products, cat, q, lowStockOnly]);

  function toggleActive(id: string, active: boolean) {
    updateProduct(id, { active });
    toast.success(active ? 'Produto ativado' : 'Produto desativado');
  }

  function doRemove(id: string) {
    removeProduct(id);
    toast.success('Produto removido');
    setConfirm(null);
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Produtos</h1>
          <p className="text-sm text-ink-mute">{filtered.length} produto(s)</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => exportProductsXlsx(products, categories)} disabled={products.length === 0}>
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
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-bg-soft text-left text-xs uppercase tracking-wider text-ink-mute">
            <tr>
              <th className="px-4 py-3">Produto</th>
              <th className="px-4 py-3">Marca</th>
              {/* R19-B — coluna Material separada de Marca. Some em telas
                  menores para preservar layout; o card interno rola horizontal. */}
              <th className="hidden px-4 py-3 md:table-cell">Material</th>
              <th className="px-4 py-3">Preço</th>
              <th className="px-4 py-3">Estoque</th>
              <th className="px-4 py-3">Modo</th>
              <th className="px-4 py-3">Ativo</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-line">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-bg-soft/50">
                <td className="flex items-center gap-3 px-4 py-3">
                  <img src={p.images[0]} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  <span className="font-semibold">{p.name}</span>
                </td>
                {/* R19-B — marca real (nunca deriva de material). Vazio = "—" */}
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
                    />
                  </label>
                </td>
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
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-ink-mute">Nenhum produto encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ProductImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onDone={() => refresh()}
      />

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Remover produto?">
        <p className="text-sm text-ink-mute">Essa ação não pode ser desfeita.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirm(null)}>Cancelar</Button>
          <Button variant="danger" onClick={() => confirm && doRemove(confirm)}>Remover</Button>
        </div>
      </Modal>
    </div>
  );
}
