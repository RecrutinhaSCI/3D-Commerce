import { api } from './api';
import type { ApiPagination, ApiProduct, ApiPurchaseMode } from './types';

export interface PublicListQuery {
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  featured?: boolean;
  purchaseMode?: ApiPurchaseMode;
  page?: number;
  limit?: number;
  sort?: 'newest' | 'price_asc' | 'price_desc' | 'name_asc' | 'name_desc';
}

export interface AdminListQuery extends PublicListQuery {
  active?: boolean;
  lowStock?: boolean;
}

export const productService = {
  listPublic(query?: PublicListQuery) {
    return api.get<{ products: ApiProduct[]; pagination: ApiPagination }>('/api/public/products', {
      anonymous: true,
      query: query as Record<string, unknown> as never,
    });
  },
  featured(limit?: number) {
    return api.get<{ products: ApiProduct[] }>('/api/public/products/featured', {
      anonymous: true,
      query: { limit },
    });
  },
  getPublicBySlug(slug: string) {
    return api.get<{ product: ApiProduct }>(`/api/public/products/${encodeURIComponent(slug)}`, { anonymous: true });
  },
  listAdmin(query?: AdminListQuery) {
    return api.get<{ products: ApiProduct[]; pagination: ApiPagination }>('/api/admin/products', {
      query: query as Record<string, unknown> as never,
    });
  },
  /** Todas as páginas da listagem admin (inclui inativos). */
  async listAllAdmin(query?: Omit<AdminListQuery, 'page' | 'limit'>) {
    return fetchAllPages((page, limit) => productService.listAdmin({ ...query, page, limit }), 500);
  },
  /** Todas as páginas da listagem pública (só ativos). Máx. 100 por página no backend. */
  async listAllPublic(query?: Omit<PublicListQuery, 'page' | 'limit'>) {
    return fetchAllPages((page, limit) => productService.listPublic({ ...query, page, limit }), 100);
  },
  /** Admin — produto por ID, inclusive inativo (o endpoint público devolve 404 para inativos). */
  getAdminById(id: string) {
    return api.get<{ product: ApiProduct }>(`/api/admin/products/${encodeURIComponent(id)}`);
  },
  create(input: Partial<ApiProduct> & { categoryId: string; name: string; price: number }) {
    return api.post<{ product: ApiProduct }>('/api/admin/products', input);
  },
  update(id: string, input: Partial<ApiProduct>) {
    return api.put<{ product: ApiProduct }>(`/api/admin/products/${id}`, input);
  },
  /** Exclusão definitiva (pedidos antigos mantêm o snapshot do item). */
  remove(id: string) {
    return api.del<{ deleted: boolean; id: string }>(`/api/admin/products/${id}`);
  },
  /** Uma imagem por requisição (limite de 4,5 MB do corpo na Vercel). */
  async addImages(id: string, files: File[]) {
    let last: { product: ApiProduct } | undefined;
    for (const f of files) {
      const form = new FormData();
      form.append('images', f);
      last = await api.post<{ product: ApiProduct }>(`/api/admin/products/${id}/images`, form);
    }
    return last!;
  },
  removeImage(imageId: string) {
    return api.del(`/api/admin/products/images/${imageId}`);
  },
  /**
   * R19-A — Import em lote. Matching feito no backend (id → sku → slug
   * explícito → conflito seguro). Nunca deleta produtos existentes.
   */
  bulkImport(rows: BulkImportRow[]) {
    return api.post<BulkImportReport>('/api/admin/products/import', { rows });
  },
  /** Exclusão definitiva em massa — mesma regra de `remove`. */
  bulkDelete(ids: string[]) {
    return api.post<BulkDeleteReport>('/api/admin/products/bulk-delete', { ids });
  },
};

async function fetchAllPages(
  load: (page: number, limit: number) => Promise<{ products: ApiProduct[]; pagination: ApiPagination }>,
  limit: number,
): Promise<ApiProduct[]> {
  const first = await load(1, limit);
  const all = [...first.products];
  for (let page = 2; page <= first.pagination.totalPages; page++) {
    const next = await load(page, limit);
    all.push(...next.products);
  }
  return all;
}

export interface BulkDeleteReport {
  requested: number;
  deleted: number;
  deletedIds: string[];
  notFound: string[];
}

// R19-A — Contrato do bulk import (espelha `backend/src/modules/products/products.schemas.ts`).
export interface BulkImportRow {
  line: number;
  id?: string;
  sku?: string;
  slug?: string;
  name?: string;
  categoryName?: string;
  shortDescription?: string;
  description?: string;
  price?: number;
  promotionalPrice?: number;
  stock?: number;
  active?: boolean;
  featured?: boolean;
  // R19-B — brand e material independentes.
  brand?: string;
  material?: string;
  // R19-C — imagem principal por URL (opcional). Bloqueia protocolos inseguros no backend.
  imageUrl?: string;
}

export interface BulkImportItem {
  line: number;
  id?: string;
  name?: string;
  sku?: string;
  matchedBy?: 'id' | 'sku' | 'slug';
  reason?: string;
  identifier?: string;
  /** R19-C — true quando a linha também alterou a imagem principal do produto. */
  imageUpdated?: boolean;
}

export interface BulkImportReport {
  created: BulkImportItem[];
  updated: BulkImportItem[];
  /** Linhas que casaram com um produto mas não traziam nenhuma diferença. */
  unchanged: BulkImportItem[];
  skipped: BulkImportItem[];
  conflicts: BulkImportItem[];
  summary: { total: number; created: number; updated: number; unchanged: number; skipped: number; conflicts: number };
}
