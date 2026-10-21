import { api } from './api';
import type { ApiCategory } from './types';

export const categoryService = {
  listPublic() {
    return api.get<{ categories: ApiCategory[] }>('/api/public/categories', { anonymous: true });
  },
  listAdmin() {
    return api.get<{ categories: ApiCategory[] }>('/api/admin/categories');
  },
  create(input: Partial<ApiCategory> & { name: string }) {
    return api.post<{ category: ApiCategory }>('/api/admin/categories', input);
  },
  update(id: string, input: Partial<ApiCategory>) {
    return api.put<{ category: ApiCategory }>(`/api/admin/categories/${id}`, input);
  },
  /** Imagem do card (`card`) ou do banner sazonal (`seasonal`) — vai para o Vercel Blob. */
  uploadImage(id: string, file: File, kind: 'card' | 'seasonal' = 'card') {
    const form = new FormData();
    form.append('image', file);
    return api.post<{ category: ApiCategory }>(`/api/admin/categories/${id}/${imagePath(kind)}`, form);
  },
  removeImage(id: string, kind: 'card' | 'seasonal' = 'card') {
    return api.del<{ category: ApiCategory }>(`/api/admin/categories/${id}/${imagePath(kind)}`);
  },
  remove(id: string) {
    return api.del<{ softDeleted?: boolean; hardDeleted?: boolean; category?: ApiCategory } | void>(
      `/api/admin/categories/${id}`,
    );
  },
};

const imagePath = (kind: 'card' | 'seasonal') => (kind === 'card' ? 'image' : 'seasonal-image');
