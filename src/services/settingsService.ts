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
  /** Upload de imagem avulsa (thumbnails de vídeo). Retorna apenas a URL relativa. */
  uploadImage(file: File) {
    const form = new FormData();
    form.append('image', file);
    return api.post<{ url: string }>('/api/admin/settings/upload-image', form);
  },
};
