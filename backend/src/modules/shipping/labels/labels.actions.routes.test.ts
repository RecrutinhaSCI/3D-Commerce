/**
 * Rotas de ação das etiquetas (Etapa 4), SEM banco: workflow mockado.
 * Cobre acesso (401/403), validação forte (campos extras recusados),
 * repasse exato dos parâmetros e rate limit por categoria.
 * O fluxo real com Postgres está em labels.actions.routes.db.test.ts.
 */
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import express from 'express';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  user: {
    findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id.startsWith('admin') ? { id: where.id, email: 'a@t.test', role: 'ADMIN' } : { id: where.id, email: 'c@t.test', role: 'CUSTOMER' },
    ),
  },
};
vi.mock('../../../lib/prisma', () => ({ prisma: prismaMock }));

const { createLabelsRouter } = await import('./labels.routes');
const { errorHandler } = await import('../../../middlewares/errorHandler');
const { signAuthToken } = await import('../../../utils/jwt');
const { HttpError } = await import('../../../utils/httpError');

const OVERVIEW = { order: { id: 'ord1' }, config: {}, label: null, availableActions: ['PREPARE'], history: [] };
const RESULT = { label: { id: 'lab1', status: 'LABEL_READY', version: 7 } };
const makeWorkflow = () => ({
  overview: vi.fn(async () => OVERVIEW),
  events: vi.fn(async () => []),
  prepare: vi.fn(async () => ({ ...RESULT, confirmation: { token: 'tok-novo', price: 23.45 } })),
  requestConfirmation: vi.fn(async () => RESULT),
  purchase: vi.fn(async () => RESULT),
  reconcile: vi.fn(async () => RESULT),
  generate: vi.fn(async () => RESULT),
  sync: vi.fn(async () => RESULT),
  checkCancellable: vi.fn(async () => ({ ...RESULT, cancellable: true })),
  cancel: vi.fn(async () => RESULT),
  discard: vi.fn(async () => RESULT),
  addNote: vi.fn(async () => RESULT),
  labelFile: vi.fn(async () => ({ pdf: Buffer.from('%PDF-1.4 teste'), filename: 'etiqueta-TESTE-ord1.pdf' })),
  get: vi.fn(),
});
type Wf = ReturnType<typeof makeWorkflow>;

const servers: http.Server[] = [];
async function start(opts: Parameters<typeof createLabelsRouter>[0] = {}) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api', createLabelsRouter(opts));
  app.use(errorHandler);
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
afterAll(() => servers.forEach((s) => s.close()));

const bearer = (id: string) => ({ Authorization: `Bearer ${signAuthToken({ sub: id, email: 'x@t.test', role: id.startsWith('admin') ? 'ADMIN' : 'CUSTOMER' })}` });
const TOKEN = 'A'.repeat(43);

