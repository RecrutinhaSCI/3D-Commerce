/**
 * Cliente de etiquetas do Melhor Envio contra uma API FALSA (fetch mockado).
 * Nenhuma chamada real. Cobre sucesso de cada endpoint, 401 com renovação e
 * retry único, reconexão, 403/404/422/429/5xx, timeout, rede, corpo
 * malformado, etiqueta já paga, cancelamento recusado, sanitização, logs sem
 * segredo e as travas de produção.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OAuthTokenError, OAuthUnavailableError } from '../../integrations/melhorEnvioOAuth';
import { createMeLabelsClient, isAllowedLabelFileUrl, MAX_LABEL_FILE_REDIRECTS, type MeLabelsRuntimeConfig } from './meLabelsClient';
import { LabelApiError, sanitizeExternalMessage } from './labelErrors';
import type { MeCartPayload } from './payload';

const ID = '9b7c4a1e-1111-4c2d-8e3f-0123456789ab';
const TOKEN = 'ACCESS-TOKEN-SECRETO-123';
const FRESH = 'ACCESS-TOKEN-RENOVADO-456';
const SANDBOX: MeLabelsRuntimeConfig = {
  enabled: true, allowProduction: false, environment: 'sandbox',
  baseUrl: 'https://sandbox.melhorenvio.com.br', userAgent: '3DCommerce (contato@loja.test)', timeoutMs: 50,
};
const PROD: MeLabelsRuntimeConfig = { ...SANDBOX, environment: 'production', baseUrl: 'https://melhorenvio.com.br' };

type Handler = (req: { method: string; url: string; headers: Record<string, string>; body: unknown }) => Response | Promise<Response>;
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

let handler: Handler;
const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];
const logs: string[] = [];
const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
  const req = {
    method: init?.method ?? 'GET',
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>,
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
  calls.push(req);
  if (init?.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  return handler(req);
}) as unknown as typeof fetch;

const getToken = vi.fn(async () => TOKEN);
const refreshToken = vi.fn(async () => FRESH);
const client = (config: MeLabelsRuntimeConfig = SANDBOX) =>
  createMeLabelsClient({ fetchImpl, config, getToken, refreshToken, log: (l) => logs.push(l) });

beforeEach(() => {
  calls.length = 0;
  logs.length = 0;
  vi.clearAllMocks();
  getToken.mockImplementation(async () => TOKEN);
  refreshToken.mockImplementation(async () => FRESH);
  handler = () => json(500, {});
});

/** Captura o LabelApiError lançado. */
async function caught(p: Promise<unknown>): Promise<LabelApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(LabelApiError);
    return e as LabelApiError;
  }
  throw new Error('deveria ter lançado');
}

const PAYLOAD = { service: 1 } as unknown as MeCartPayload;

