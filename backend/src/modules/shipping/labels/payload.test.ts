/**
 * Montagem do payload do carrinho (POST /api/v2/me/cart) — função pura,
 * sem HTTP. Remetente, destinatário do pedido, caixa real, serviço,
 * produtos, valor declarado e modalidade fiscal.
 */
import { describe, expect, it } from 'vitest';
import { buildFiscalPayloadParts } from './fiscal';
import { senderSchema } from './sender';
import { buildCartPayload, hashPayload, PayloadError, resolveLabelServiceId, type CartPayloadInput } from './payload';
import { makeNfeKey, TEST_CNPJ, TEST_CPF, validSenderInput } from './labels.testdata';

const sender = senderSchema.parse(validSenderInput());
const declaration = buildFiscalPayloadParts({ mode: 'DECLARATION' }, sender);

const input = (p: Partial<CartPayloadInput> = {}): CartPayloadInput => ({
  serviceId: 1,
  sender,
  recipient: {
    customerName: 'Cliente Teste',
    customerEmail: 'Cliente@Exemplo.Test',
    customerPhone: '(11) 98888-7777',
    document: '529.982.247-25',
    address: { recipientName: 'Fulano Destinatário', zipCode: '01310-100', street: 'Av. Paulista', number: '1000', complement: 'Ap 1', district: 'Bela Vista', city: 'São Paulo', state: 'sp' },
  },
  package: { weightKg: 1.2345, heightCm: 10.2, widthCm: 20, lengthCm: 30 },
  products: [
    { name: 'Filamento PLA 1kg', quantity: 2, unitPrice: 99.9 },
    { name: 'Bico 0.4', quantity: 1, unitPrice: 12.5 },
  ],
  fiscal: declaration,
  ...p,
});

describe('resolveLabelServiceId', () => {
  it('usa o serviço cotado; tabela fixa (id nulo) mapeia PAC→1 e SEDEX→2', () => {
    expect(resolveLabelServiceId({ shippingMethod: 'SEDEX', shippingServiceId: 2 })).toBe(2);
    expect(resolveLabelServiceId({ shippingMethod: 'PAC', shippingServiceId: null })).toBe(1);
    expect(resolveLabelServiceId({ shippingMethod: 'SEDEX', shippingServiceId: null })).toBe(2);
  });

  it.each([
    [{ shippingMethod: 'PICKUP', shippingServiceId: null }, 'PICKUP_ORDER'],
    [{ shippingMethod: null, shippingServiceId: null }, 'UNKNOWN_SERVICE'],
    [{ shippingMethod: 'PAC', shippingServiceId: 17 }, 'UNKNOWN_SERVICE'],
  ])('recusa %o', (order, code) => {
    expect(() => resolveLabelServiceId(order)).toThrowError(expect.objectContaining({ code }));
  });
});

