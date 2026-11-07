/**
 * Etapa 1 das etiquetas: travas, remetente, modalidade fiscal (NF-e ×
 * declaração), embalagem e máquina de estados. Tudo puro — sem banco nem rede.
 */
import { describe, expect, it } from 'vitest';
import type { ShipmentLabelStatus } from '@prisma/client';
import { resolveMelhorEnvioLabelsConfig } from '../melhorEnvioConfig';
import { parseStoredSender, senderReadiness, senderSchema, suggestSender } from './sender';
import { buildFiscalPayloadParts, FiscalError, fiscalSelectionSchema, isValidNfeKey } from './fiscal';
import { packageSchema, suggestPackage, toMelhorEnvioVolume } from './package';
import {
  assertLabelPurchaseAllowed,
  canStartPurchase,
  canTransition,
  LABEL_TRANSITIONS,
  notifiesCustomer,
  PAID_OR_UNKNOWN,
  syncsTrackingToOrder,
} from './labelStatus';
import { makeNfeKey, OTHER_CNPJ, TEST_CNPJ, TEST_CPF, validSenderInput } from './labels.testdata';

const PROD = 'https://melhorenvio.com.br';
const SANDBOX = 'https://sandbox.melhorenvio.com.br';

describe('travas MELHOR_ENVIO_LABELS_*', () => {
  it('padrão: tudo desligado, compra bloqueada', () => {
    const c = resolveMelhorEnvioLabelsConfig({});
    expect(c).toMatchObject({ enabled: false, allowProduction: false, environment: 'sandbox', isTest: true, purchaseAllowed: false });
    expect(c.blockedReason).toMatch(/MELHOR_ENVIO_LABELS_ENABLED/);
    expect(c.issues).toEqual([]);
  });

  it('ligada no Sandbox: compra de TESTE liberada (não precisa da trava de produção)', () => {
    const c = resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_ENABLED: 'true', MELHOR_ENVIO_BASE_URL: SANDBOX });
    expect(c).toMatchObject({ enabled: true, isTest: true, purchaseAllowed: true, blockedReason: null });
  });

  it('ligada apontando para PRODUÇÃO sem a segunda trava: bloqueada', () => {
    const c = resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_ENABLED: 'true', MELHOR_ENVIO_BASE_URL: PROD });
    expect(c).toMatchObject({ environment: 'production', isTest: false, purchaseAllowed: false });
    expect(c.blockedReason).toMatch(/PRODUÇÃO bloqueada/);
    expect(() => assertLabelPurchaseAllowed(c)).toThrowError(expect.objectContaining({ code: 'LABELS_PRODUCTION_BLOCKED', status: 403 }));
  });

  it('produção só com as DUAS travas', () => {
    const c = resolveMelhorEnvioLabelsConfig({
      MELHOR_ENVIO_LABELS_ENABLED: 'true',
      MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION: 'true',
      MELHOR_ENVIO_BASE_URL: PROD,
    });
    expect(c.purchaseAllowed).toBe(true);
    expect(() => assertLabelPurchaseAllowed(c)).not.toThrow();
  });

  it.each(['TRUE', '1', 'yes', 'sim', ' true ok'])('valor diferente de "true" (%s) NÃO liga + aviso', (v) => {
    const c = resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_ENABLED: v, MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION: v, MELHOR_ENVIO_BASE_URL: PROD });
    expect(c.enabled).toBe(false);
    expect(c.allowProduction).toBe(false);
    expect(c.issues.join()).toMatch(/inválida/);
  });

  it('só a trava de produção ligada: sem efeito + aviso; assert lança LABELS_DISABLED', () => {
    const c = resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_ALLOW_PRODUCTION: 'true', MELHOR_ENVIO_BASE_URL: PROD });
    expect(c.purchaseAllowed).toBe(false);
    expect(c.issues.join()).toMatch(/sem efeito/);
    expect(() => assertLabelPurchaseAllowed(c)).toThrowError(expect.objectContaining({ code: 'LABELS_DISABLED' }));
  });

  it('timeout das etiquetas: padrão 20 s; fora de 1000–60000 usa o padrão + aviso', () => {
    expect(resolveMelhorEnvioLabelsConfig({}).timeoutMs).toBe(20000);
    expect(resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_TIMEOUT_MS: '45000' }).timeoutMs).toBe(45000);
    for (const bad of ['500', '90000', 'abc', '1500.5']) {
      const c = resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_TIMEOUT_MS: bad });
      expect(c.timeoutMs).toBe(20000);
      expect(c.issues.join()).toMatch(/MELHOR_ENVIO_LABELS_TIMEOUT_MS/);
    }
  });

  it('URL inválida ou host parecido NÃO é tratado como produção', () => {
    for (const url of ['melhorenvio', 'https://melhorenvio.com.br.evil.test', 'http://localhost:9999']) {
      expect(resolveMelhorEnvioLabelsConfig({ MELHOR_ENVIO_LABELS_ENABLED: 'true', MELHOR_ENVIO_BASE_URL: url }).environment).toBe('sandbox');
    }
  });
});