describe('sucesso de cada endpoint', () => {
  it('cart.add: POST /api/v2/me/cart com headers da API; devolve o UUID', async () => {
    handler = () => json(201, { id: ID, protocol: 'ORD-2026', service_id: 1, price: '23.45', status: 'pending', extra: 'ignorado' });
    expect(await client().addToCart(PAYLOAD)).toEqual({ id: ID, protocol: 'ORD-2026', serviceId: 1, price: 23.45, status: 'pending' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://sandbox.melhorenvio.com.br/api/v2/me/cart', body: PAYLOAD });
    expect(calls[0].headers).toMatchObject({
      Authorization: `Bearer ${TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': SANDBOX.userAgent,
    });
  });

  it('cart.remove: DELETE /cart/{id} (204)', async () => {
    handler = () => new Response(null, { status: 204 });
    await expect(client().removeFromCart(ID)).resolves.toBeUndefined();
    expect(calls[0]).toMatchObject({ method: 'DELETE', url: `${SANDBOX.baseUrl}/api/v2/me/cart/${ID}`, body: undefined });
  });

  it('order.get: GET /orders/{id} com datas normalizadas', async () => {
    handler = () => json(200, {
      id: ID, protocol: 'ORD-1', status: 'released', service_id: 2, price: 30.1, tracking: 'AB123456789BR', self_tracking: 'ME123',
      created_at: '2026-10-27 10:00:00', paid_at: '2026-10-27 10:05:00', generated_at: null,
    });
    const o = await client().getOrder(ID);
    expect(o).toMatchObject({ id: ID, status: 'released', serviceId: 2, price: 30.1, tracking: 'AB123456789BR', selfTracking: 'ME123' });
    expect(o.dates.paidAt).toMatch(/^2026-10-27T/);
    expect(o.dates.generatedAt).toBeNull();
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${SANDBOX.baseUrl}/api/v2/me/orders/${ID}` });
  });

  // Sandbox real (06/11/2026): datas SEM fuso e em UTC (created_at = hora UTC
  // da requisição). Independe do fuso do servidor (BRT local × UTC no Render).
  it('datas do ME sem fuso são UTC; com fuso explícito, respeita o informado', async () => {
    handler = () => json(200, {
      id: ID, status: 'canceled', created_at: '2026-11-06 20:44:41', paid_at: '2026-11-06T20:44:44',
      generated_at: '2026-11-06 20:44:47-03:00', canceled_at: '2026-11-06T20:44:55Z', posted_at: '2026-11-07',
    });
    const o = await client().getOrder(ID);
    expect(o.dates.createdAt).toBe('2026-11-06T20:44:41.000Z');
    expect(o.dates.paidAt).toBe('2026-11-06T20:44:44.000Z');
    expect(o.dates.generatedAt).toBe('2026-11-06T23:44:47.000Z');
    expect(o.dates.canceledAt).toBe('2026-11-06T20:44:55.000Z');
    expect(o.dates.postedAt).toBe('2026-11-07T00:00:00.000Z');
  });

  // Sandbox real: checkout de etiqueta JÁ paga e generate de etiqueta já em
  // geração respondem 204 sem corpo — nunca "sucesso": ambíguo → reconciliar.
  it.each([['checkout'], ['generate']] as const)('%s com 204 sem corpo → BAD_RESPONSE com reconciliação', async (op) => {
    handler = () => new Response(null, { status: 204 });
    const err = await caught(op === 'checkout' ? client().checkout(ID) : client().generate(ID));
    expect(err).toMatchObject({ code: 'BAD_RESPONSE', outcome: 'unknown', httpStatus: 204 });
    expect(err.toSafeJSON().requiresReconciliation).toBe(true);
  });

  it('order.search: 204 sem corpo (formato real "nenhum resultado") → lista vazia', async () => {
    handler = () => new Response(null, { status: 204 });
    expect(await client().searchOrders('ORD-000000000000')).toEqual([]);
  });

  it('checkout: 422 real "já foram pagas ou inválidas" → ALREADY_PAID (exige reconciliação)', async () => {
    handler = () => json(422, { message: 'Existe uma ou mais orders que já foram pagas ou inválidas.', errors: { orders: ['Existe uma ou mais orders que já foram pagas ou inválidas.'] } });
    const e = await caught(client().checkout(ID));
    expect(e).toMatchObject({ code: 'ALREADY_PAID', outcome: 'rejected' });
    expect(e.toSafeJSON().requiresReconciliation).toBe(true);
  });

  it('generate antes da compra: 200 com status=false "O Envio não está pago" → GENERATION_FAILED', async () => {
    handler = () => json(200, { [ID]: { status: false, message: 'O Envio não está pago' } });
    const e = await caught(client().generate(ID));
    expect(e).toMatchObject({ code: 'GENERATION_FAILED', outcome: 'rejected', externalMessage: 'O Envio não está pago' });
  });

  it('cancel: formato real { key, [id]: { canceled, status } }', async () => {
    handler = () => json(200, { key: '11111111-2222-4333-8444-555555555555', [ID]: { canceled: true, status: 'pending' } });
    expect(await client().cancel(ID, 'motivo')).toEqual({ canceled: true });
  });

  it('order.search: aceita lista ou { data: [] }; descarta itens inválidos', async () => {
    handler = () => json(200, [{ id: ID, status: 'paid' }, { id: '../hack' }, 'lixo']);
    expect((await client().searchOrders('ORD-1')).map((o) => o.id)).toEqual([ID]);
    expect(calls[0].url).toBe(`${SANDBOX.baseUrl}/api/v2/me/orders/search?q=ORD-1`);
    handler = () => json(200, { data: [{ id: ID, status: 'released' }] });
    expect(await client().searchOrders(ID)).toHaveLength(1);
  });

  it('checkout: POST { orders: [id] }; devolve a compra e a NOSSA etiqueta', async () => {
    handler = () => json(200, {
      purchase: { id: 'pur-123456', protocol: 'PUR-1', total: 23.45, status: 'paid', paid_at: '2026-10-27 10:05:00', orders: [{ id: ID, status: 'released', price: 23.45 }] },
    });
    const r = await client().checkout(ID);
    expect(r).toMatchObject({ purchaseId: 'pur-123456', status: 'paid', total: 23.45, order: { id: ID, status: 'released', price: 23.45 } });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `${SANDBOX.baseUrl}/api/v2/me/shipment/checkout`, body: { orders: [ID] } });
  });

  it('generate: { id: { status: true } }', async () => {
    handler = () => json(200, { [ID]: { status: true, message: 'Envio gerado com sucesso' } });
    expect(await client().generate(ID)).toEqual({ accepted: true, message: 'Envio gerado com sucesso' });
    expect(calls[0].body).toEqual({ orders: [ID] });
  });

  it('print: SEMPRE modo privado; só URL https', async () => {
    handler = () => json(200, { url: 'https://melhorenvio.com.br/imprimir/abc' });
    expect(await client().print(ID)).toEqual({ url: 'https://melhorenvio.com.br/imprimir/abc' });
    expect(calls[0].body).toEqual({ mode: 'private', orders: [ID] });
  });

  // Formato REAL (Sandbox, 06/11/2026, PAC e Sedex): lista com URL pré-assinada do S3.
  it('print.file: resposta em LISTA (formato real) → primeira URL https; lista vazia/http → BAD_RESPONSE', async () => {
    const real = 'https://me-0047-sandbox.s3.amazonaws.com/pdf/abc.pdf?X-Amz-Expires=1800&X-Amz-Signature=x';
    handler = () => json(200, [real]);
    expect((await client().getLabelFile(ID)).url).toBe(real);
    for (const body of [[], ['http://inseguro.test/a.pdf'], [42]]) {
      handler = () => json(200, body);
      expect((await caught(client().getLabelFile(ID))).code).toBe('BAD_RESPONSE');
    }
  });

  it('print.file: 404 "E-PRT-0007: Etiqueta pdf não processada" (recém-gerada) → NOT_FOUND com a mensagem do ME', async () => {
    handler = () => json(404, { message: 'E-PRT-0007: Etiqueta pdf não processada.' });
    const e = await caught(client().getLabelFile(ID));
    expect(e).toMatchObject({ code: 'NOT_FOUND', outcome: 'rejected' });
    expect(e.externalMessage).toContain('E-PRT-0007');
  });

  describe('allowlist exata do PDF S3 observado em produção', () => {
    const S3 = 'https://me-0047-prod.s3.amazonaws.com/pdf/abc.pdf?X-Amz-Signature=FAKE-TEST';
    it('permite somente o host exato em produção, sem herdar no Sandbox ou sem contexto', () => {
      expect(isAllowedLabelFileUrl(S3, PROD)).toBe(true);
      expect(isAllowedLabelFileUrl('https://me-0047-prod.s3.amazonaws.com:443/pdf/a.pdf', PROD)).toBe(true);
      expect(isAllowedLabelFileUrl(S3, SANDBOX)).toBe(false);
      expect(isAllowedLabelFileUrl(S3)).toBe(false);
    });
    it.each([
      'https://me-0047-prod.s3.amazonaws.com.evil.test/a.pdf',
      'https://x.me-0047-prod.s3.amazonaws.com/a.pdf',
      'https://me-0047-prod-evil.s3.amazonaws.com/a.pdf',
      'https://me-0047-prods.s3.amazonaws.com/a.pdf',
      'https://outro-bucket.s3.amazonaws.com/a.pdf',
      'https://s3.amazonaws.com/me-0047-prod/a.pdf',
      'https://me-0047-prod.s3.us-east-1.amazonaws.com/a.pdf',
      'http://me-0047-prod.s3.amazonaws.com/a.pdf',
      'https://me-0047-prod.s3.amazonaws.com:8443/a.pdf',
      'https://user:pass@me-0047-prod.s3.amazonaws.com/a.pdf',
      'https://me-0047-prod.s3.amazonaws.com@evil.test/a.pdf',
    ])('bloqueia destino semelhante/inseguro sem enviar requisição: %s', async (url) => {
      expect(isAllowedLabelFileUrl(url, PROD)).toBe(false);
      expect(await caught(client(PROD).downloadLabelPdf(url))).toMatchObject({ code: 'BAD_RESPONSE', fields: ['host_not_allowed'] });
      expect(calls).toHaveLength(0);
    });
  });

  describe('allowlist estrita do host S3 do Sandbox (aprovado em 06/11/2026)', () => {
    const S3 = 'https://me-0047-sandbox.s3.amazonaws.com/pdf/abc.pdf?X-Amz-Expires=1800&X-Amz-Signature=x';
    const MOCK_LOCAL = { environment: 'sandbox' as const, baseUrl: 'http://localhost:4010' };
    const OUTRO_SANDBOX = { environment: 'sandbox' as const, baseUrl: 'https://sandbox.exemplo.test' };

    it('permite SÓ o host exato, SÓ no Sandbox oficial', () => {
      expect(isAllowedLabelFileUrl(S3, SANDBOX)).toBe(true);
      expect(isAllowedLabelFileUrl('https://ME-0047-SANDBOX.s3.amazonaws.com./pdf/a.pdf', SANDBOX)).toBe(true); // maiúsculas/ponto final normalizados
    });

    it('produção, sem contexto, mock local ou "sandbox" de outro host: bloqueado', () => {
      expect(isAllowedLabelFileUrl(S3, PROD)).toBe(false);
      expect(isAllowedLabelFileUrl(S3)).toBe(false);
      expect(isAllowedLabelFileUrl(S3, MOCK_LOCAL)).toBe(false);
      expect(isAllowedLabelFileUrl(S3, OUTRO_SANDBOX)).toBe(false);
    });

    it.each([
      ['outro bucket S3', 'https://me-0047.s3.amazonaws.com/pdf/a.pdf'],
      ['bucket qualquer', 'https://evil-bucket.s3.amazonaws.com/a.pdf'],
      ['wildcard amazonaws', 'https://s3.amazonaws.com/me-0047-sandbox/pdf/a.pdf'],
      ['subdomínio do host aprovado', 'https://x.me-0047-sandbox.s3.amazonaws.com/a.pdf'],
      ['sufixo enganoso', 'https://me-0047-sandbox.s3.amazonaws.com.evil.test/a.pdf'],
      ['HTTP', 'http://me-0047-sandbox.s3.amazonaws.com/pdf/a.pdf'],
      ['porta estranha', 'https://me-0047-sandbox.s3.amazonaws.com:8443/pdf/a.pdf'],
      ['credenciais na URL', 'https://user:pass@me-0047-sandbox.s3.amazonaws.com/pdf/a.pdf'],
      ['IP literal', 'https://52.216.0.1/pdf/a.pdf'],
      ['localhost', 'https://localhost/pdf/a.pdf'],
      ['nome local', 'https://arquivos.local/pdf/a.pdf'],
    ])('Sandbox oficial ainda bloqueia: %s', (_n, url) => {
      expect(isAllowedLabelFileUrl(url, SANDBOX)).toBe(false);
    });

    it('porta 443 explícita é aceita', () => {
      expect(isAllowedLabelFileUrl('https://me-0047-sandbox.s3.amazonaws.com:443/pdf/a.pdf', SANDBOX)).toBe(true);
    });
  });

  it('print.file: GET /imprimir/pdf/{id} → URL temporária', async () => {
    handler = () => json(200, { url: 'https://bucket.s3.amazonaws.com/etiqueta.pdf?X-Amz=1' });
    expect((await client().getLabelFile(ID)).url).toMatch(/^https:\/\/bucket/);
    expect(calls[0]).toMatchObject({ method: 'GET', url: `${SANDBOX.baseUrl}/api/v2/me/imprimir/pdf/${ID}` });
  });

  it('tracking: status, rastreio dos Correios e do ME, datas', async () => {
    handler = () => json(200, { [ID]: { id: ID, status: 'posted', tracking: 'AB123456789BR', melhorenvio_tracking: 'ME7XYZ', posted_at: '2026-10-28 09:00:00' } });
    const t = await client().tracking(ID);
    expect(t).toMatchObject({ id: ID, status: 'posted', tracking: 'AB123456789BR', selfTracking: 'ME7XYZ' });
    expect(t.dates.postedAt).toMatch(/^2026-10-28/);
  });

  it('cancellable e cancel', async () => {
    handler = () => json(200, { [ID]: { cancellable: true, time: 10 } });
    expect(await client().cancellable(ID)).toEqual({ cancellable: true });
    handler = () => json(200, { [ID]: { canceled: true } });
    expect(await client().cancel(ID, '  Cliente   desistiu  ')).toEqual({ canceled: true });
    expect(calls[1].body).toEqual({ order: { id: ID, reason_id: '2', description: 'Cliente desistiu' } });
  });
});

