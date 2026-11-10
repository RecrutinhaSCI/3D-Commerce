import type { PosPaymentMethod, StockMovementSource, StockMovementType } from '@prisma/client';

/**
 * Relatório de fechamento: função PURA sobre dados já lidos no banco.
 *
 * Estoque: considera TODAS as origens (loja, PDV, uso interno, ajustes,
 * importação, cancelamento, devolução) com `seq` dentro da janela lógica
 * abertura → fechamento, para valer: inicial + movimentações = final.
 * Financeiro: só as vendas físicas deste caixa; pedido online não entra.
 *
 * O estoque final NÃO é calculado por subtração: vem da leitura real do produto
 * e é conferido contra inicial + movimentações. Qualquer diferença vira
 * `discrepancy`, o sinal de alteração feita por fora do sistema.
 */

export interface ReportMovement {
  seq: number;
  productId: string;
  productName: string;
  productSku: string | null;
  type: StockMovementType;
  source: StockMovementSource;
  quantityBefore: number;
  quantityDelta: number;
  quantityAfter: number;
  userName: string | null;
  note: string | null;
  orderId: string | null;
  referenceLabel: string | null;
  createdAt: Date;
}

export interface OpeningStockEntry {
  productId: string;
  name: string;
  sku: string | null;
  stock: number;
}

export interface ReportSale {
  id: string;
  number: number;
  createdAt: Date;
  status: 'COMPLETED' | 'CANCELED';
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  paymentMethod: PosPaymentMethod;
  customerName: string | null;
  operatorName: string;
  items: Array<{ isFreeItem: boolean; quantity: number; totalCents: number }>;
}

export interface ReportReturn {
  id: string;
  number: number;
  saleNumber: number;
  createdAt: Date;
  refundCents: number;
  refundMethod: PosPaymentMethod;
  reason: string;
  operatorName: string;
}

export interface ReportInput {
  session: {
    id: string;
    number: number;
    status: 'OPEN' | 'CLOSED';
    openedAt: Date;
    openedByName: string;
    openingNote: string | null;
    openingCashCents: number;
    closedAt: Date | null;
    closedByName: string | null;
    closingNote: string | null;
    countedCashCents: number | null;
  };
  openingStock: OpeningStockEntry[];
  movements: ReportMovement[];
  /** Estoque real lido no fechamento, por produto. */
  currentStock: Map<string, number>;
  sales: ReportSale[];
  returns: ReportReturn[];
}

const PAYMENT_METHODS: PosPaymentMethod[] = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'];
const toMoney = (cents: number) => Number((cents / 100).toFixed(2));

const emptyBuckets = () => ({ ecommerce: 0, pos: 0, internalUse: 0, adjustments: 0, imports: 0, cancellations: 0, returns: 0 });
type Bucket = keyof ReturnType<typeof emptyBuckets>;

function bucket(type: StockMovementType): Bucket {
  switch (type) {
    case 'ECOMMERCE_SALE': return 'ecommerce';
    case 'POS_SALE': return 'pos';
    case 'INTERNAL_USE': return 'internalUse';
    case 'IMPORT': return 'imports';
    case 'CANCELLATION': return 'cancellations';
    case 'RETURN': return 'returns';
    default: return 'adjustments';
  }
}