describe('remetente', () => {
  it('normaliza: só dígitos, e-mail minúsculo, UF maiúscula, complemento vazio → null', () => {
    const s = senderSchema.parse(validSenderInput());
    expect(s).toMatchObject({
      document: TEST_CNPJ,
      stateRegister: '1234567890',
      economicActivityCode: '4751201',
      phone: '54999990000',
      email: 'envio@loja.test',
      postalCode: '95700000',
      complement: null,
      stateAbbr: 'RS',
    });
  });

  it('aceita CPF e IE "isento"', () => {
    const s = senderSchema.parse({ ...validSenderInput(), document: TEST_CPF, stateRegister: 'isento' });
    expect(s.stateRegister).toBe('ISENTO');
  });

  it.each([
    ['document', '11.111.111/1111-11', /CPF ou CNPJ/],
    ['document', '123', /CPF ou CNPJ/],
    ['postalCode', '9570', /CEP/],
    ['stateAbbr', 'XX', /UF/],
    ['phone', '123', /Telefone/],
    ['stateRegister', 'ABC', /Inscrição/],
    ['email', 'nao-e-email', /E-mail/],
    ['number', '', /Número/],
  ])('recusa %s inválido (%s)', (field, value, msg) => {
    const r = senderSchema.safeParse({ ...validSenderInput(), [field]: value });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.flatten().fieldErrors)).toMatch(msg);
  });

  it('recusa campos desconhecidos (strict)', () => {
    expect(senderSchema.safeParse({ ...validSenderInput(), token: 'x' }).success).toBe(false);
  });

  it('JSON gravado corrompido = sem remetente', () => {
    expect(parseStoredSender(null)).toBeNull();
    expect(parseStoredSender([])).toBeNull();
    expect(parseStoredSender({ name: 'x' })).toBeNull();
    expect(parseStoredSender(senderSchema.parse(validSenderInput()))).not.toBeNull();
  });

  it('prontidão: sem remetente nada; CNPJ+IE = declaração e NF-e; CPF = só declaração; CEP diferente = aviso', () => {
    expect(senderReadiness(null, '95700000')).toMatchObject({ declaration: false, nfe: false });
    const full = senderSchema.parse(validSenderInput());
    expect(senderReadiness(full, '95700000')).toEqual({ declaration: true, nfe: true, issues: [] });
    const cpf = senderSchema.parse({ ...validSenderInput(), document: TEST_CPF, stateRegister: '' });
    const r = senderReadiness(cpf, '95700000');
    expect(r).toMatchObject({ declaration: true, nfe: false });
    expect(r.issues.join()).toMatch(/inscrição estadual/);
    expect(senderReadiness(full, '01310100').issues.join()).toMatch(/SHIPPING_ORIGIN_CEP/);
    const cpfComIe = senderReadiness({ ...full, document: TEST_CPF }, '95700000');
    expect(cpfComIe.nfe).toBe(true);
    expect(cpfComIe.issues.join()).toMatch(/CPF/);
  });

  it('sugestão vem das configurações da loja (nunca gravada sozinha)', () => {
    const s = suggestSender({ storeName: 'Loja', cnpj: '11.222.333/0001-81', email: 'a@b.test', whatsapp: '+55 (54) 99999-0000' }, '95700000');
    expect(s).toMatchObject({ name: 'Loja', document: '11222333000181', phone: '54999990000', postalCode: '95700000' });
  });
});