describe('OAuth: 401 → renova UMA vez e repete UMA vez', () => {
  it('401 seguido de sucesso: usa o token novo', async () => {
    let n = 0;
    handler = () => (++n === 1 ? json(401, { message: 'Unauthenticated.' }) : json(200, { id: ID, status: 'pending' }));
    await client().getOrder(ID);
    expect(refreshToken).toHaveBeenCalledTimes(1);
    expect(refreshToken).toHaveBeenCalledWith(TOKEN);
    expect(calls.map((c) => c.headers.Authorization)).toEqual([`Bearer ${TOKEN}`, `Bearer ${FRESH}`]);
  });

  it('checkout com 401 também repete uma vez (401 = não processado)', async () => {
    let n = 0;
    handler = () => (++n === 1 ? json(401, {}) : json(200, { purchase: { id: 'p-12345678', orders: [{ id: ID, status: 'released' }] } }));
    await client().checkout(ID);
    expect(calls).toHaveLength(2);
  });

  it('401 de novo após renovar: NEEDS_RECONNECT, sem terceira tentativa', async () => {
    handler = () => json(401, {});
    const e = await caught(client().checkout(ID));
    expect(e).toMatchObject({ code: 'NEEDS_RECONNECT', outcome: 'rejected', requiresReconciliation: false });
    expect(calls).toHaveLength(2);
    expect(refreshToken).toHaveBeenCalledTimes(1);
  });

  it('renovação recusada (invalid_grant) ou credencial marcada: NEEDS_RECONNECT', async () => {
    handler = () => json(401, {});
    refreshToken.mockRejectedValueOnce(new OAuthTokenError('invalid_grant'));
    expect((await caught(client().getOrder(ID))).code).toBe('NEEDS_RECONNECT');
    refreshToken.mockRejectedValueOnce(new OAuthUnavailableError('needs_reconnect'));
    expect((await caught(client().getOrder(ID))).code).toBe('NEEDS_RECONNECT');
  });

  it('renovação com falha temporária (timeout): UNAUTHORIZED, uma única ida à API', async () => {
    handler = () => json(401, {});
    refreshToken.mockRejectedValueOnce(new OAuthTokenError('timeout'));
    const e = await caught(client().getOrder(ID));
    expect(e.code).toBe('UNAUTHORIZED');
    expect(calls).toHaveLength(1);
  });

  it('sem token / OAuth precisa reconectar / falha ao obter token: nada é enviado', async () => {
    getToken.mockResolvedValueOnce(null);
    expect(await caught(client().getOrder(ID))).toMatchObject({ code: 'NOT_CONFIGURED', outcome: 'not_sent' });
    getToken.mockRejectedValueOnce(new OAuthUnavailableError('needs_reconnect'));
    expect(await caught(client().checkout(ID))).toMatchObject({ code: 'NEEDS_RECONNECT', outcome: 'not_sent', requiresReconciliation: false });
    getToken.mockRejectedValueOnce(new Error('db fora'));
    expect((await caught(client().getOrder(ID))).code).toBe('UNAUTHORIZED');
    expect(calls).toHaveLength(0);
  });
});

