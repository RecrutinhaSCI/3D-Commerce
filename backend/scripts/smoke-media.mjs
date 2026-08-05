/**
 * Smoke R20 — upload de mídia:
 *  - GIF, MP4 e JPG PNG pass
 *  - Formato inválido (SVG) bloqueado
 *  - MP4 acima do limite bloqueado
 *  - Endpoint /admin/settings/upload-image devolve URL
 * Requer backend em http://localhost:3333 (admin@3dcommerce.com / admin123).
 */
import { readFileSync } from 'node:fs';

const API = 'http://localhost:3333';
let passed = 0, failed = 0;
const ok = (n, c, e = '') => c ? (passed++, console.log('  OK  ' + n)) : (failed++, console.log('FALHOU ' + n + ' ' + e));

async function login() {
  const r = await fetch(`${API}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@3dcommerce.com', password: 'admin123' }),
  });
  const j = await r.json();
  return j.data?.token;
}

// Helpers para forjar arquivos binários no formato correto (assinatura + tamanho).
function makeFile(bytes, name, type) {
  return new File([bytes], name, { type });
}
function pngBytes() {
  // PNG mínimo válido (1x1 transparente).
  return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=', 'base64');
}
function jpgBytes() {
  // JPEG mínimo (bytes suficientes para o Multer aceitar como image/jpeg).
  return Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wgARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACP/EABQBAQAAAAAAAAAAAAAAAAAAAAf/2gAMAwEAAhADEAAAAT8P/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', 'base64');
}
function gifBytes() {
  // GIF89a 1x1.
  return Buffer.from('R0lGODlhAQABAAAAACw=', 'base64');
}
function mp4Header(sizeBytes) {
  // ftyp box (isom) — o Multer aceita mimetype declarado; conteúdo binário só precisa
  // ter tamanho para os testes de limite. Prefixamos com um header ftyp real para
  // parecer com um MP4 legítimo.
  const header = Buffer.from('0000001C6674797069736F6D0000000269736F6D69736F32617663316D703431', 'hex');
  const filler = Buffer.alloc(Math.max(0, sizeBytes - header.length), 0);
  return Buffer.concat([header, filler]);
}

const token = await login();
ok('login admin', !!token);

// Cria um produto novo para receber as mídias.
let r = await fetch(`${API}/api/admin/products`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({
    name: `Smoke R20 ${Date.now()}`,
    categoryId: (await (await fetch(`${API}/api/public/categories`)).json()).data.categories[0].id,
    price: 10,
    stock: 5,
    purchaseMode: 'DIRECT',
  }),
});
let j = await r.json();
const productId = j.data?.product?.id;
ok('produto criado', !!productId, JSON.stringify(j));

// -- 1. Upload de PNG + GIF + MP4 juntos --
let form = new FormData();
form.append('images', makeFile(pngBytes(), 'a.png', 'image/png'));
form.append('images', makeFile(gifBytes(), 'b.gif', 'image/gif'));
form.append('images', makeFile(mp4Header(50_000), 'c.mp4', 'video/mp4'));
r = await fetch(`${API}/api/admin/products/${productId}/images`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
});
j = await r.json();
ok('upload PNG+GIF+MP4 → 200', r.status === 200 || r.status === 201, `status=${r.status} ${JSON.stringify(j)}`);
const images = j.data?.product?.images ?? [];
ok('3 mídias gravadas', images.length === 3);
const byExt = Object.fromEntries(images.map(i => [i.url.slice(i.url.lastIndexOf('.')), i]));
ok('PNG marcado como image', byExt['.png']?.mediaType === 'image');
ok('GIF marcado como image (renderiza <img>)', byExt['.gif']?.mediaType === 'image');
ok('MP4 marcado como video', byExt['.mp4']?.mediaType === 'video');
ok('MP4 tem mimeType video/mp4', byExt['.mp4']?.mimeType === 'video/mp4');

// -- 2. Formato inválido: SVG bloqueado --
form = new FormData();
form.append('images', makeFile(Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml'));
r = await fetch(`${API}/api/admin/products/${productId}/images`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
});
j = await r.json();
ok('SVG bloqueado (400)', r.status === 400 && /formato/i.test(j.error?.message ?? ''), `status=${r.status} ${JSON.stringify(j)}`);

// -- 3. MP4 acima do limite (>8MB) --
form = new FormData();
form.append('images', makeFile(mp4Header(9 * 1024 * 1024 + 10), 'big.mp4', 'video/mp4'));
r = await fetch(`${API}/api/admin/products/${productId}/images`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
});
j = await r.json();
ok('MP4 >8MB bloqueado (413 ou 400)', r.status === 413 || r.status === 400, `status=${r.status}`);

// -- 4. Imagem acima do limite específico (>5MB, dentro do limite do multer 8MB) --
form = new FormData();
form.append('images', makeFile(Buffer.alloc(6 * 1024 * 1024, 0x00), 'big.png', 'image/png'));
r = await fetch(`${API}/api/admin/products/${productId}/images`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
});
j = await r.json();
ok('IMAGEM >5MB bloqueada pelo service (400)', r.status === 400 && /5MB|acima/i.test(j.error?.message ?? ''), `status=${r.status} ${JSON.stringify(j)}`);

// -- 5. Endpoint de upload de imagem avulsa (thumbnails de vídeo) --
form = new FormData();
form.append('image', makeFile(pngBytes(), 'thumb.png', 'image/png'));
r = await fetch(`${API}/api/admin/settings/upload-image`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
});
j = await r.json();
ok('upload-image devolve URL /uploads/site/', j.data?.url?.startsWith('/uploads/site/'), JSON.stringify(j));

// -- 6. upload-image rejeita SVG --
form = new FormData();
form.append('image', makeFile(Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml'));
r = await fetch(`${API}/api/admin/settings/upload-image`, {
  method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form,
});
ok('upload-image rejeita SVG', r.status === 400);

// -- 7. GET público inclui mediaType --
r = await fetch(`${API}/api/public/products?limit=50`);
j = await r.json();
const seededProduct = j.data.products.find(p => p.images.length > 0);
ok('produto seedado tem mediaType=image (compat)', seededProduct?.images?.[0]?.mediaType === 'image');

console.log(`\nResultado: ${passed} OK, ${failed} FALHOU`);
process.exit(failed ? 1 : 0);