describe('modalidade fiscal: NF-e × declaração de conteúdo', () => {
  const sender = senderSchema.parse(validSenderInput());
  const key = makeNfeKey(TEST_CNPJ);

  it('chave da NF-e: 44 dígitos, modelo 55 e DV módulo 11', () => {
    expect(isValidNfeKey(key)).toBe(true);
    expect(isValidNfeKey(key.replace(/(\d)$/, (d) => String((Number(d) + 1) % 10)))).toBe(false);
    expect(isValidNfeKey(makeNfeKey(TEST_CNPJ, { model: '65' }))).toBe(false); // NFC-e
    expect(isValidNfeKey(key.slice(0, 43))).toBe(false);
    expect(isValidNfeKey('0'.repeat(44))).toBe(false);
  });

  it('declaração: non_commercial e sem invoice', () => {
    const parts = buildFiscalPayloadParts(fiscalSelectionSchema.parse({ mode: 'DECLARATION' }), sender);
    expect(parts).toEqual({ options: { non_commercial: true }, fromStateRegister: '', fiscalMode: 'DECLARATION', nfeKey: null, warnings: [] });
  });

  it('NF-e: invoice.key + state_register do remetente (chave aceita com espaços)', () => {
    const spaced = key.replace(/(\d{4})/g, '$1 ').trim();
    const parts = buildFiscalPayloadParts(fiscalSelectionSchema.parse({ mode: 'NFE', nfeKey: spaced }), sender);
    expect(parts).toEqual({
      options: { non_commercial: false, invoice: { key } },
      fromStateRegister: '1234567890',
      fiscalMode: 'NFE',
      nfeKey: key,
      warnings: [],
    });
  });

  it('NF-e sem chave ou com chave inválida: recusado na validação', () => {
    expect(fiscalSelectionSchema.safeParse({ mode: 'NFE' }).success).toBe(false);
    expect(fiscalSelectionSchema.safeParse({ mode: 'NFE', nfeKey: '123' }).success).toBe(false);
    expect(fiscalSelectionSchema.safeParse({ mode: 'OUTRO' }).success).toBe(false);
    expect(fiscalSelectionSchema.safeParse({ mode: 'DECLARATION', nfeKey: key }).success).toBe(false);
  });

  it.each([
    ['sem remetente', null, key, 'SENDER_MISSING'],
    ['remetente sem IE (exigência da API)', { ...sender, stateRegister: null }, key, 'NFE_REQUIRES_STATE_REGISTER'],
  ])('NF-e recusada: %s', (_n, s, k, code) => {
    const sel = fiscalSelectionSchema.parse({ mode: 'NFE', nfeKey: k });
    expect(() => buildFiscalPayloadParts(sel, s)).toThrowError(expect.objectContaining({ code }));
    try {
      buildFiscalPayloadParts(sel, s);
    } catch (e) {
      expect(e).toBeInstanceOf(FiscalError);
    }
  });
});

describe('NF-e: só bloqueia o que a API exige', () => {
  const sender = senderSchema.parse(validSenderInput());
  const key = makeNfeKey(TEST_CNPJ);
  it.each([
    ['remetente CPF', { ...sender, document: TEST_CPF }, key, /CPF/],
    ['IE ISENTO', { ...sender, stateRegister: 'ISENTO' }, key, /ISENTO/],
    ['chave de outro CNPJ', sender, makeNfeKey(OTHER_CNPJ), /outro CNPJ/],
  ])('%s: NÃO bloqueia, gera aviso', (_n, s, k, msg) => {
    const parts = buildFiscalPayloadParts(fiscalSelectionSchema.parse({ mode: 'NFE', nfeKey: k }), s);
    expect(parts.fiscalMode).toBe('NFE');
    expect(parts.warnings.join()).toMatch(msg);
  });

  it('CNAE nunca bloqueia; IE só é exigida na NF-e', () => {
    const semCnae = { ...sender, economicActivityCode: null };
    expect(() => buildFiscalPayloadParts({ mode: 'NFE', nfeKey: key }, semCnae)).not.toThrow();
    expect(() => buildFiscalPayloadParts({ mode: 'DECLARATION' }, { ...semCnae, stateRegister: null })).not.toThrow();
  });
});