describe('erros HTTP', () => {
  it('422 no carrinho: VALIDATION com campos e mensagem sanitizada (sem reconciliação)', async () => {
    handler = () => json(422, {
      message: 'The given data was invalid.',
      errors: { 'to.postal_code': ['CEP 01310-100 inválido para cliente@exemplo.test'], 'volumes.0.weight': ['Peso inválido'] },
    });
    const e = await caught(client().addToCart(PAYLOAD));
    expect(e).toMatchObject({ code: 'VALIDATION', outcome: 'rejected', httpStatus: 422, requiresReconciliation: false });
    expect(e.fields).toEqual(['to.postal_code', 'volumes.0.weight']);
    expect(e.externalMessage).toContain('[cep]');
    expect(e.externalMessage).toContain('[email]');
    expect(e.externalMessage).not.toMatch(/01310|exemplo\.test/);
  });

  it('checkout 422 "já foram pagas": ALREADY_PAID + reconciliação', async () => {
    handler = () => json(422, { error: 'Existe uma ou mais orders que já foram pagas' });
    const e = await caught(client().checkout(ID));
    expect(e).toMatchObject({ code: 'ALREADY_PAID', outcome: 'rejected', requiresReconciliation: true });
  });

  it('checkout 422 qualquer (ex.: saldo): recusado, mas exige consultar antes de tentar de novo', async () => {
    handler = () => json(422, { message: 'Saldo insuficiente' });
    const e = await caught(client().checkout(ID));
    expect(e).toMatchObject({ code: 'VALIDATION', outcome: 'rejected', requiresReconciliation: true, externalMessage: 'Saldo insuficiente' });
  });

  it('403 (escopo) e 404', async () => {
    handler = () => json(403, { message: 'This action is unauthorized.' });
    expect(await caught(client().generate(ID))).toMatchObject({ code: 'FORBIDDEN', requiresReconciliation: false });
    handler = () => json(404, { message: 'Not found' });
    expect(await caught(client().getOrder(ID))).toMatchObject({ code: 'NOT_FOUND', outcome: 'rejected' });
  });

  it('429: RATE_LIMITED com Retry-After; checkout não pede reconciliação (recusado antes)', async () => {
    handler = () => json(429, { message: 'Too Many Attempts.' }, { 'retry-after': '30' });
    const e = await caught(client().checkout(ID));
    expect(e).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: 30, requiresReconciliation: false });
    expect(calls).toHaveLength(1);
  });

  it('5xx: SERVER_ERROR ambíguo; no checkout exige reconciliação; nunca repete', async () => {
    handler = () => json(502, { message: 'Bad gateway' });
    expect(await caught(client().checkout(ID))).toMatchObject({ code: 'SERVER_ERROR', outcome: 'unknown', requiresReconciliation: true });
    expect(await caught(client().getOrder(ID))).toMatchObject({ code: 'SERVER_ERROR', requiresReconciliation: false });
    expect(calls).toHaveLength(2);
  });

  it('status não previsto (409, 302): UNKNOWN ambíguo', async () => {
    handler = () => json(409, { message: 'conflito' });
    expect(await caught(client().cancel(ID, 'x'))).toMatchObject({ code: 'UNKNOWN', outcome: 'unknown', requiresReconciliation: true });
  });

  it('cancelamento recusado (422 ou canceled:false): NOT_CANCELLABLE', async () => {
    handler = () => json(422, { message: 'Etiqueta já postada' });
    expect(await caught(client().cancel(ID, 'x'))).toMatchObject({ code: 'NOT_CANCELLABLE', outcome: 'rejected' });
    handler = () => json(200, { [ID]: { canceled: false } });
    expect((await caught(client().cancel(ID, 'x'))).code).toBe('NOT_CANCELLABLE');
    handler = () => json(200, { [ID]: { cancellable: false } });
    expect(await client().cancellable(ID)).toEqual({ cancellable: false });
  });

  it('geração recusada: GENERATION_FAILED com mensagem sanitizada', async () => {
    handler = () => json(200, { [ID]: { status: false, message: '<b>Erro</b> ao gerar: token eyJhbGciOi.eyJzdWIi.assinatura' } });
    const e = await caught(client().generate(ID));
    expect(e.code).toBe('GENERATION_FAILED');
    expect(e.externalMessage).toBe('Erro ao gerar: token [token]');
  });
});

