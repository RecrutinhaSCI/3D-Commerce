import { api } from './api';
import type { ApiSettings } from './types';

export const settingsService = {
  getPublic() {
    return api.get<{ settings: ApiSettings }>('/api/public/settings', { anonymous: true });
  },
  getAdmin() {
    return api.get<{ settings: ApiSettings }>('/api/admin/settings');
  },
  update(input: Partial<ApiSettings>) {
    return api.put<{ settings: ApiSettings }>('/api/admin/settings', input);
  },
  uploadLogo(file: File) {
    const form = new FormData();
    form.append('logo', file);
    return api.post<{ settings: ApiSettings }>('/api/admin/settings/logo', form);
  },
  /** Capa de um post do Blog (Vercel Blob). Substitui a anterior. */
  uploadBlogCover(slug: string, file: File) {
    const form = new FormData();
    form.append('image', file);
    return api.post<{ settings: ApiSettings }>(`/api/admin/settings/blog-covers/${encodeURIComponent(slug)}`, form);
  },
  /** Texto do post (substitui a versão salva). Campos vazios voltam ao padrão. */
  updateBlogContent(slug: string, content: { title?: string; category?: string; excerpt?: string; readTime?: string; content?: string }) {
    return api.put<{ settings: ApiSettings }>(`/api/admin/settings/blog-posts/${encodeURIComponent(slug)}`, content);
  },
  /** Descarta a versão salva — o post volta ao texto padrão do código. */
  resetBlogContent(slug: string) {
    return api.del<{ settings: ApiSettings }>(`/api/admin/settings/blog-posts/${encodeURIComponent(slug)}`);
  },
  removeBlogCover(slug: string) {
    return api.del<{ settings: ApiSettings }>(`/api/admin/settings/blog-covers/${encodeURIComponent(slug)}`);
  },
  /** Upload de imagem avulsa (thumbnails de vídeo). Retorna apenas a URL relativa. */
  uploadImage(file: File) {
    const form = new FormData();
    form.append('image', file);
    return api.post<{ url: string }>('/api/admin/settings/upload-image', form);
  },
};
