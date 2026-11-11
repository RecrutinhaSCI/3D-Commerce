import { Prisma, StockMovementSource, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { HttpError } from '../../utils/httpError';
import type { InternalUseInput, MovementsQuery } from './stock.schemas';

/**
 * Ponto ÚNICO de escrita de `Product.stock`.
 *
 * Toda alteração passa por aqui, dentro de uma transação, e grava uma
 * StockMovement com quantidade anterior/posterior reais:
 *  - baixa/entrada relativa: um único UPDATE guardado (`stock >= quantidade`)
 *    com RETURNING. O Postgres reavalia o guard sob lock de linha, então duas
 *    vendas disputando a última unidade nunca passam juntas;
 *  - valor absoluto (edição manual/Excel): compare-and-set sobre o valor lido.
 * A linha do produto fica travada até o COMMIT, o que mantém a sequência de
 * movimentações de cada produto encadeada (after de uma = before da próxima).
 */

type Tx = Prisma.TransactionClient;

export interface StockActor {
  id: string;
  name: string;
}

export const STOCK_TX_OPTIONS = { maxWait: 8_000, timeout: 20_000 } as const;

export class InsufficientStockError extends Error {
  constructor(
    public readonly productId: string,
    public readonly productName: string,
    public readonly requested: number,
    public readonly available: number,
    /** O produto nem existe mais (excluído do catálogo). */
    public readonly productMissing = false,
  ) {
    super('INSUFFICIENT_STOCK');
    this.name = 'InsufficientStockError';
  }
}

/** Erro HTTP padrão para estoque insuficiente (PDV e uso interno). */
export function insufficientStockHttp(e: InsufficientStockError): HttpError {
  return new HttpError(409, 'INSUFFICIENT_STOCK', `Estoque insuficiente para "${e.productName}" (pediu ${e.requested}, disponível ${e.available}).`, {
    productId: e.productId,
    productName: e.productName,
    requested: e.requested,
    available: e.available,
  });
}

export interface MovementMeta {
  type: StockMovementType;
  source: StockMovementSource;
  actor?: StockActor | null;
  note?: string | null;
  orderId?: string | null;
  referenceLabel?: string | null;
  idempotencyKey?: string | null;
}

export interface StockMove {
  productId: string;
  /** Negativo = saída. Zero é ignorado. */
  delta: number;
}

function movementRow(
  product: { id: string; name: string; sku: string | null },
  before: number,
  delta: number,
  meta: MovementMeta,
): Prisma.StockMovementCreateManyInput {
  return {
    productId: product.id,
    productName: product.name,
    productSku: product.sku,
    type: meta.type,
    source: meta.source,
    quantityBefore: before,
    quantityDelta: delta,
    quantityAfter: before + delta,
    userId: meta.actor?.id ?? null,
    userName: meta.actor?.name ?? null,
    note: meta.note ?? null,
    orderId: meta.orderId ?? null,
    referenceLabel: meta.referenceLabel ?? null,
    idempotencyKey: meta.idempotencyKey ?? null,
  };
}

/** Soma deltas do mesmo produto e ordena por id (ordem fixa de lock evita deadlock). */
function normalizeMoves(moves: StockMove[]): StockMove[] {
  const byProduct = new Map<string, number>();
  for (const m of moves) byProduct.set(m.productId, (byProduct.get(m.productId) ?? 0) + m.delta);
  return [...byProduct.entries()]
    .filter(([, delta]) => delta !== 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([productId, delta]) => ({ productId, delta }));
}

/**
 * Aplica entradas/saídas relativas e registra as movimentações. Lança
 * InsufficientStockError se alguma saída não couber: como roda dentro da
 * transação do chamador, TUDO é revertido.
 *
 * `missingProduct: 'skip'` é para reposições: produto excluído do catálogo
 * depois da venda não tem para onde voltar (mesma regra histórica dos pedidos).
 */
export async function applyStockMoves(
  tx: Tx,
  moves: StockMove[],
  meta: MovementMeta,
  opts: { missingProduct?: 'throw' | 'skip' } = {},
): Promise<void> {
  const rows: Prisma.StockMovementCreateManyInput[] = [];
  for (const { productId, delta } of normalizeMoves(moves)) {
    const updated = await tx.product.updateManyAndReturn({
      where: { id: productId, ...(delta < 0 ? { stock: { gte: -delta } } : {}) },
      data: {
        stock: delta < 0 ? { decrement: -delta } : { increment: delta },
        stockUpdatedAt: new Date(),
      },
      select: { id: true, name: true, sku: true, stock: true },
    });
    if (updated.length === 0) {
      const current = await tx.product.findUnique({ where: { id: productId }, select: { name: true, stock: true } });
      if (!current && opts.missingProduct === 'skip') continue;
      throw new InsufficientStockError(productId, current?.name ?? 'Produto removido', -delta, current?.stock ?? 0, !current);
    }
    const product = updated[0];
    rows.push(movementRow(product, product.stock - delta, delta, meta));
  }
  if (rows.length) await tx.stockMovement.createMany({ data: rows });
}

const MAX_CAS_ATTEMPTS = 6;

/**
 * Define o estoque para um valor absoluto (edição manual, Excel).
 * `expected` (o valor que o admin viu) recusa a gravação com 409 se o estoque
 * mudou nesse meio-tempo: assim um formulário aberto antes de uma venda não
 * ressuscita as unidades vendidas. Retorna se houve mudança.
 */
export async function setStockAbsolute(
  tx: Tx,
  productId: string,
  target: number,
  meta: MovementMeta,
  expected?: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const current = await tx.product.findUnique({
      where: { id: productId },
      select: { id: true, name: true, sku: true, stock: true },
    });
    if (!current) throw HttpError.notFound('Produto não encontrado.');
    if (expected !== undefined && current.stock !== expected) {
      throw new HttpError(
        409,
        'STOCK_CHANGED',
        `O estoque deste produto mudou para ${current.stock} enquanto você editava. Confira e salve de novo.`,
        { currentStock: current.stock },
      );
    }
    if (current.stock === target) return false;
    const cas = await tx.product.updateMany({
      where: { id: productId, stock: current.stock },
      data: { stock: target, stockUpdatedAt: new Date() },
    });
    if (cas.count === 1) {
      await tx.stockMovement.create({ data: movementRow(current, current.stock, target - current.stock, meta) });
      return true;
    }
  }
  throw HttpError.conflict('O estoque está sendo alterado por outra operação. Tente de novo.');
}

