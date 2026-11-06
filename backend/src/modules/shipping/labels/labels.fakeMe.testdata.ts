/**
 * Melhor Envio FALSO com estado (só testes): carrinho, compra, geração e
 * cancelamento em memória, contadores por operação e falhas injetáveis.
 * Erros são `LabelApiError` reais, como o cliente de verdade lança.
 */
import { LabelApiError, type LabelApiErrorCode, type LabelErrorOutcome, type LabelOperation } from './labelErrors';
import type { MeLabelsClient, MeOrderInfo } from './meLabelsClient';

type Op = 'add' | 'get' | 'checkout' | 'generate' | 'remove' | 'cancellable' | 'cancel' | 'file';
interface FakeOrder {
  status: string;
  price: number;
  paidAt: string | null;
  generatedAt: string | null;
  canceledAt: string | null;
  tracking: string | null;
  generationRequested?: boolean;
}

export const meError = (operation: LabelOperation, code: LabelApiErrorCode, outcome: LabelErrorOutcome, httpStatus: number | null = null) =>
  new LabelApiError({ operation, code, outcome, message: `falha simulada ${code}`, httpStatus });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FakeMe {
  orders = new Map<string, FakeOrder>();
  calls: Record<Op, number> = { add: 0, get: 0, checkout: 0, generate: 0, remove: 0, cancellable: 0, cancel: 0, file: 0 };
  delay: Record<Op, number> = { add: 0, get: 0, checkout: 0, generate: 0, remove: 0, cancellable: 0, cancel: 0, file: 0 };
  /** Resposta do `cancellable`. */
  canCancel = true;
  /** Preço que o próximo item de carrinho recebe. */
  cartPrice = 23.45;
  /**
   * Geração como no Sandbox REAL (06/11/2026): o `generate` só aceita; o
   * status continua "released" e `generated_at`/rastreio aparecem segundos
   * depois (ver `finishGeneration`). Gerar de novo nesse meio-tempo → 204
   * sem corpo (BAD_RESPONSE no cliente).
   */
  asyncGeneration = false;
  /** Falhas de uma vez: executadas (e removidas) na próxima chamada da operação. */
  private once: Partial<Record<Op, Array<(id?: string) => void>>> = {};
  private seq = 0;

  failNext(op: Op, fn: (id?: string) => void) {
    (this.once[op] ??= []).push(fn);
  }

  private async hook(op: Op, id?: string) {
    this.calls[op]++;
    if (this.delay[op]) await sleep(this.delay[op]);
    const fn = this.once[op]?.shift();
    if (fn) fn(id);
  }

  info(id: string): MeOrderInfo {
    const o = this.orders.get(id)!;
    return {
      id,
      protocol: `ORD-${id.slice(0, 6)}`,
      status: o.status,
      serviceId: 1,
      price: o.price,
      tracking: o.tracking,
      selfTracking: null,
      dates: { createdAt: null, paidAt: o.paidAt, generatedAt: o.generatedAt, postedAt: null, deliveredAt: null, canceledAt: o.canceledAt, expiredAt: null },
    };
  }

  /** Conclui a geração assíncrona (status segue "released", como no Sandbox real). */
  finishGeneration(id: string) {
    Object.assign(this.orders.get(id)!, { generatedAt: '2026-10-27T12:05:00.000Z', tracking: 'AB123456789BR' });
  }

  /** Marca como paga do lado do ME (ex.: checkout que "aconteceu" antes do timeout). */
  markPaid(id: string) {
    Object.assign(this.orders.get(id)!, { status: 'released', paidAt: '2026-10-27T12:00:00.000Z' });
  }

  client(): MeLabelsClient {
    const self = this;
    const c: Partial<MeLabelsClient> = {
      async addToCart() {
        await self.hook('add');
        const id = `${String(++self.seq).padStart(8, '0')}-aaaa-4bbb-8ccc-000000000000`;
        self.orders.set(id, { status: 'pending', price: self.cartPrice, paidAt: null, generatedAt: null, canceledAt: null, tracking: null });
        return { id, protocol: `ORD-${self.seq}`, serviceId: 1, price: self.cartPrice, status: 'pending' };
      },
      async getOrder(id: string) {
        await self.hook('get', id);
        if (!self.orders.has(id)) throw meError('order.get', 'NOT_FOUND', 'rejected', 404);
        return self.info(id);
      },
      async checkout(id: string) {
        await self.hook('checkout', id);
        const o = self.orders.get(id)!;
        if (o.status !== 'pending') throw meError('checkout', 'ALREADY_PAID', 'rejected', 422);
        self.markPaid(id);
        return { purchaseId: `pur-${id.slice(0, 8)}`, protocol: 'PUR-1', status: 'paid', total: o.price, paidAt: o.paidAt, order: { id, status: 'released', price: o.price } };
      },
      async generate(id: string) {
        await self.hook('generate', id);
        const o = self.orders.get(id)!;
        if (self.asyncGeneration) {
          if (o.generationRequested || o.generatedAt) throw meError('generate', 'BAD_RESPONSE', 'unknown', 204);
          o.generationRequested = true;
          return { accepted: true, message: null };
        }
        Object.assign(o, { status: 'generated', generatedAt: '2026-10-27T12:05:00.000Z', tracking: 'AB123456789BR' });
        return { accepted: true, message: null };
      },
      async removeFromCart(id: string) {
        await self.hook('remove', id);
        const o = self.orders.get(id);
        if (!o) throw meError('cart.remove', 'NOT_FOUND', 'rejected', 404);
        if (o.status !== 'pending') throw meError('cart.remove', 'VALIDATION', 'rejected', 422);
        self.orders.delete(id); // some do ME: GET passa a dar 404
      },
      async cancellable(id: string) {
        await self.hook('cancellable', id);
        return { cancellable: self.canCancel };
      },
      async getLabelFile(id: string) {
        await self.hook('file', id);
        return { url: `https://arquivos.melhorenvio.com.br/tmp/${id}.pdf?sig=URL-TEMPORARIA-SECRETA` };
      },
      async downloadLabelPdf() {
        return Buffer.from('%PDF-1.4 etiqueta de teste');
      },
      async cancel(id: string) {
        await self.hook('cancel', id);
        Object.assign(self.orders.get(id)!, { status: 'canceled', canceledAt: '2026-10-27T13:00:00.000Z' });
        return { canceled: true as const };
      },
    };
    return c as MeLabelsClient;
  }
}