function caller(base: string) {
  return async (method: string, path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const r = await fetch(`${base}/api/admin/shipping-labels/orders${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as { ok: boolean; data?: any; error?: { code: string; details?: any } } };
  };
}

const ROUTES: Array<[string, string, unknown, keyof Wf]> = [
  ['GET', '/ord1/label', undefined, 'overview'],
  ['GET', '/ord1/label/events', undefined, 'events'],
  ['POST', '/ord1/label/prepare', { package: {}, fiscal: {} }, 'prepare'],
  ['POST', '/ord1/label/confirmation', {}, 'requestConfirmation'],
  ['POST', '/ord1/label/purchase', { labelId: 'lab1', token: TOKEN }, 'purchase'],
  ['POST', '/ord1/label/reconcile', {}, 'reconcile'],
  ['POST', '/ord1/label/generate', {}, 'generate'],
  ['POST', '/ord1/label/sync', {}, 'sync'],
  ['GET', '/ord1/label/cancellable', undefined, 'checkCancellable'],
  ['POST', '/ord1/label/cancel', { labelId: 'lab1', reason: 'Pedido cancelado' }, 'cancel'],
  ['POST', '/ord1/label/discard', { labelId: 'lab1', reason: 'Trocar a caixa' }, 'discard'],
  ['POST', '/ord1/label/notes', { labelId: 'lab1', reason: 'Conferido no painel' }, 'addNote'],
];

describe('acesso e validação', () => {
  let wf: Wf;
  let call: ReturnType<typeof caller>;
  beforeEach(async () => {
    wf = makeWorkflow();
    call = caller(await start({ workflow: wf as never }));
  });

  it.each(ROUTES)('%s %s: sem login 401, cliente 403, admin 200', async (method, path, body, fn) => {
    expect((await call(method, path, {}, body)).status).toBe(401);
    expect((await call(method, path, bearer('cliente-1'), body)).status).toBe(403);
    expect(wf[fn]).not.toHaveBeenCalled();
    const ok = await call(method, path, bearer('admin-1'), body);
    expect(ok.status).toBe(200);
    expect(wf[fn]).toHaveBeenCalled();
  });

  it('orderId inválido → 422 e nada executado', async () => {
    for (const bad of ['a.b', 'x'.repeat(65), "1'or'1"]) {
      expect((await call('POST', `/${encodeURIComponent(bad)}/label/generate`, bearer('admin-1'), {})).status).toBe(422);
    }
    expect(wf.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['price', 1],
    ['paidPrice', 1],
    ['serviceId', 2],
    ['meOrderId', 'abc-123-xyz'],
    ['status', 'PURCHASED'],
    ['payload', { from: {} }],
  ])('compra com "%s" vindo do frontend → 422, compra NÃO chamada', async (field, value) => {
    const r = await call('POST', '/ord1/label/purchase', bearer('admin-1'), { labelId: 'lab1', token: TOKEN, [field]: value });
    expect(r.status).toBe(422);
    expect(wf.purchase).not.toHaveBeenCalled();
  });

  it('compra repassa SÓ pedido, token, admin e etiqueta', async () => {
    await call('POST', '/ord1/label/purchase', bearer('admin-1'), { labelId: 'lab1', token: TOKEN });
    expect(wf.purchase).toHaveBeenCalledWith('ord1', TOKEN, 'admin-1', 'lab1');
  });

  it('compra sem token / token malformado / sem etiqueta → 422', async () => {
    for (const b of [{ labelId: 'lab1' }, { labelId: 'lab1', token: 'curto' }, { labelId: 'lab1', token: `${TOKEN}$` }, { token: TOKEN }]) {
      expect((await call('POST', '/ord1/label/purchase', bearer('admin-1'), b)).status).toBe(422);
    }
    expect(wf.purchase).not.toHaveBeenCalled();
  });

  it('cancelar/descartar/nota exigem motivo; campos extras recusados em todas as ações', async () => {
    for (const p of ['cancel', 'discard', 'notes']) {
      expect((await call('POST', `/ord1/label/${p}`, bearer('admin-1'), { labelId: 'lab1', reason: 'x' })).status).toBe(422);
      expect((await call('POST', `/ord1/label/${p}`, bearer('admin-1'), { labelId: 'lab1' })).status).toBe(422);
    }
    expect((await call('POST', '/ord1/label/prepare', bearer('admin-1'), { package: {}, fiscal: {}, price: 1 })).status).toBe(422);
    expect((await call('POST', '/ord1/label/confirmation', bearer('admin-1'), { price: 1 })).status).toBe(422);
    expect((await call('POST', '/ord1/label/generate', bearer('admin-1'), { status: 'LABEL_READY' })).status).toBe(422);
    expect((await call('POST', '/ord1/label/cancel', bearer('admin-1'), { labelId: 'lab1', reason: 'Pedido cancelado', refund: 99 })).status).toBe(422);
    expect(wf.cancel).not.toHaveBeenCalled();
    expect(wf.discard).not.toHaveBeenCalled();
    expect(wf.addNote).not.toHaveBeenCalled();
  });

  it('resposta = visão do painel + confirmação/erro; o retorno interno do workflow não vaza', async () => {
    const r = await call('POST', '/ord1/label/prepare', bearer('admin-1'), { package: {}, fiscal: {} });
    expect(r.json.data).toEqual({ ...OVERVIEW, confirmation: { token: 'tok-novo', price: 23.45 } });
    const g = await call('POST', '/ord1/label/generate', bearer('admin-1'), {});
    expect(g.json.data).toEqual(OVERVIEW);
    expect(JSON.stringify(g.json)).not.toContain('version');
  });

  it('erro do workflow vira envelope padrão (409 com código)', async () => {
    wf.purchase.mockRejectedValueOnce(new HttpError(409, 'CONFIRMATION_INVALID', 'Confirmação inválida ou já usada.'));
    const r = await call('POST', '/ord1/label/purchase', bearer('admin-1'), { labelId: 'lab1', token: TOKEN });
    expect(r).toMatchObject({ status: 409, json: { ok: false, error: { code: 'CONFIRMATION_INVALID' } } });
  });

  it('sem rota genérica de status (PATCH/PUT/status → 404)', async () => {
    const port = (servers.at(-1)!.address() as AddressInfo).port;
    for (const [method, p] of [['PATCH', '/ord1/label'], ['PUT', '/ord1/label'], ['POST', '/ord1/label/status']]) {
      const r = await fetch(`http://127.0.0.1:${port}/api/admin/shipping-labels/orders${p}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...bearer('admin-1') },
        body: JSON.stringify({ status: 'PURCHASED' }),
      });
      expect(r.status).toBe(404);
    }
  });
});