describe('embalagem informada pelo admin', () => {
  it('valida peso e medidas (aceita texto numérico do formulário)', () => {
    expect(packageSchema.parse({ weightKg: '0.35', heightCm: '4', widthCm: 12, lengthCm: 17.2 })).toEqual({
      weightKg: 0.35, heightCm: 4, widthCm: 12, lengthCm: 17.2,
    });
    for (const bad of [
      { weightKg: 0, heightCm: 4, widthCm: 12, lengthCm: 17 },
      { weightKg: 31, heightCm: 4, widthCm: 12, lengthCm: 17 },
      { weightKg: 1, heightCm: -1, widthCm: 12, lengthCm: 17 },
      { weightKg: 1, heightCm: 4, widthCm: 101, lengthCm: 17 },
      { weightKg: 1, heightCm: 4, widthCm: 12 },
      { weightKg: 'abc', heightCm: 4, widthCm: 12, lengthCm: 17 },
    ]) expect(packageSchema.safeParse(bad).success).toBe(false);
  });

  it('volume do Melhor Envio: dimensões inteiras arredondadas para cima', () => {
    expect(toMelhorEnvioVolume({ weightKg: 0.3456, heightCm: 4.1, widthCm: 12, lengthCm: 17.01 })).toEqual({
      height: 5, width: 12, length: 18, weight: 0.346,
    });
  });

  it('sugestão: nenhuma se faltar peso/medida em algum item (o admin informa a caixa)', () => {
    const s = suggestPackage([
      { quantity: 1, weight: 1, width: 20, height: 10, depth: 20 },
      { quantity: 2, weight: null, width: 20, height: 10, depth: 20 },
    ]);
    expect(s).toEqual({ package: null, itemsMissingData: 1 });
    expect(suggestPackage([]).package).toBeNull();
  });

  it('sugestão com dados completos: peso somado, altura empilhada, maior largura/comprimento', () => {
    const s = suggestPackage([
      { quantity: 2, weight: 1.05, width: 20, height: 8, depth: 20 },
      { quantity: 1, weight: 0.2, width: 10, height: 5, depth: 25 },
    ]);
    expect(s).toEqual({ package: { weightKg: 2.3, heightCm: 21, widthCm: 20, lengthCm: 25 }, itemsMissingData: 0 });
  });
});

describe('máquina de estados', () => {
  const all = Object.keys(LABEL_TRANSITIONS) as ShipmentLabelStatus[];

  it('compra só começa em AWAITING_CONFIRMATION', () => {
    expect(all.filter(canStartPurchase)).toEqual(['AWAITING_CONFIRMATION']);
  });

  it('PURCHASING nunca volta para PURCHASING (sem recompra) e timeout vai para reconciliação', () => {
    expect(canTransition('PURCHASING', 'PURCHASING')).toBe(false);
    expect(canTransition('PURCHASING', 'NEEDS_RECONCILIATION')).toBe(true);
  });

  it('reconciliação não compra direto: nunca vai para PURCHASING', () => {
    expect(canTransition('NEEDS_RECONCILIATION', 'PURCHASING')).toBe(false);
    for (const s of PAID_OR_UNKNOWN) expect(canTransition(s, 'PURCHASING')).toBe(false);
  });

  it('CANCELED e DELIVERED são finais; etiqueta postada não é cancelável', () => {
    expect(LABEL_TRANSITIONS.CANCELED).toEqual([]);
    expect(LABEL_TRANSITIONS.DELIVERED).toEqual([]);
    expect(canTransition('POSTED', 'CANCELED')).toBe(false);
  });

  it('todo destino é um status conhecido', () => {
    for (const targets of Object.values(LABEL_TRANSITIONS)) for (const t of targets) expect(all).toContain(t);
  });

  it('Sandbox: não grava rastreio no pedido nem avisa o cliente; produção sim', () => {
    expect(syncsTrackingToOrder('sandbox')).toBe(false);
    expect(notifiesCustomer('sandbox')).toBe(false);
    expect(syncsTrackingToOrder('production')).toBe(true);
    expect(notifiesCustomer('production')).toBe(true);
  });
});
