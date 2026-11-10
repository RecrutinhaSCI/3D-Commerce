import {
  CashSessionStatus,
  PosPaymentMethod,
  PosSaleStatus,
  Prisma,
  StockMovementSource,
  StockMovementType,
  type PosReturn,
  type PosSale,
  type PosSaleItem,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { decimalToNumber } from '../../utils/decimal';
import { HttpError } from '../../utils/httpError';
import { effectivePrice } from '../cart/cart.service';
import {
  applyStockMoves,
  InsufficientStockError,
  insufficientStockHttp,
  type StockActor,
} from '../stock/stock.service';
import { buildSessionReport, type OpeningStockEntry, type SessionReport } from './pos.report';
import type {
  CloseSessionInput,
  CreateReturnInput,
  CreateSaleInput,
  OpenSessionInput,
  ProductSearchQuery,
  SessionsQuery,
} from './pos.schemas';

type Tx = Prisma.TransactionClient;

const POS_TX = { maxWait: 10_000, timeout: 30_000 } as const;

const toCents = (v: Prisma.Decimal | number) => Math.round(Number(v) * 100);
const fromCents = (c: number) => new Prisma.Decimal(c).div(100);
const num = (v: Prisma.Decimal | null | undefined) => decimalToNumber(v ?? null) ?? 0;
export const saleLabel = (number: number) => `PDV-${number}`;

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * Trava a tabela de produtos contra escrita pelo instante da leitura.
 *
 * SHARE espera os escritores em andamento terminarem e segura os próximos: sob
 * ela, "estoque atual" e "última seq" descrevem exatamente o mesmo ponto no
 * tempo. Toda baixa atualiza o produto ANTES de gravar a movimentação, então
 * nenhuma venda em voo cai no lado errado da fronteira do caixa.
 */
async function lockStockForSnapshot(tx: Tx) {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
  await tx.$executeRawUnsafe('LOCK TABLE products IN SHARE MODE');
}

async function lastMovementSeq(tx: Tx): Promise<number> {
  const row = await tx.stockMovement.aggregate({ _max: { seq: true } });
  return row._max.seq ?? 0;
}

function toSessionSummary(s: {
  id: string; number: number; status: CashSessionStatus; openedAt: Date; openedByName: string; openedById: string | null;
  openingCash: Prisma.Decimal; openingNote: string | null; closedAt: Date | null; closedByName: string | null;
  salesCount: number; totalSold: Prisma.Decimal;
}) {
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    openedAt: s.openedAt.toISOString(),
    openedByName: s.openedByName,
    openedById: s.openedById,
    openingCash: num(s.openingCash),
    openingNote: s.openingNote,
    closedAt: s.closedAt?.toISOString() ?? null,
    closedByName: s.closedByName,
    salesCount: s.salesCount,
    totalSold: num(s.totalSold),
  };
}

function toSaleDTO(sale: PosSale & { items: PosSaleItem[]; returns?: PosReturn[] }) {
  return {
    id: sale.id,
    number: sale.number,
    label: saleLabel(sale.number),
    cashSessionId: sale.cashSessionId,
    customerId: sale.customerId,
    customerName: sale.customerName,
    operatorName: sale.operatorName,
    subtotal: num(sale.subtotal),
    discount: num(sale.discount),
    total: num(sale.total),
    paymentMethod: sale.paymentMethod,
    amountReceived: sale.amountReceived === null ? null : num(sale.amountReceived),
    changeAmount: sale.changeAmount === null ? null : num(sale.changeAmount),
    notes: sale.notes,
    status: sale.status,
    canceledAt: sale.canceledAt?.toISOString() ?? null,
    canceledByName: sale.canceledByName,
    cancelReason: sale.cancelReason,
    createdAt: sale.createdAt.toISOString(),
    items: [...sale.items].sort((a, b) => a.position - b.position).map((i) => ({
      id: i.id,
      productId: i.productId,
      isFreeItem: i.isFreeItem,
      description: i.description,
      sku: i.productSku,
      quantity: i.quantity,
      unitPrice: num(i.unitPrice),
      total: num(i.total),
      netTotal: num(i.netTotal),
      returnedQuantity: i.returnedQuantity,
    })),
    refundedTotal: (sale.returns ?? []).reduce((acc, r) => acc + num(r.refundAmount), 0),
  };
}