describe('buildCartPayload — declaração de conteúdo', () => {
  const { payload, declaredValue, warnings, payloadHash } = buildCartPayload(input());

  it('remetente estruturado (CNPJ em company_document, sem IE na declaração)', () => {
    expect(payload.from).toEqual({
      name: 'Loja Teste 3D', phone: '54999990000', email: 'envio@loja.test', company_document: TEST_CNPJ,
      economic_activity_code: '4751201', address: 'Rua das Impressoras', complement: '', number: '100',
      district: 'Centro', city: 'Bento Gonçalves', country_id: 'BR', postal_code: '95700000', state_abbr: 'RS',
    });
    expect(payload.from).not.toHaveProperty('state_register');
  });

  it('destinatário do pedido (nome do snapshot, CPF em document, CEP/UF normalizados)', () => {
    expect(payload.to).toEqual({
      name: 'Fulano Destinatário', phone: '11988887777', email: 'cliente@exemplo.test', document: TEST_CPF,
      address: 'Av. Paulista', complement: 'Ap 1', number: '1000', district: 'Bela Vista', city: 'São Paulo',
      country_id: 'BR', postal_code: '01310100', state_abbr: 'SP',
    });
  });

  it('serviço, produtos (strings), um volume com a caixa REAL e valor declarado = soma', () => {
    expect(payload.service).toBe(1);
    expect(payload.products).toEqual([
      { name: 'Filamento PLA 1kg', quantity: '2', unitary_value: '99.90' },
      { name: 'Bico 0.4', quantity: '1', unitary_value: '12.50' },
    ]);
    expect(payload.volumes).toEqual([{ height: 11, width: 20, length: 30, weight: 1.235 }]);
    expect(declaredValue).toBe(212.3);
    expect(payload.options).toEqual({
      insurance_value: 212.3, receipt: false, own_hand: false, reverse: false, non_commercial: true, platform: '3DCommerce',
    });
    expect(warnings).toEqual([]);
    expect(payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('valor declarado explícito e tag do pedido', () => {
    const r = buildCartPayload(input({ declaredValue: 150, orderReference: 'pedido-abc123' }));
    expect(r.payload.options.insurance_value).toBe(150);
    expect(r.payload.options.tags).toEqual([{ tag: 'pedido-abc123', url: null }]);
  });
});

describe('buildCartPayload — NF-e', () => {
  it('invoice.key + state_register; non_commercial false', () => {
    const key = makeNfeKey(TEST_CNPJ);
    const fiscal = buildFiscalPayloadParts({ mode: 'NFE', nfeKey: key }, sender);
    const { payload } = buildCartPayload(input({ fiscal }));
    expect(payload.options).toMatchObject({ non_commercial: false, invoice: { key } });
    expect(payload.from.state_register).toBe('1234567890');
  });

  it('avisos fiscais seguem no resultado (não bloqueiam)', () => {
    const fiscal = buildFiscalPayloadParts({ mode: 'NFE', nfeKey: makeNfeKey(TEST_CNPJ) }, { ...sender, stateRegister: 'ISENTO' });
    expect(buildCartPayload(input({ fiscal })).warnings.join()).toMatch(/ISENTO/);
  });
});

describe('buildCartPayload — dados do pedido', () => {
  it('sem CPF do destinatário: segue com aviso (o Melhor Envio decide)', () => {
    const r = buildCartPayload(input({ recipient: { ...input().recipient, document: null } }));
    expect(r.payload.to).not.toHaveProperty('document');
    expect(r.warnings.join()).toMatch(/sem CPF/);
  });

  it('destinatário CNPJ vai em company_document', () => {
    const r = buildCartPayload(input({ recipient: { ...input().recipient, document: TEST_CNPJ } }));
    expect(r.payload.to.company_document).toBe(TEST_CNPJ);
  });

  it('remetente com CPF vai em document', () => {
    const r = buildCartPayload(input({ sender: { ...sender, document: TEST_CPF } }));
    expect(r.payload.from.document).toBe(TEST_CPF);
    expect(r.payload.from).not.toHaveProperty('company_document');
  });

  it.each([
    ['CEP inválido', { zipCode: '0131' }, 'INVALID_RECIPIENT_ADDRESS'],
    ['sem número', { number: ' ' }, 'INVALID_RECIPIENT_ADDRESS'],
    ['UF inválida', { state: 'São Paulo' }, 'INVALID_RECIPIENT_ADDRESS'],
    ['sem cidade', { city: null }, 'INVALID_RECIPIENT_ADDRESS'],
  ])('endereço do pedido: %s', (_n, patch, code) => {
    const recipient = { ...input().recipient, address: { ...input().recipient.address, ...patch } };
    expect(() => buildCartPayload(input({ recipient }))).toThrowError(expect.objectContaining({ code }));
  });

  it('documento inválido do destinatário nunca vai à API', () => {
    expect(() => buildCartPayload(input({ recipient: { ...input().recipient, document: '111.111.111-11' } }))).toThrowError(
      expect.objectContaining({ code: 'INVALID_RECIPIENT_DOCUMENT' }),
    );
  });

  it('sem produtos, valor declarado inválido ou serviço desconhecido', () => {
    expect(() => buildCartPayload(input({ products: [] }))).toThrow(PayloadError);
    expect(() => buildCartPayload(input({ products: [{ name: 'x', quantity: 0, unitPrice: 10 }] }))).toThrowError(expect.objectContaining({ code: 'NO_PRODUCTS' }));
    expect(() => buildCartPayload(input({ declaredValue: 0 }))).toThrowError(expect.objectContaining({ code: 'INVALID_DECLARED_VALUE' }));
    expect(() => buildCartPayload(input({ serviceId: 3 }))).toThrowError(expect.objectContaining({ code: 'UNKNOWN_SERVICE' }));
  });

  it('hash estável: mesma entrada = mesmo hash; mudar a caixa muda o hash', () => {
    expect(buildCartPayload(input()).payloadHash).toBe(buildCartPayload(input()).payloadHash);
    expect(buildCartPayload(input({ package: { weightKg: 2, heightCm: 10, widthCm: 20, lengthCm: 30 } })).payloadHash).not.toBe(
      buildCartPayload(input()).payloadHash,
    );
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('montagem é pura: não altera a entrada', () => {
    const i = input();
    const before = JSON.stringify(i);
    buildCartPayload(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
