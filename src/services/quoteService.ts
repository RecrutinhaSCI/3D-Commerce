import { api } from './api';
import type { ApiPagination, ApiQuote, ApiQuoteStatus } from './types';

export interface CreateQuotePayload {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  title: string;
  description: string;
  material?: string | null;
  color?: string | null;
  quantity?: number;
  deadline?: string | null;
}

export const quoteService = {
  create(input: CreateQuotePayload) {
    // Auth opcional: se tiver token de customer, backend associa via optionalAuthMiddleware.
    return api.post<{ quote: ApiQuote }>('/api/quotes', input);
  },
  /**
   * Um arquivo por requisição: a Vercel limita o corpo a 4,5 MB, então
   * mandar vários juntos estouraria o limite mesmo com arquivos pequenos.
   */
  async uploadFiles(quoteId: string, files: File[]) {
    let last: { quote: ApiQuote } | undefined;
    for (const f of files) {
      const form = new FormData();
      form.append('files', f);
      last = await api.post<{ quote: ApiQuote }>(`/api/quotes/${quoteId}/files`, form, { anonymous: true });
    }
    return last!;
  },
  listMine(query?: { status?: ApiQuoteStatus; page?: number; limit?: number }) {
    return api.get<{ quotes: ApiQuote[]; pagination: ApiPagination }>('/api/me/quotes', {
      query: query as Record<string, unknown> as never,
    });
  },
  getMine(id: string) {
    return api.get<{ quote: ApiQuote }>(`/api/me/quotes/${id}`);
  },
  listAdmin(query?: {
    status?: ApiQuoteStatus;
    search?: string;
    page?: number;
    limit?: number;
    sort?: 'newest' | 'oldest';
  }) {
    return api.get<{ quotes: ApiQuote[]; pagination: ApiPagination }>('/api/admin/quotes', {
      query: query as Record<string, unknown> as never,
    });
  },
  getAdmin(id: string) {
    return api.get<{ quote: ApiQuote }>(`/api/admin/quotes/${id}`);
  },
  updateAdmin(id: string, input: { estimatedValue?: number | null; adminNotes?: string | null }) {
    return api.put<{ quote: ApiQuote }>(`/api/admin/quotes/${id}`, input);
  },
  updateStatus(id: string, status: ApiQuoteStatus) {
    return api.put<{ quote: ApiQuote }>(`/api/admin/quotes/${id}/status`, { status });
  },
};