const saleInclude = { items: true, returns: true } as const;

/** Rateio do desconto em centavos, proporcional; a sobra fica no último item. */
export function allocateDiscount(totals: number[], discountCents: number): number[] {
  const subtotal = totals.reduce((a, b) => a + b, 0);
  if (subtotal === 0 || discountCents === 0) return totals.map(() => 0);
  let remaining = discountCents;
  return totals.map((t, i) => {
    if (i === totals.length - 1) return remaining;
    const share = Math.floor((t * discountCents) / subtotal);
    remaining -= share;
    return share;
  });
}

/** Reserva o caixa aberto do operador; a trava de linha segura o fechamento até o COMMIT. */
async function lockOperatorSession(tx: Tx, operatorId: string): Promise<string> {
  const locked = await tx.cashSession.updateManyAndReturn({
    where: { openOperatorId: operatorId, status: CashSessionStatus.OPEN },
    data: { updatedAt: new Date() },
    select: { id: true },
  });
  if (locked.length === 0) throw new HttpError(409, 'NO_OPEN_SESSION', 'Abra o caixa antes de continuar.');
  return locked[0].id;
}

async function loadReportData(db: Tx | typeof prisma, sessionId: string, fromSeq: number, toSeq: number) {
  const [movements, sales, returns] = await Promise.all([
    db.stockMovement.findMany({ where: { seq: { gt: fromSeq, lte: toSeq } }, orderBy: { seq: 'asc' } }),
    db.posSale.findMany({ where: { cashSessionId: sessionId }, include: { items: true }, orderBy: { number: 'asc' } }),
    db.posReturn.findMany({ where: { cashSessionId: sessionId }, include: { sale: { select: { number: true } } }, orderBy: { number: 'asc' } }),
  ]);
  return {
    movements,
    sales: sales.map((s) => ({
      id: s.id,
      number: s.number,
      createdAt: s.createdAt,
      status: s.status,
      subtotalCents: toCents(s.subtotal),
      discountCents: toCents(s.discount),
      totalCents: toCents(s.total),
      paymentMethod: s.paymentMethod,
      customerName: s.customerName,
      operatorName: s.operatorName,
      items: s.items.map((i) => ({ isFreeItem: i.isFreeItem, quantity: i.quantity, totalCents: toCents(i.total) })),
    })),
    returns: returns.map((r) => ({
      id: r.id,
      number: r.number,
      saleNumber: r.sale.number,
      createdAt: r.createdAt,
      refundCents: toCents(r.refundAmount),
      refundMethod: r.refundMethod,
      reason: r.reason,
      operatorName: r.operatorName,
    })),
  };
}

type SessionForReport = {
  id: string; number: number; status: CashSessionStatus; openedAt: Date; openedByName: string; openingNote: string | null;
  openingCash: Prisma.Decimal; closedAt: Date | null; closedByName: string | null; closingNote: string | null;
  countedCash: Prisma.Decimal | null; openingStockJson: Prisma.JsonValue;
};

function reportSession(s: SessionForReport) {
  return {
    id: s.id,
    number: s.number,
    status: s.status,
    openedAt: s.openedAt,
    openedByName: s.openedByName,
    openingNote: s.openingNote,
    openingCashCents: toCents(s.openingCash),
    closedAt: s.closedAt,
    closedByName: s.closedByName,
    closingNote: s.closingNote,
    countedCashCents: s.countedCash === null ? null : toCents(s.countedCash),
  };
}

