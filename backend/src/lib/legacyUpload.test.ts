/**
 * Detecção de URL de upload antigo (disco) usada por uploads:migrate,
 * uploads:audit e check:config. Função pura — nenhum banco é tocado.
 */
import { describe, expect, it } from 'vitest';
import { isLegacyUploadUrl, legacyUploadPath } from './legacyUpload';

describe('legacyUploadPath', () => {
  it('aceita o caminho relativo antigo', () => {
    expect(legacyUploadPath('/uploads/products/abc.jpg')).toBe('/uploads/products/abc.jpg');
  });

  it('aceita a URL absoluta do backend (banners regravados com o host da API)', () => {
    expect(legacyUploadPath('https://threed-commerce-backend.onrender.com/uploads/site/x.webp')).toBe(
      '/uploads/site/x.webp',
    );
  });

  it('ignora Blob, seed, externas e valores que não são string', () => {
    expect(legacyUploadPath('https://abc.public.blob.vercel-storage.com/products/x.webp')).toBeNull();
    expect(legacyUploadPath('https://abc.public.blob.vercel-storage.com/uploads/products/x.webp')).toBeNull();
    expect(legacyUploadPath('/uploads/seed/pla-preto.svg')).toBeNull();
    expect(legacyUploadPath('https://cdn.example.com/img/x.jpg')).toBeNull();
    expect(legacyUploadPath(null)).toBeNull();
    expect(isLegacyUploadUrl(42)).toBe(false);
  });

  it('rejeita caminhos com subpastas extras', () => {
    expect(legacyUploadPath('/uploads/products/a/b.jpg')).toBeNull();
  });
});