/** Registra o estoque inicial de um produto recém-criado (mesma transação do create). */
export async function recordInitialStock(
  tx: Tx,
  product: { id: string; name: string; sku: string | null },
  stock: number,
  meta: MovementMeta,
): Promise<void> {
  if (stock <= 0) return;
  await tx.stockMovement.create({ data: movementRow(product, 0, stock, meta) });
}

/** Registra a baixa total de produtos que serão excluídos fisicamente. */
export async function recordProductsDeleted(
  tx: Tx,
  products: Array<{ id: string; name: string; sku: string | null; stock: number }>,
  actor?: StockActor | null,
): Promise<void> {
  const rows = products
    .filter((p) => p.stock > 0)
    .map((p) =>
      movementRow(p, p.stock, -p.stock, {
        type: StockMovementType.CORRECTION,
        source: StockMovementSource.ADMIN,
        actor,
        note: 'Produto excluído do catálogo',
      }),
    );
  if (rows.length) await tx.stockMovement.createMany({ data: rows });
}

export type StockMovementDTO = ReturnType<typeof toMovementDTO>;

function toMovementDTO(m: {
  id: string; seq: number; productId: string; productName: string; productSku: string | null;
  type: StockMovementType; source: StockMovementSource; quantityBefore: number; quantityDelta: number;
  quantityAfter: number; userName: string | null; note: string | null; orderId: string | null;
  referenceLabel: string | null; createdAt: Date; order?: { publicCode: string } | null;
}) {
  return {
    id: m.id,
    seq: m.seq,
    productId: m.productId,
    productName: m.productName,
    productSku: m.productSku,
    type: m.type,
    source: m.source,
    quantityBefore: m.quantityBefore,
    quantityDelta: m.quantityDelta,
    quantityAfter: m.quantityAfter,
    userName: m.userName,
    note: m.note,
    orderId: m.orderId,
    referenceLabel: m.order?.publicCode ? `Pedido ${m.order.publicCode}` : m.referenceLabel,
    createdAt: m.createdAt.toISOString(),
  };
}

export const stockService = {
  /** Uso interno: saída própria de estoque, nunca uma venda. */
  async registerInternalUse(input: InternalUseInput, actor: StockActor) {
    const existing = await prisma.stockMovement.findUnique({ where: { idempotencyKey: input.clientRequestId } });
    if (existing) return { movement: toMovementDTO(existing), idempotent: true };
    try {
      await prisma.$transaction(
        (tx) =>
          applyStockMoves(tx, [{ productId: input.productId, delta: -input.quantity }], {
            type: StockMovementType.INTERNAL_USE,
            source: StockMovementSource.POS,
            actor,
            note: input.note ?? null,
            referenceLabel: 'Uso interno',
            idempotencyKey: input.clientRequestId,
          }),
        STOCK_TX_OPTIONS,
      );
    } catch (e) {
      if (e instanceof InsufficientStockError) {
        if (e.productMissing) throw HttpError.notFound('Produto não encontrado.');
        throw insufficientStockHttp(e);
      }
      // Duas requisições iguais em voo: a segunda bate no índice único.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    const saved = await prisma.stockMovement.findUniqueOrThrow({ where: { idempotencyKey: input.clientRequestId } });
    return { movement: toMovementDTO(saved), idempotent: false };
  },

  async listMovements(query: MovementsQuery) {
    const where: Prisma.StockMovementWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (query.type) where.type = query.type;
    if (query.search) {
      where.OR = [
        { productName: { contains: query.search, mode: 'insensitive' } },
        { productSku: { contains: query.search, mode: 'insensitive' } },
        { referenceLabel: { contains: query.search, mode: 'insensitive' } },
        { order: { publicCode: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    if (query.from || query.to) {
      where.createdAt = { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) };
    }
    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({ where, include: { order: { select: { publicCode: true } } }, orderBy: { seq: 'desc' }, skip, take: query.limit }),
    ]);
    return {
      movements: rows.map(toMovementDTO),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
    };
  },
};