export const posService = {
  async currentSession(operatorId: string) {
    const session = await prisma.cashSession.findUnique({ where: { openOperatorId: operatorId } });
    return session ? toSessionSummary(session) : null;
  },

  async openSession(input: OpenSessionInput, actor: StockActor) {
    try {
      const session = await prisma.$transaction(async (tx) => {
        await lockStockForSnapshot(tx);
        const products = await tx.product.findMany({ select: { id: true, name: true, sku: true, stock: true } });
        const openingStock: OpeningStockEntry[] = products.map((p) => ({ productId: p.id, name: p.name, sku: p.sku, stock: p.stock }));
        const openingMovementSeq = await lastMovementSeq(tx);
        return tx.cashSession.create({
          data: {
            openOperatorId: actor.id,
            openedById: actor.id,
            openedByName: actor.name,
            openingCash: fromCents(toCents(input.openingCash)),
            openingNote: input.note ?? null,
            openingMovementSeq,
            openingStockJson: openingStock as unknown as Prisma.InputJsonValue,
          },
        });
      }, POS_TX);
      return toSessionSummary(session);
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, 'SESSION_ALREADY_OPEN', 'Você já tem um caixa aberto. Feche-o antes de abrir outro.');
      throw e;
    }
  },

  async closeSession(sessionId: string, input: CloseSessionInput, actor: StockActor) {
    return prisma.$transaction(async (tx) => {
      // Primeiro o caixa (espera as vendas em voo; novas passam a receber 409),
      // depois o estoque: mesma ordem de lock das vendas, sem deadlock.
      const claimed = await tx.cashSession.updateManyAndReturn({
        where: { id: sessionId, status: CashSessionStatus.OPEN },
        data: {
          status: CashSessionStatus.CLOSED,
          openOperatorId: null,
          closedById: actor.id,
          closedByName: actor.name,
          closedAt: new Date(),
          closingNote: input.note ?? null,
          countedCash: input.countedCash === undefined || input.countedCash === null ? null : fromCents(toCents(input.countedCash)),
        },
      });
      if (claimed.length === 0) {
        const exists = await tx.cashSession.findUnique({ where: { id: sessionId }, select: { id: true } });
        if (!exists) throw HttpError.notFound('Caixa não encontrado.');
        throw new HttpError(409, 'SESSION_ALREADY_CLOSED', 'Este caixa já foi fechado.');
      }
      const session = claimed[0];

      await lockStockForSnapshot(tx);
      const closingMovementSeq = await lastMovementSeq(tx);
      const products = await tx.product.findMany({ select: { id: true, stock: true } });
      const data = await loadReportData(tx, session.id, session.openingMovementSeq, closingMovementSeq);

      const report = buildSessionReport({
        session: reportSession(session),
        openingStock: session.openingStockJson as unknown as OpeningStockEntry[],
        currentStock: new Map(products.map((p) => [p.id, p.stock])),
        ...data,
      });

      const saved = await tx.cashSession.update({
        where: { id: session.id },
        data: {
          closingMovementSeq,
          salesCount: report.summary.salesCount,
          totalSold: new Prisma.Decimal(report.summary.totalSold),
          reportJson: report as unknown as Prisma.InputJsonValue,
        },
      });
      return { session: toSessionSummary(saved), report };
    }, POS_TX);
  },

  async listSessions(query: SessionsQuery) {
    const skip = (query.page - 1) * query.limit;
    const [total, rows] = await Promise.all([
      prisma.cashSession.count(),
      prisma.cashSession.findMany({
        orderBy: { number: 'desc' },
        skip,
        take: query.limit,
        select: {
          id: true, number: true, status: true, openedAt: true, openedByName: true, openedById: true, openingCash: true,
          openingNote: true, closedAt: true, closedByName: true, salesCount: true, totalSold: true,
        },
      }),
    ]);
    return {
      sessions: rows.map(toSessionSummary),
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit)) },
    };
  },

  /** Fechado: relatório congelado. Aberto: prévia ao vivo com a mesma regra. */
  async getSession(sessionId: string): Promise<{ session: ReturnType<typeof toSessionSummary>; report: SessionReport; live: boolean }> {
    const session = await prisma.cashSession.findUnique({ where: { id: sessionId } });
    if (!session) throw HttpError.notFound('Caixa não encontrado.');
    if (session.status === CashSessionStatus.CLOSED && session.reportJson) {
      return { session: toSessionSummary(session), report: session.reportJson as unknown as SessionReport, live: false };
    }
    const toSeq = await lastMovementSeq(prisma as unknown as Tx);
    const [data, products] = await Promise.all([
      loadReportData(prisma, session.id, session.openingMovementSeq, toSeq),
      prisma.product.findMany({ select: { id: true, stock: true } }),
    ]);
    const report = buildSessionReport({
      session: reportSession(session),
      openingStock: session.openingStockJson as unknown as OpeningStockEntry[],
      currentStock: new Map(products.map((p) => [p.id, p.stock])),
      ...data,
    });
    return { session: toSessionSummary(session), report, live: true };
  },

  // ------------------------------- Produtos -------------------------------
  async searchProducts(query: ProductSearchQuery) {
    const and: Prisma.ProductWhereInput[] = [];
    for (const term of (query.q ?? '').split(/\s+/).filter(Boolean).slice(0, 6)) {
      and.push({
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { sku: { contains: term, mode: 'insensitive' } },
          { barcode: { contains: term, mode: 'insensitive' } },
          { brand: { contains: term, mode: 'insensitive' } },
          { material: { contains: term, mode: 'insensitive' } },
          { color: { contains: term, mode: 'insensitive' } },
          { category: { name: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.category) and.push({ category: { name: { contains: query.category, mode: 'insensitive' } } });
    if (query.brand) and.push({ brand: { contains: query.brand, mode: 'insensitive' } });
    if (query.material) and.push({ material: { contains: query.material, mode: 'insensitive' } });

    const rows = await prisma.product.findMany({
      where: { AND: and },
      include: { category: { select: { name: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      take: query.limit,
    });
    return { products: rows.map(toPosProduct) };
  },

  /** Busca EXATA do leitor: código de barras primeiro, depois SKU. */
  async lookupProduct(code: string) {
    const row = await prisma.product.findFirst({
      where: { OR: [{ barcode: code }, { sku: { equals: code, mode: 'insensitive' } }] },
      include: { category: { select: { name: true } } },
      orderBy: { barcode: { sort: 'desc', nulls: 'last' } },
    });
    return { product: row ? toPosProduct(row) : null };
  },

  // -------------------------------- Venda ---------------------------------
  async createSale(input: CreateSaleInput, actor: StockActor) {
    const previous = await prisma.posSale.findUnique({ where: { idempotencyKey: input.clientRequestId }, include: saleInclude });
    if (previous) return { sale: toSaleDTO(previous), idempotent: true };

    try {
      const sale = await prisma.$transaction(async (tx) => {
        const cashSessionId = await lockOperatorSession(tx, actor.id);

        const customer = input.customerId
          ? await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true, name: true } })
          : null;
        if (input.customerId && !customer) throw HttpError.badRequest('Cliente não encontrado.');

        // Quantidades do mesmo produto somadas numa linha só.
        const productQty = new Map<string, number>();
        for (const it of input.items) if (it.type === 'product') productQty.set(it.productId, (productQty.get(it.productId) ?? 0) + it.quantity);
        const products = await tx.product.findMany({ where: { id: { in: [...productQty.keys()] } } });
        const byId = new Map(products.map((p) => [p.id, p]));
        for (const id of productQty.keys()) if (!byId.has(id)) throw HttpError.badRequest('Um dos produtos não existe mais. Atualize a venda.');

        // Preço SEMPRE do banco; do cliente só vem o valor do item livre.
        const seen = new Set<string>();
        type Line = { productId: string | null; isFreeItem: boolean; description: string; productSku: string | null; quantity: number; unitCents: number };
        const lines = input.items.flatMap((it): Line[] => {
          if (it.type === 'free') {
            return [{ productId: null, isFreeItem: true, description: it.description, productSku: null, quantity: it.quantity, unitCents: Math.round(it.unitPrice * 100) }];
          }
          if (seen.has(it.productId)) return [];
          seen.add(it.productId);
          const p = byId.get(it.productId)!;
          return [{ productId: p.id, isFreeItem: false, description: p.name, productSku: p.sku, quantity: productQty.get(p.id)!, unitCents: toCents(effectivePrice(p)) }];
        });

        const totals = lines.map((l) => l.unitCents * l.quantity);
        const subtotalCents = totals.reduce((a, b) => a + b, 0);
        const discountCents = Math.round(input.discount * 100);
        if (discountCents > subtotalCents) throw HttpError.badRequest('O desconto não pode ser maior que o subtotal.');
        const totalCents = subtotalCents - discountCents;

        if (input.expectedTotal !== undefined && Math.round(input.expectedTotal * 100) !== totalCents) {
          throw new HttpError(409, 'TOTAL_CHANGED', 'O preço de algum item mudou. Confira o total e tente de novo.', { total: totalCents / 100 });
        }

        let amountReceived: Prisma.Decimal | null = null;
        let changeAmount: Prisma.Decimal | null = null;
        if (input.paymentMethod === PosPaymentMethod.CASH && input.amountReceived !== undefined && input.amountReceived !== null) {
          const receivedCents = Math.round(input.amountReceived * 100);
          if (receivedCents < totalCents) throw HttpError.badRequest('Valor recebido menor que o total da venda.');
          amountReceived = fromCents(receivedCents);
          changeAmount = fromCents(receivedCents - totalCents);
        }

        const shares = allocateDiscount(totals, discountCents);
        const created = await tx.posSale.create({
          data: {
            idempotencyKey: input.clientRequestId,
            cashSessionId,
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            operatorId: actor.id,
            operatorName: actor.name,
            subtotal: fromCents(subtotalCents),
            discount: fromCents(discountCents),
            total: fromCents(totalCents),
            paymentMethod: input.paymentMethod,
            amountReceived,
            changeAmount,
            notes: input.notes ?? null,
            items: {
              create: lines.map((l, i) => ({
                productId: l.productId,
                isFreeItem: l.isFreeItem,
                description: l.description,
                productSku: l.productSku,
                quantity: l.quantity,
                unitPrice: fromCents(l.unitCents),
                total: fromCents(totals[i]),
                netTotal: fromCents(totals[i] - shares[i]),
                position: i,
              })),
            },
          },
          include: saleInclude,
        });

        // Item livre não entra aqui: não tem efeito no estoque.
        await applyStockMoves(
          tx,
          [...productQty.entries()].map(([productId, qty]) => ({ productId, delta: -qty })),
          {
            type: StockMovementType.POS_SALE,
            source: StockMovementSource.POS,
            actor,
            referenceLabel: `Venda #${saleLabel(created.number)}`,
          },
        );
        return created;
      }, POS_TX);
      return { sale: toSaleDTO(sale), idempotent: false };
    } catch (e) {
      if (e instanceof InsufficientStockError) throw insufficientStockHttp(e);
      if (isUniqueViolation(e)) {
        // Duas requisições iguais em voo: a outra venceu, devolve a mesma venda.
        const winner = await prisma.posSale.findUnique({ where: { idempotencyKey: input.clientRequestId }, include: saleInclude });
        if (winner) return { sale: toSaleDTO(winner), idempotent: true };
      }
      throw e;
    }
  },

  async getSale(id: string) {
    const sale = await prisma.posSale.findUnique({ where: { id }, include: saleInclude });
    if (!sale) throw HttpError.notFound('Venda não encontrada.');
    return { sale: toSaleDTO(sale) };
  },

  /** Cancelamento: só no caixa ainda aberto. Depois do fechamento, use devolução. */
  async cancelSale(id: string, reason: string, actor: StockActor) {
    const sale = await prisma.$transaction(async (tx) => {
      const current = await tx.posSale.findUnique({ where: { id }, select: { cashSessionId: true, number: true } });
      if (!current) throw HttpError.notFound('Venda não encontrada.');

      const lock = await tx.cashSession.updateMany({
        where: { id: current.cashSessionId, status: CashSessionStatus.OPEN },
        data: { updatedAt: new Date() },
      });
      if (lock.count === 0) {
        throw new HttpError(409, 'SESSION_CLOSED', 'O caixa desta venda já foi fechado. Use a devolução.');
      }

      // Guard atômico: só uma requisição passa de COMPLETED para CANCELED.
      const claim = await tx.posSale.updateMany({
        where: { id, status: PosSaleStatus.COMPLETED },
        data: { status: PosSaleStatus.CANCELED, canceledAt: new Date(), canceledById: actor.id, canceledByName: actor.name, cancelReason: reason },
      });
      if (claim.count === 0) throw new HttpError(409, 'ALREADY_CANCELED', 'Esta venda já foi cancelada.');

      const items = await tx.posSaleItem.findMany({ where: { saleId: id } });
      if (items.some((i) => i.returnedQuantity > 0)) {
        throw new HttpError(409, 'HAS_RETURNS', 'Esta venda tem devolução registrada. Devolva os itens restantes em vez de cancelar.');
      }

      await applyStockMoves(
        tx,
        items.flatMap((i) => (i.productId ? [{ productId: i.productId, delta: i.quantity }] : [])),
        {
          type: StockMovementType.CANCELLATION,
          source: StockMovementSource.POS,
          actor,
          note: reason,
          referenceLabel: `Venda #${saleLabel(current.number)}`,
        },
        { missingProduct: 'skip' },
      );
      return tx.posSale.findUniqueOrThrow({ where: { id }, include: saleInclude });
    }, POS_TX);
    return { sale: toSaleDTO(sale) };
  },

  async createReturn(saleId: string, input: CreateReturnInput, actor: StockActor) {
    const include = { items: true, sale: { select: { number: true } } } as const;
    const toDTO = (r: PosReturn & { sale: { number: number } }) => ({
      id: r.id,
      number: r.number,
      saleId: r.saleId,
      saleNumber: r.sale.number,
      refundAmount: num(r.refundAmount),
      refundMethod: r.refundMethod,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    });

    const previous = await prisma.posReturn.findUnique({ where: { idempotencyKey: input.clientRequestId }, include });
    if (previous) return { return: toDTO(previous), idempotent: true };

    try {
      const created = await prisma.$transaction(async (tx) => {
        const cashSessionId = await lockOperatorSession(tx, actor.id);

        // A trava na venda serializa devoluções e cancelamento da mesma venda.
        const locked = await tx.posSale.updateManyAndReturn({
          where: { id: saleId, status: PosSaleStatus.COMPLETED },
          data: { updatedAt: new Date() },
          select: { id: true, number: true, paymentMethod: true },
        });
        if (locked.length === 0) {
          const exists = await tx.posSale.findUnique({ where: { id: saleId }, select: { id: true } });
          if (!exists) throw HttpError.notFound('Venda não encontrada.');
          throw new HttpError(409, 'ALREADY_CANCELED', 'Venda cancelada não aceita devolução.');
        }
        const sale = locked[0];

        const requested = new Map<string, number>();
        for (const it of input.items) requested.set(it.saleItemId, (requested.get(it.saleItemId) ?? 0) + it.quantity);
        const items = await tx.posSaleItem.findMany({ where: { saleId, id: { in: [...requested.keys()] } } });
        if (items.length !== requested.size) throw HttpError.badRequest('Item não pertence a esta venda.');

        const returnLines = items.map((item) => {
          const qty = requested.get(item.id)!;
          const after = item.returnedQuantity + qty;
          if (after > item.quantity) {
            throw new HttpError(409, 'RETURN_EXCEEDS_SOLD', `"${item.description}": só restam ${item.quantity - item.returnedQuantity} para devolver.`);
          }
          // Cumulativo: devoluções parciais somam exatamente o valor líquido do item.
          const net = toCents(item.netTotal);
          const refundCents = Math.round((net * after) / item.quantity) - Math.round((net * item.returnedQuantity) / item.quantity);
          return { item, qty, refundCents };
        });

        for (const { item, qty } of returnLines) {
          await tx.posSaleItem.update({ where: { id: item.id }, data: { returnedQuantity: { increment: qty } } });
        }

        const refundCents = returnLines.reduce((acc, l) => acc + l.refundCents, 0);
        const saved = await tx.posReturn.create({
          data: {
            idempotencyKey: input.clientRequestId,
            saleId,
            cashSessionId,
            operatorId: actor.id,
            operatorName: actor.name,
            reason: input.reason,
            refundAmount: fromCents(refundCents),
            refundMethod: sale.paymentMethod,
            items: { create: returnLines.map((l) => ({ saleItemId: l.item.id, quantity: l.qty, refundAmount: fromCents(l.refundCents) })) },
          },
          include,
        });

        await applyStockMoves(
          tx,
          returnLines.flatMap((l) => (l.item.productId ? [{ productId: l.item.productId, delta: l.qty }] : [])),
          {
            type: StockMovementType.RETURN,
            source: StockMovementSource.POS,
            actor,
            note: input.reason,
            referenceLabel: `Devolução da venda #${saleLabel(sale.number)}`,
          },
          { missingProduct: 'skip' },
        );
        return saved;
      }, POS_TX);
      return { return: toDTO(created), idempotent: false };
    } catch (e) {
      if (isUniqueViolation(e)) {
        const winner = await prisma.posReturn.findUnique({ where: { idempotencyKey: input.clientRequestId }, include });
        if (winner) return { return: toDTO(winner), idempotent: true };
      }
      throw e;
    }
  },
};

function toPosProduct(p: Prisma.ProductGetPayload<{ include: { category: { select: { name: true } } } }>) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    stock: p.stock,
    price: num(effectivePrice(p)),
    active: p.active,
    brand: p.brand,
    material: p.material,
    color: p.color,
    category: p.category?.name ?? null,
  };
}