export function buildSessionReport(input: ReportInput) {
  const { session, openingStock, movements, currentStock, sales, returns } = input;
  const opening = new Map(openingStock.map((e) => [e.productId, e]));

  // ---- Estoque ------------------------------------------------------------
  const grouped = new Map<string, ReportMovement[]>();
  for (const m of [...movements].sort((a, b) => a.seq - b.seq)) {
    const list = grouped.get(m.productId) ?? [];
    list.push(m);
    grouped.set(m.productId, list);
  }

  const products = [...grouped.entries()].map(([productId, list]) => {
    const last = list[list.length - 1];
    const totals = emptyBuckets();
    for (const m of list) totals[bucket(m.type)] += m.quantityDelta;
    // Sem foto na abertura = produto criado depois (começa do primeiro registro).
    const initial = opening.get(productId)?.stock ?? list[0].quantityBefore;
    const net = list.reduce((acc, m) => acc + m.quantityDelta, 0);
    const expectedFinal = initial + net;
    // Produto excluído no período: não há mais linha para ler.
    const final = currentStock.get(productId) ?? last.quantityAfter;
    return {
      productId,
      name: last.productName,
      sku: last.productSku,
      initial,
      ...totals,
      final,
      expectedFinal,
      discrepancy: final - expectedFinal,
      movements: list.map((m) => ({
        seq: m.seq,
        at: m.createdAt.toISOString(),
        type: m.type,
        source: m.source,
        delta: m.quantityDelta,
        before: m.quantityBefore,
        after: m.quantityAfter,
        reference: m.referenceLabel,
        orderId: m.orderId,
        note: m.note,
        userName: m.userName,
      })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  // Mudança de estoque sem registro (ex.: SQL manual) em produto sem movimentação.
  const untracked = openingStock
    .filter((e) => !grouped.has(e.productId) && currentStock.has(e.productId) && currentStock.get(e.productId) !== e.stock)
    .map((e) => ({ productId: e.productId, name: e.name, sku: e.sku, initial: e.stock, final: currentStock.get(e.productId) as number }));

  const stockTotals = emptyBuckets();
  for (const p of products) {
    for (const key of Object.keys(stockTotals) as Bucket[]) stockTotals[key] += p[key];
  }

  // ---- Financeiro (só PDV) ------------------------------------------------
  const completed = sales.filter((s) => s.status === 'COMPLETED');
  const canceled = sales.filter((s) => s.status === 'CANCELED');
  const netCents = completed.reduce((acc, s) => acc + s.totalCents, 0);
  const refundsCents = returns.reduce((acc, r) => acc + r.refundCents, 0);
  const freeItems = completed.flatMap((s) => s.items.filter((i) => i.isFreeItem));

  const payments = PAYMENT_METHODS.map((method) => {
    const ofMethod = completed.filter((s) => s.paymentMethod === method);
    const salesCents = ofMethod.reduce((acc, s) => acc + s.totalCents, 0);
    const methodRefunds = returns.filter((r) => r.refundMethod === method).reduce((acc, r) => acc + r.refundCents, 0);
    return { method, count: ofMethod.length, total: toMoney(salesCents), refunds: toMoney(methodRefunds), net: toMoney(salesCents - methodRefunds) };
  });
  const cash = payments.find((p) => p.method === 'CASH')!;
  const expectedCashCents = session.openingCashCents + Math.round(cash.net * 100);

  return {
    generatedAt: new Date().toISOString(),
    session: {
      id: session.id,
      number: session.number,
      status: session.status,
      openedAt: session.openedAt.toISOString(),
      openedByName: session.openedByName,
      openingNote: session.openingNote,
      closedAt: session.closedAt?.toISOString() ?? null,
      closedByName: session.closedByName,
      closingNote: session.closingNote,
    },
    summary: {
      salesCount: completed.length,
      totalSold: toMoney(netCents),
      subtotal: toMoney(completed.reduce((acc, s) => acc + s.subtotalCents, 0)),
      discounts: toMoney(completed.reduce((acc, s) => acc + s.discountCents, 0)),
      averageTicket: completed.length ? toMoney(Math.round(netCents / completed.length)) : 0,
      itemsSold: completed.reduce((acc, s) => acc + s.items.reduce((q, i) => q + i.quantity, 0), 0),
      freeItemsCount: freeItems.reduce((acc, i) => acc + i.quantity, 0),
      freeItemsTotal: toMoney(freeItems.reduce((acc, i) => acc + i.totalCents, 0)),
      canceledCount: canceled.length,
      canceledTotal: toMoney(canceled.reduce((acc, s) => acc + s.totalCents, 0)),
      refundsCount: returns.length,
      refundsTotal: toMoney(refundsCents),
      netAfterRefunds: toMoney(netCents - refundsCents),
    },
    payments,
    cash: {
      opening: toMoney(session.openingCashCents),
      expected: toMoney(expectedCashCents),
      counted: session.countedCashCents === null ? null : toMoney(session.countedCashCents),
      difference: session.countedCashCents === null ? null : toMoney(session.countedCashCents - expectedCashCents),
    },
    stock: {
      products,
      totals: stockTotals,
      productsMoved: products.length,
      discrepancies: products.filter((p) => p.discrepancy !== 0).length + untracked.length,
      untracked,
    },
    sales: sales.map((s) => ({
      id: s.id,
      number: s.number,
      createdAt: s.createdAt.toISOString(),
      status: s.status,
      total: toMoney(s.totalCents),
      discount: toMoney(s.discountCents),
      paymentMethod: s.paymentMethod,
      customerName: s.customerName,
      operatorName: s.operatorName,
      itemsCount: s.items.reduce((q, i) => q + i.quantity, 0),
    })),
    returns: returns.map((r) => ({
      id: r.id,
      number: r.number,
      saleNumber: r.saleNumber,
      createdAt: r.createdAt.toISOString(),
      refund: toMoney(r.refundCents),
      refundMethod: r.refundMethod,
      reason: r.reason,
      operatorName: r.operatorName,
    })),
  };
}

export type SessionReport = ReturnType<typeof buildSessionReport>;
