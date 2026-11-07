/**
 * Serviço das etiquetas: o CORPO HTTP de cada ação leva só o permitido —
 * a compra nunca envia preço, serviceId, meOrderId, status ou payload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), getBlob: vi.fn() }));
vi.mock('./api', () => ({ api }));
const { shipmentLabelService } = await import('./shippingLabelsService');

beforeEach(() => vi.clearAllMocks());

describe('shipmentLabelService', () => {
  it('compra: corpo é exatamente { labelId, token }', async () => {
    await shipmentLabelService.purchase('ord 1', 'lab1', 'TOKEN');
    expect(api.post).toHaveBeenCalledWith('/api/admin/shipping-labels/orders/ord%201/label/purchase', { labelId: 'lab1', token: 'TOKEN' });
    const body = api.post.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['labelId', 'token']);
  });

  it('demais ações: corpos mínimos', async () => {
    await shipmentLabelService.requestConfirmation('o');
    await shipmentLabelService.generate('o');
    await shipmentLabelService.sync('o');
    await shipmentLabelService.reconcile('o');
    for (const [, body] of api.post.mock.calls) expect(body).toEqual({});
    api.post.mockClear();
    await shipmentLabelService.cancel('o', 'l', 'Motivo do cancelamento');
    await shipmentLabelService.discard('o', 'l', 'Trocar caixa');
    await shipmentLabelService.addNote('o', 'l', 'Conferido');
    expect(api.post.mock.calls.map((c) => c[1])).toEqual([
      { labelId: 'l', reason: 'Motivo do cancelamento' },
      { labelId: 'l', reason: 'Trocar caixa' },
      { labelId: 'l', reason: 'Conferido' },
    ]);
  });

  it('arquivo: GET autenticado do backend com a disposição', async () => {
    await shipmentLabelService.file('o', 'inline');
    expect(api.getBlob).toHaveBeenCalledWith('/api/admin/shipping-labels/orders/o/label/file', { query: { disposition: 'inline' } });
  });
});