describe('rate limit', () => {
  it('compra: 5/min POR PEDIDO; outro pedido segue liberado; leitura não é afetada', async () => {
    const wf = makeWorkflow();
    const call = caller(await start({ workflow: wf as never }));
    const buy = (o: string) => call('POST', `/${o}/label/purchase`, bearer('admin-1'), { labelId: 'lab1', token: TOKEN });
    for (let i = 0; i < 5; i++) expect((await buy('ordA')).status).toBe(200);
    const blocked = await buy('ordA');
    expect(blocked.status).toBe(429);
    expect(blocked.json.error!.code).toBe('RATE_LIMITED');
    expect(wf.purchase).toHaveBeenCalledTimes(5);
    expect((await buy('ordB')).status).toBe(200);
    expect((await call('GET', '/ordA/label', bearer('admin-1'))).status).toBe(200);
  });

  it('compra/cancelar/descartar dividem a cota financeira do pedido', async () => {
    const wf = makeWorkflow();
    const call = caller(await start({ workflow: wf as never }));
    const body = { labelId: 'lab1', reason: 'Pedido cancelado' };
    for (let i = 0; i < 3; i++) await call('POST', '/ordA/label/cancel', bearer('admin-1'), body);
    for (let i = 0; i < 2; i++) await call('POST', '/ordA/label/discard', bearer('admin-1'), body);
    expect((await call('POST', '/ordA/label/purchase', bearer('admin-1'), { labelId: 'lab1', token: TOKEN })).status).toBe(429);
  });

  it('contadores por admin e por categoria (consulta ao ME separada da leitura)', async () => {
    const wf = makeWorkflow();
    const call = caller(await start({ workflow: wf as never, limits: { query: { windowMs: 60_000, limit: 2 }, read: { windowMs: 60_000, limit: 3 } } }));
    expect((await call('POST', '/o/label/reconcile', bearer('admin-1'), {})).status).toBe(200);
    expect((await call('POST', '/o/label/sync', bearer('admin-1'), {})).status).toBe(200);
    expect((await call('GET', '/o/label/cancellable', bearer('admin-1'))).status).toBe(429);
    expect((await call('POST', '/o/label/reconcile', bearer('admin-2'), {})).status).toBe(200); // outro admin
    for (let i = 0; i < 3; i++) expect((await call('GET', '/o/label', bearer('admin-1'))).status).toBe(200);
    expect((await call('GET', '/o/label', bearer('admin-1'))).status).toBe(429);
    expect((await call('POST', '/o/label/generate', bearer('admin-1'), {})).status).toBe(200); // escrita: cota própria
  });

  it('não autenticado não consome a cota do admin (auth vem antes)', async () => {
    const wf = makeWorkflow();
    const call = caller(await start({ workflow: wf as never, limits: { financial: { windowMs: 60_000, limit: 1, perOrder: true } } }));
    for (let i = 0; i < 5; i++) await call('POST', '/ordA/label/purchase', {}, { labelId: 'lab1', token: TOKEN });
    expect((await call('POST', '/ordA/label/purchase', bearer('admin-1'), { labelId: 'lab1', token: TOKEN })).status).toBe(200);
  });
});

describe('download da etiqueta (GET …/label/file)', () => {
  let wf: Wf;
  let base: string;
  beforeEach(async () => {
    wf = makeWorkflow();
    base = await start({ workflow: wf as never });
  });
  const get = (qs = '', headers: Record<string, string> = bearer('admin-1')) =>
    fetch(`${base}/api/admin/shipping-labels/orders/ord1/label/file${qs}`, { headers });

  it('sem login 401, cliente 403; nada buscado', async () => {
    expect((await get('', {})).status).toBe(401);
    expect((await get('', bearer('cliente-1'))).status).toBe(403);
    expect(wf.labelFile).not.toHaveBeenCalled();
  });

  it('admin: PDF com no-store, nosniff e disposição pedida (padrão: anexo)', async () => {
    let r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('application/pdf');
    expect(r.headers.get('cache-control')).toContain('no-store');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="etiqueta-TESTE-ord1.pdf"');
    expect(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    r = await get('?disposition=inline');
    expect(r.headers.get('content-disposition')).toMatch(/^inline;/);
    r = await get('?disposition=%22%3E%3Cscript%3E');
    expect(r.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(wf.labelFile).toHaveBeenCalledWith('ord1', 'admin-1');
  });

  it('não gerada / PDF em processamento: JSON de erro padrão, sem PDF', async () => {
    wf.labelFile.mockRejectedValueOnce(new HttpError(409, 'LABEL_NOT_GENERATED', 'Etiqueta ainda sendo gerada.'));
    let r = await get();
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ ok: false, error: { code: 'LABEL_NOT_GENERATED' } });
    wf.labelFile.mockRejectedValueOnce(new HttpError(409, 'LABEL_FILE_NOT_READY', 'PDF em processamento.'));
    r = await get();
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('LABEL_FILE_NOT_READY');
  });

  it('usa a cota de CONSULTA ao ME (cada download revalida lá)', async () => {
    const w = makeWorkflow();
    const b = await start({ workflow: w as never, limits: { query: { windowMs: 60_000, limit: 2 } } });
    const g = () => fetch(`${b}/api/admin/shipping-labels/orders/ord1/label/file`, { headers: bearer('admin-1') });
    expect((await g()).status).toBe(200);
    expect((await g()).status).toBe(200);
    expect((await g()).status).toBe(429);
  });
});