describe('timeout, rede e resposta malformada', () => {
  it('timeout no checkout: TIMEOUT ambíguo + reconciliação; sem nova tentativa', async () => {
    handler = () => new Promise<Response>(() => {}); // nunca responde
    const fetchHang = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    ) as unknown as typeof fetch;
    const c = createMeLabelsClient({ fetchImpl: fetchHang, config: SANDBOX, getToken, refreshToken, log: () => {} });
    const e = await caught(c.checkout(ID));
    expect(e).toMatchObject({ code: 'TIMEOUT', outcome: 'unknown', requiresReconciliation: true });
    expect(fetchHang).toHaveBeenCalledTimes(1);
  });

  it('timeout em leitura (getOrder): não exige reconciliação', async () => {
    const fetchHang = vi.fn((_i: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
    ) as unknown as typeof fetch;
    const c = createMeLabelsClient({ fetchImpl: fetchHang, config: SANDBOX, getToken, refreshToken, log: () => {} });
    expect(await caught(c.getOrder(ID))).toMatchObject({ code: 'TIMEOUT', requiresReconciliation: false });
  });

  it('falha de rede: NETWORK ambíguo', async () => {
    handler = () => {
      throw new TypeError('fetch failed');
    };
    expect(await caught(client().checkout(ID))).toMatchObject({ code: 'NETWORK', outcome: 'unknown', requiresReconciliation: true });
  });

  it.each([
    ['checkout sem purchase', 'checkout', { ok: true }],
    ['checkout sem a nossa etiqueta', 'checkout', { purchase: { id: 'p-12345678', orders: [{ id: 'outra-etiqueta-1', status: 'released' }] } }],
    ['checkout com HTML', 'checkout', '<html>ok</html>'],
    ['cart sem id', 'addToCart', { protocol: 'x' }],
    ['cart com id perigoso', 'addToCart', { id: '../../admin' }],
    ['generate sem a etiqueta', 'generate', { outra: { status: true } }],
    ['print com URL http', 'print', { url: 'http://inseguro.test/x' }],
    ['print com javascript:', 'print', { url: 'javascript:alert(1)' }],
    ['tracking vazio', 'tracking', {}],
    ['getOrder lista', 'getOrder', []],
    ['search objeto', 'searchOrders', { foo: 1 }],
  ])('%s → BAD_RESPONSE', async (_n, method, body) => {
    handler = () => (typeof body === 'string' ? new Response(body, { status: 200 }) : json(200, body));
    const c = client() as unknown as Record<string, (a: unknown) => Promise<unknown>>;
    const arg = method === 'addToCart' ? PAYLOAD : method === 'searchOrders' ? 'ORD-1' : ID;
    const e = await caught(c[method](arg));
    expect(e).toMatchObject({ code: 'BAD_RESPONSE', outcome: 'unknown' });
    if (method === 'checkout') expect(e.requiresReconciliation).toBe(true);
  });
});

