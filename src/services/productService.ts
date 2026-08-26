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
  create(input: Partial<ApiProduct> & { categoryId: string; name: string; price: number }) {
    return api.post<{ product: ApiProduct }>('/api/admin/products', input);
  },
  update(id: string, input: Partial<ApiProduct>) {
    return api.put<{ product: ApiProduct }>(`/api/admin/products/${id}`, input);
  },
  remove(id: string) {
    return api.del<{ softDeleted: boolean; product: ApiProduct }>(`/api/admin/products/${id}`);
  },
  addImages(id: string, files: File[]) {
    const form = new FormData();
    files.forEach((f) => form.append('images', f));
    return api.post<{ product: ApiProduct }>(`/api/admin/products/${id}/images`, form);
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
};

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
  reason?: string;
  identifier?: string;
  /** R19-C — true quando a linha também alterou a imagem principal do produto. */
  imageUpdated?: boolean;
}

export interface BulkImportReport {
  created: BulkImportItem[];
  updated: BulkImportItem[];
  skipped: BulkImportItem[];
  conflicts: BulkImportItem[];
  summary: { total: number; created: number; updated: number; skipped: number; conflicts: number };
}
