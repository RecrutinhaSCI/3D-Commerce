// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const update = vi.hoisted(() => vi.fn());
vi.mock('@/services/productService', () => ({ productService: { update } }));

import { useAdminDataStore } from './useAdminDataStore';

beforeEach(() => {
  update.mockReset().mockResolvedValue({
    product: { id: 'A', slug: 'a', name: 'A', price: 10, stock: 1, active: true, featured: false, purchaseMode: 'DIRECT', images: [], createdAt: '2026-01-01' },
  });
  useAdminDataStore.setState({ products: [] });
});

it('produto sem medidas não envia null (a API recusaria o save inteiro)', async () => {
  await useAdminDataStore.getState().updateProduct('A', { price: 10, weight: undefined, width: undefined, height: undefined, depth: undefined });
  const payload = update.mock.calls[0][1];
  expect(payload).toEqual({ price: 10 });
});

it('medida informada continua indo no payload', async () => {
  await useAdminDataStore.getState().updateProduct('A', { weight: 1.2, depth: undefined });
  const payload = update.mock.calls[0][1];
  expect(payload).toEqual({ weight: 1.2 });
});