describe('travas e entradas inválidas (nada vai à rede)', () => {
  it('etiquetas desligadas: toda operação bloqueada', async () => {
    const c = client({ ...SANDBOX, enabled: false });
    for (const p of [c.getOrder(ID), c.checkout(ID), c.addToCart(PAYLOAD), c.tracking(ID)]) {
      expect(await caught(p)).toMatchObject({ code: 'OPERATION_BLOCKED', outcome: 'not_sent' });
    }
    expect(calls).toHaveLength(0);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('PRODUÇÃO sem ALLOW_PRODUCTION: checkout, cancelamento, carrinho e geração bloqueados', async () => {
    const c = client(PROD);
    for (const p of [c.checkout(ID), c.cancel(ID, 'x'), c.addToCart(PAYLOAD), c.removeFromCart(ID), c.generate(ID)]) {
      expect(await caught(p)).toMatchObject({ code: 'OPERATION_BLOCKED', outcome: 'not_sent', requiresReconciliation: false });
    }
    expect(calls).toHaveLength(0);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('PRODUÇÃO sem ALLOW_PRODUCTION: consultas continuam (reconciliação)', async () => {
    handler = () => json(200, { id: ID, status: 'released' });
    await client(PROD).getOrder(ID);
    expect(calls[0].url).toBe(`https://melhorenvio.com.br/api/v2/me/orders/${ID}`);
  });

  it('PRODUÇÃO com ALLOW_PRODUCTION: checkout vai para o host de produção', async () => {
    handler = () => json(200, { purchase: { id: 'p-12345678', orders: [{ id: ID, status: 'released' }] } });
    await client({ ...PROD, allowProduction: true }).checkout(ID);
    expect(calls[0].url).toBe('https://melhorenvio.com.br/api/v2/me/shipment/checkout');
  });

  it('id inválido nunca vira URL', async () => {
    for (const bad of ['../orders', 'a b', '', 'x'.repeat(65), 'abc']) {
      expect(await caught(client().getOrder(bad))).toMatchObject({ code: 'VALIDATION', outcome: 'not_sent' });
    }
    expect(await caught(client().searchOrders('a&b=c'))).toMatchObject({ outcome: 'not_sent' });
    expect(calls).toHaveLength(0);
  });
});

describe('logs e sanitização', () => {
  it('log só com operação e código — nunca token, payload ou resposta', async () => {
    handler = () => json(422, { message: `Erro com ${TOKEN} e cliente@exemplo.test` });
    await caught(client().addToCart({ to: { email: 'cliente@exemplo.test' } } as unknown as MeCartPayload));
    expect(logs).toEqual(['[melhor-envio:etiquetas] cart.add → VALIDATION (422)']);
  });

  it('toSafeJSON não carrega token nem corpo bruto', async () => {
    handler = () => json(422, { message: `Bearer ${TOKEN} recusado`, segredo: TOKEN });
    const e = await caught(client().addToCart(PAYLOAD));
    const safe = JSON.stringify(e.toSafeJSON());
    expect(safe).not.toContain(TOKEN);
    expect(safe).not.toContain('segredo');
    expect(e.externalMessage).toBe('[token] recusado');
  });

  it('sanitizeExternalMessage: HTML, URL, documentos, telefone, limite de tamanho', () => {
    expect(sanitizeExternalMessage('<p>Ver https://x.test/a?token=1</p>')).toBe('Ver [url]');
    expect(sanitizeExternalMessage('CPF 529.982.247-25 / CNPJ 11.222.333/0001-81')).toBe('CPF [documento] / CNPJ [documento]');
    expect(sanitizeExternalMessage('Fone (54) 99999-0000')).toBe('Fone [telefone]');
    expect(sanitizeExternalMessage('chave ' + 'a1B2'.repeat(10))).toBe('chave [redigido]');
    expect(sanitizeExternalMessage('x'.repeat(500))!.length).toBeLessThanOrEqual(200);
    expect(sanitizeExternalMessage('   ')).toBeNull();
    expect(sanitizeExternalMessage({ obj: 1 })).toBeNull();
  });
});

describe('download do PDF (URL temporária)', () => {
  const PDF_URL = 'https://arquivos.melhorenvio.com.br/etiqueta/abc.pdf';
  const pdf = (bytes = '%PDF-1.4 conteudo') => new Response(bytes, { status: 200, headers: { 'content-type': 'application/pdf' } });

  it('baixa SEM o token do ME e devolve os bytes', async () => {
    handler = () => pdf();
    const buf = await client().downloadLabelPdf(PDF_URL);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls[0].url).toBe(PDF_URL);
    expect(JSON.stringify(calls[0].headers)).not.toContain(TOKEN);
    expect(calls[0].headers).not.toHaveProperty('Authorization');
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each([
    'http://arquivos.melhorenvio.com.br/x.pdf',
    'https://melhorenvio.com.br.evil.test/x.pdf',
    'https://169.254.169.254/latest',
    'nao-e-url',
  ])('host/protocolo fora do Melhor Envio é recusado sem rede: %s', async (url) => {
    expect((await caught(client().downloadLabelPdf(url))).code).toBe('BAD_RESPONSE');
    expect(calls).toHaveLength(0);
  });

  it('conteúdo que não é PDF, vazio ou grande demais é recusado', async () => {
    handler = () => new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect((await caught(client().downloadLabelPdf(PDF_URL))).code).toBe('BAD_RESPONSE');
    handler = () => pdf('');
    expect((await caught(client().downloadLabelPdf(PDF_URL))).code).toBe('BAD_RESPONSE');
    handler = () => new Response('%PDF-', { status: 200, headers: { 'content-length': String(20 * 1024 * 1024) } });
    expect((await caught(client().downloadLabelPdf(PDF_URL))).code).toBe('BAD_RESPONSE');
  });

  it('404/5xx/timeout viram erro tipado; travas desligadas bloqueiam antes da rede', async () => {
    handler = () => new Response('', { status: 404 });
    expect((await caught(client().downloadLabelPdf(PDF_URL))).code).toBe('NOT_FOUND');
    handler = () => new Response('', { status: 503 });
    expect((await caught(client().downloadLabelPdf(PDF_URL))).code).toBe('SERVER_ERROR');
    handler = () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    expect((await caught(client().downloadLabelPdf(PDF_URL))).code).toBe('TIMEOUT');
    calls.length = 0;
    expect((await caught(client({ ...SANDBOX, enabled: false }).downloadLabelPdf(PDF_URL))).code).toBe('OPERATION_BLOCKED');
    expect(calls).toHaveLength(0);
  });
});

describe('download do PDF — redirects validados um a um', () => {
  const START = 'https://www.melhorenvio.com.br/imprimir/abc';
  const pdf = () => new Response('%PDF-1.4 ok', { status: 200, headers: { 'content-type': 'application/pdf' } });
  const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
  /** Servidor falso: mapa URL → resposta. */
  const routes = (map: Record<string, () => Response>): Handler => (req) => (map[req.url] ?? (() => new Response('', { status: 404 })))();

  it('redirect para OUTRO subdomínio permitido → baixa; sem token em nenhum salto; redirect manual', async () => {
    handler = routes({ [START]: () => redirect('https://arquivos.melhorenvio.com.br/tmp/abc.pdf'), 'https://arquivos.melhorenvio.com.br/tmp/abc.pdf': pdf });
    const buf = await client().downloadLabelPdf(START);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls.map((c) => c.url)).toEqual([START, 'https://arquivos.melhorenvio.com.br/tmp/abc.pdf']);
    for (const c of calls) {
      expect(Object.keys(c.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
      expect(JSON.stringify(c.headers)).not.toContain(TOKEN);
    }
    expect(vi.mocked(fetchImpl).mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
    expect(getToken).not.toHaveBeenCalled();
  });

  it('Sandbox: URL S3 aprovada baixa direto (sem redirect, sem token)', async () => {
    const S3 = 'https://me-0047-sandbox.s3.amazonaws.com/pdf/abc.pdf?X-Amz-Expires=1800';
    handler = routes({ [S3]: pdf });
    expect((await client(SANDBOX).downloadLabelPdf(S3)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(JSON.stringify(calls[0].headers)).not.toContain(TOKEN);
  });

  it('produção baixa PDF do host exato diretamente ou por redirect validado, sem token', async () => {
    const S3 = 'https://me-0047-prod.s3.amazonaws.com/pdf/abc.pdf?X-Amz-Signature=FAKE-TEST';
    handler = routes({ [START]: () => redirect(S3), [S3]: pdf });
    expect((await client(PROD).downloadLabelPdf(S3)).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await client(PROD).downloadLabelPdf(START)).subarray(0, 5).toString()).toBe('%PDF-');
    expect(calls.map((c) => c.url)).toEqual([S3, START, S3]);
    expect(vi.mocked(fetchImpl).mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true);
    for (const call of calls) expect(Object.keys(call.headers).map((key) => key.toLowerCase())).not.toContain('authorization');
    expect(getToken).not.toHaveBeenCalled();
  });

  it('produção revalida redirect saindo do S3 aprovado e não acessa host malicioso', async () => {
    const S3 = 'https://me-0047-prod.s3.amazonaws.com/pdf/abc.pdf';
    const evil = 'https://me-0047-prod.s3.amazonaws.com.evil.test/a.pdf';
    handler = routes({ [S3]: () => redirect(evil), [evil]: pdf });
    expect(await caught(client(PROD).downloadLabelPdf(S3))).toMatchObject({ code: 'BAD_RESPONSE', fields: ['host_not_allowed'] });
    expect(calls.map((c) => c.url)).toEqual([S3]);
  });

  it('produção NÃO baixa da URL S3 do Sandbox (nada vai à rede); log só com o host, sem a assinatura', async () => {
    const S3 = 'https://me-0047-sandbox.s3.amazonaws.com/pdf/abc.pdf?X-Amz-Expires=1800&X-Amz-Signature=SEGREDO123';
    handler = routes({ [S3]: pdf });
    const e = await caught(client(PROD).downloadLabelPdf(S3));
    expect(e).toMatchObject({ code: 'BAD_RESPONSE', outcome: 'not_sent', fields: ['host_not_allowed'] });
    expect(calls).toHaveLength(0);
    expect(logs.join(" | ")).toContain('me-0047-sandbox.s3.amazonaws.com');
    expect(logs.join(" | ")).not.toContain('SEGREDO123');
    expect(logs.join(" | ")).not.toContain('/pdf/abc.pdf');
  });

  it.each(['inicial', 'redirect'] as const)('diagnóstico %s: só hostname, sem porta, credenciais ou partes assinadas', async (stage) => {
    const blocked = 'https://USUARIOSECRETO:SENHASECRETA@BLOQUEADO.example.test:8443/pdf/ARQUIVOSECRETO?X-Amz-Signature=ASSINATURASECRETA#FRAGMENTOSECRETO';
    handler = () => redirect(blocked);
    const error = await caught(client(PROD).downloadLabelPdf(stage === 'inicial' ? blocked : START));
    expect(error).toMatchObject({ code: 'BAD_RESPONSE', fields: ['host_not_allowed'] });
    expect(calls).toHaveLength(stage === 'inicial' ? 0 : 1);
    const prefix = stage === 'inicial' ? 'hostname do PDF NÃO autorizado' : 'redirect para hostname NÃO autorizado';
    expect(logs).toContain(`[melhor-envio:etiquetas] print.file → ${prefix} (production): bloqueado.example.test`);
    const log = logs.join(' | ');
    for (const secret of ['USUARIOSECRETO', 'SENHASECRETA', 'ARQUIVOSECRETO', 'ASSINATURASECRETA', 'FRAGMENTOSECRETO', '8443', 'X-Amz-', 'https://', TOKEN]) {
      expect(log).not.toContain(secret);
    }
  });

  it('diagnóstico preserva hostname DNS válido com mais de 120 caracteres, sem truncamento', async () => {
    const hostname = `${'a'.repeat(60)}.${'b'.repeat(60)}.example.test`;
    await caught(client(PROD).downloadLabelPdf(`https://${hostname}/pdf/NAOLOGAR?token=NAOLOGAR`));
    expect(logs).toContain(`[melhor-envio:etiquetas] print.file → hostname do PDF NÃO autorizado (production): ${hostname}`);
    expect(logs.join(' | ')).not.toContain('NAOLOGAR');
    expect(calls).toHaveLength(0);
  });

  it('Sandbox: S3 aprovado redirecionando para OUTRO bucket → bloqueado no salto', async () => {
    const S3 = 'https://me-0047-sandbox.s3.amazonaws.com/pdf/abc.pdf';
    handler = routes({ [S3]: () => redirect('https://outro-bucket.s3.amazonaws.com/abc.pdf'), 'https://outro-bucket.s3.amazonaws.com/abc.pdf': pdf });
    const e = await caught(client(SANDBOX).downloadLabelPdf(S3));
    expect(e.code).toBe('BAD_RESPONSE');
    expect(calls.map((c) => c.url)).toEqual([S3]);
  });

  it('redirect relativo dentro do mesmo host permitido → ok', async () => {
    handler = routes({ [START]: () => redirect('/files/abc.pdf', 301), 'https://www.melhorenvio.com.br/files/abc.pdf': pdf });
    expect((await client().downloadLabelPdf(START)).length).toBeGreaterThan(5);
  });

  it.each([
    ['domínio externo', 'https://cdn.exemplo.test/abc.pdf'],
    ['sufixo enganoso', 'https://melhorenvio.com.br.evil.test/abc.pdf'],
    ['HTTP', 'http://arquivos.melhorenvio.com.br/abc.pdf'],
    ['localhost', 'https://localhost/abc.pdf'],
    ['IP privado', 'https://10.0.0.5/abc.pdf'],
    ['metadados da nuvem', 'https://169.254.169.254/latest/meta-data'],
    ['IPv6 loopback', 'https://[::1]/abc.pdf'],
    ['porta estranha', 'https://arquivos.melhorenvio.com.br:8443/abc.pdf'],
    ['credenciais na URL', 'https://user:pass@arquivos.melhorenvio.com.br/abc.pdf'],
    ['outro esquema', 'file:///etc/passwd'],
  ])('redirect para %s → bloqueado SEM buscar o destino', async (_n, dest) => {
    handler = routes({ [START]: () => redirect(dest) });
    expect((await caught(client().downloadLabelPdf(START))).code).toBe('BAD_RESPONSE');
    expect(calls).toHaveLength(1);
  });

  it(`cadeia acima de ${MAX_LABEL_FILE_REDIRECTS} redirects → bloqueada`, async () => {
    const hop = (i: number) => `https://h${i}.melhorenvio.com.br/x`;
    const map: Record<string, () => Response> = { [START]: () => redirect(hop(1)) };
    for (let i = 1; i <= 10; i++) map[hop(i)] = () => redirect(hop(i + 1));
    handler = routes(map);
    expect((await caught(client().downloadLabelPdf(START))).code).toBe('BAD_RESPONSE');
    expect(calls).toHaveLength(MAX_LABEL_FILE_REDIRECTS + 1);
  });

  it('exatamente o limite de redirects + PDF válido → ok', async () => {
    const hop = (i: number) => `https://h${i}.melhorenvio.com.br/x`;
    const map: Record<string, () => Response> = { [START]: () => redirect(hop(1)) };
    for (let i = 1; i < MAX_LABEL_FILE_REDIRECTS; i++) map[hop(i)] = () => redirect(hop(i + 1));
    map[hop(MAX_LABEL_FILE_REDIRECTS)] = pdf;
    handler = routes(map);
    expect((await client().downloadLabelPdf(START)).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('redirect sem Location, e destino não-PDF após redirect permitido → recusados', async () => {
    handler = routes({ [START]: () => new Response(null, { status: 302 }) });
    expect((await caught(client().downloadLabelPdf(START))).code).toBe('BAD_RESPONSE');
    calls.length = 0;
    handler = routes({ [START]: () => redirect('https://a.melhorenvio.com.br/x'), 'https://a.melhorenvio.com.br/x': () => new Response('<html>', { status: 200 }) });
    expect((await caught(client().downloadLabelPdf(START))).code).toBe('BAD_RESPONSE');
  });

  it('allowlist: só melhorenvio.com.br e subdomínios, HTTPS', () => {
    expect(isAllowedLabelFileUrl('https://melhorenvio.com.br/a')).toBe(true);
    expect(isAllowedLabelFileUrl('https://sandbox.melhorenvio.com.br/a')).toBe(true);
    expect(isAllowedLabelFileUrl('https://MELHORENVIO.COM.BR./a')).toBe(true);
    for (const u of ['https://xmelhorenvio.com.br/a', 'https://melhorenvio.com/a', 'https://127.0.0.1/a', 'https://app.local/a', 'nada']) {
      expect(isAllowedLabelFileUrl(u)).toBe(false);
    }
  });
});
