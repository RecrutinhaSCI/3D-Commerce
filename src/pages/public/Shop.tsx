import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { ProductGrid } from '@/components/product/ProductGrid';
import { ProductFilters, MAX_PRICE, type FiltersState } from '@/components/product/ProductFilters';
import { ProductSort, applySort, type SortKey } from '@/components/product/ProductSort';
import { EmptyState } from '@/components/ui/EmptyState';
import { Sparkles, SlidersHorizontal, X } from 'lucide-react';
import { SeasonalHero } from '@/components/seasonal/SeasonalHero';
import { seasonalTheme } from '@/utils/seasonalTheme';
import { useSEO } from '@/utils/seo';
import { isFilamentCategory } from '@/utils/categoryGroups';

export default function Shop({ categorySlug, title: titleProp }: { categorySlug?: string; title?: string }) {
  const products = useAdminDataStore((s) => s.products);
  const categories = useAdminDataStore((s) => s.categories);
  const [params] = useSearchParams();
  const q = params.get('q') ?? '';
  // Atalhos do mega menu: /loja?grupo=filamentos (todas as categorias de
  // filamento) e /loja?filtro=destaques (produtos marcados como destaque).
  const isFilamentGroup = !categorySlug && params.get('grupo') === 'filamentos';
  const isHighlightsPage = !categorySlug && params.get('filtro') === 'destaques';
  const title = titleProp ?? (isFilamentGroup ? 'Filamentos' : isHighlightsPage ? 'Destaques' : undefined);
  useSEO(title ?? 'Loja', 'Todos os produtos de impressão 3D da 3DCommerce.');

  const category = categorySlug ? categories.find((c) => c.slug === categorySlug) : undefined;

  const isOffersPage = category?.slug === 'ofertas';
  const filamentIds = categories.filter(isFilamentCategory).map((c) => c.id);
  const routeCategories = () =>
    category && !isOffersPage ? [category.id] : isFilamentGroup ? filamentIds : [];

  const [filters, setFilters] = useState<FiltersState>({
    q,
    categories: routeCategories(),
    materials: [],
    brands: [],
    minPrice: 0,
    maxPrice: MAX_PRICE,
    inStockOnly: false,
  });
  const [sort, setSort] = useState<SortKey>('novidades');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Resync os filtros quando a categoria da rota muda (ex.: PLA -> PETG).
  // Sem isso, o componente Shop permanece montado entre rotas /categoria/:slug
  // e o filtro de categoria fica preso na primeira categoria selecionada,
  // exibindo todos os filamentos independente do menu escolhido.
  useEffect(() => {
    setFilters((prev) => ({
      ...prev,
      categories: routeCategories(),
      // Marcas selecionadas que não existem na nova categoria são descartadas,
      // evitando filtro "preso" sem resultados ao trocar de catálogo.
      brands: [],
    }));
  }, [category?.id, isFilamentGroup, filamentIds.join(',')]);

  // Produtos do escopo do catálogo atual (apenas o recorte de categoria/ofertas/sazonal),
  // sem aplicar os filtros secundários. Serve de base para a lista e para alimentar
  // o painel de filtros — assim a lista de marcas mostra só as marcas presentes aqui.
  const scopedProducts = useMemo(() => {
    let arr = products.filter((p) => p.active);
    if (category?.slug === 'ofertas') {
      // "Ofertas" não é uma categoria atribuída ao produto: é a flag "Oferta"
      // OU qualquer produto com preço promocional menor que o preço normal.
      arr = arr.filter((p) => p.isOffer || (p.promoPrice != null && p.promoPrice < p.price));
    } else if (isHighlightsPage) {
      arr = arr.filter((p) => p.isHighlight);
    } else if (category?.isSeasonal && category.productIds?.length) {
      arr = arr.filter((p) => category.productIds!.includes(p.id));
    } else if (filters.categories.length) {
      arr = arr.filter((p) => p.categoryIds.some((id) => filters.categories.includes(id)));
    }
    return arr;
  }, [products, category, filters.categories, isHighlightsPage]);

  const filtered = useMemo(() => {
    let arr = scopedProducts;
    if (filters.brands.length) {
      arr = arr.filter((p) => filters.brands.includes(p.brand));
    }
    arr = arr.filter((p) => {
      const price = p.promoPrice ?? p.price;
      return price >= filters.minPrice && price <= filters.maxPrice;
    });
    if (filters.inStockOnly) arr = arr.filter((p) => p.stock > 0);
    const text = (q || filters.q).trim().toLowerCase();
    if (text) {
      arr = arr.filter(
        (p) =>
          p.name.toLowerCase().includes(text) ||
          p.brand.toLowerCase().includes(text) ||
          (p.material ?? '').toLowerCase().includes(text) ||
          p.description.toLowerCase().includes(text),
      );
    }
    return applySort(arr, sort);
  }, [scopedProducts, filters, q, sort]);

  // Só a categoria SAZONAL ganha hero/layout de campanha; as demais seguem o
  // layout de sempre. Tudo vem do Admin → Categoria sazonal.
  const isSeasonalPage = !!category?.isSeasonal;
  const seasonalAccent = isSeasonalPage ? seasonalTheme(category?.seasonalColors).accent : undefined;

  return (
    <div className="container-x py-10">
      {isSeasonalPage && category ? (
        <>
          <SeasonalHero category={category} variant="page" productCount={scopedProducts.length} />
          <div className="mb-6 mt-10 flex flex-wrap items-end justify-between gap-2" data-seasonal-collection-header>
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest" style={{ color: seasonalAccent }}>
                <Sparkles className="h-3.5 w-3.5" /> Coleção da campanha
              </p>
              <h2 className="mt-1 text-2xl font-bold">{category.seasonalBanner || category.name}</h2>
            </div>
            {q && <p className="text-sm text-ink-mute">Busca por: <strong>{q}</strong></p>}
          </div>
        </>
      ) : (
        <div className="mb-6">
          <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Catálogo</p>
          <h1 className="mt-1 text-3xl font-bold">{title ?? category?.name ?? 'Todos os produtos'}</h1>
          {category?.description && <p className="mt-2 max-w-2xl text-sm text-ink-mute">{category.description}</p>}
          {q && <p className="mt-2 text-sm text-ink-mute">Busca por: <strong>{q}</strong></p>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
        <div className="hidden lg:block">
          <ProductFilters products={scopedProducts} filters={filters} setFilters={setFilters} />
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              onClick={() => setFiltersOpen(true)}
              className="btn-secondary !py-2 lg:hidden"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filtros
            </button>
            <p className="text-xs text-ink-mute">{filtered.length} produto(s)</p>
            <ProductSort value={sort} onChange={setSort} />
          </div>

          {isSeasonalPage && scopedProducts.length === 0 ? (
            // Campanha ainda sem produtos: mensagem da própria campanha, não o "vazio" da loja.
            <EmptyState
              icon={<Sparkles className="h-6 w-6" style={{ color: seasonalAccent }} />}
              title={`A coleção “${category?.seasonalBanner || category?.name}” está sendo preparada`}
              description="Os produtos desta edição especial aparecem aqui em breve. Enquanto isso, confira o restante da loja."
              action={
                <Link to="/loja" className="btn-secondary mt-1">
                  Ver todos os produtos
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Nenhum produto encontrado"
              description="Tente remover alguns filtros ou alterar sua busca."
            />
          ) : (
            <ProductGrid products={filtered} />
          )}
        </div>
      </div>

      {filtersOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setFiltersOpen(false)} />
          <div className="absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-bg p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold">Filtros</h3>
              <button onClick={() => setFiltersOpen(false)} aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ProductFilters products={scopedProducts} filters={filters} setFilters={setFilters} />
          </div>
        </div>
      )}
    </div>
  );
}
