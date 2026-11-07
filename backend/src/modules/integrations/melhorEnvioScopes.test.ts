/**
 * Scopes do Melhor Envio: lista oficial (24), nenhum scope inventado, cotação
 * preservada, cada operação de etiqueta coberta e normalização robusta.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateScopes,
  grantedScopes,
  ME_LABEL_SCOPE_BY_OPERATION,
  ME_LABEL_SCOPES,
  ME_OFFICIAL_SCOPES,
  ME_REQUESTED_SCOPES,
  normalizeScopes,
  scopesFromJwt,
} from './melhorEnvioScopes';

const jwt = (payload: unknown) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;

describe('lista oficial e lista pedida', () => {
  it('24 scopes oficiais, sem duplicados', () => {
    expect(ME_OFFICIAL_SCOPES).toHaveLength(24);
    expect(new Set(ME_OFFICIAL_SCOPES).size).toBe(24);
  });

  it('tudo que o app pede EXISTE na lista oficial (nada inventado)', () => {
    for (const s of ME_REQUESTED_SCOPES) expect(ME_OFFICIAL_SCOPES).toContain(s);
  });

  it('cotação preservada: shipping-calculate continua pedido (e primeiro)', () => {
    expect(ME_REQUESTED_SCOPES[0]).toBe('shipping-calculate');
  });

  it('cada operação do cliente de etiquetas tem scope; pedido mínimo (sem escrita de produtos/usuário/empresa)', () => {
    expect(Object.keys(ME_LABEL_SCOPE_BY_OPERATION).sort()).toEqual(
      ['cancel', 'cancellable', 'cart.add', 'cart.remove', 'checkout', 'generate', 'order.get', 'order.search', 'print', 'print.file', 'tracking'].sort(),
    );
    expect(ME_LABEL_SCOPES).toEqual(['cart-write', 'orders-read', 'shipping-cancel', 'shipping-checkout', 'shipping-generate', 'shipping-print', 'shipping-tracking']);
    for (const s of ['products-write', 'users-write', 'companies-write', 'coupons-write', 'ecommerce-shipping']) expect(ME_REQUESTED_SCOPES).not.toContain(s);
  });
});

describe('normalização e leitura', () => {
  it('espaço, vírgula, maiúsculas, duplicados e ordem', () => {
    expect(normalizeScopes(' Cart-Write,orders-read  orders-read SHIPPING-CALCULATE ')).toEqual(['cart-write', 'orders-read', 'shipping-calculate']);
    expect(normalizeScopes(['b-x', 'a-x', 'a-x'])).toEqual(['a-x', 'b-x']);
    expect(normalizeScopes(null)).toBeNull();
    expect(normalizeScopes('ok-1 <script> ../x')).toEqual(['ok-1']);
  });

  it('JWT: claim scopes/scope; inválido ou "*" → null', () => {
    expect(scopesFromJwt(jwt({ scopes: ['orders-read', 'cart-write'] }))).toEqual(['cart-write', 'orders-read']);
    expect(scopesFromJwt(jwt({ scope: 'shipping-calculate' }))).toEqual(['shipping-calculate']);
    expect(scopesFromJwt(jwt({ scopes: ['*'] }))).toBeNull();
    expect(scopesFromJwt(jwt({ sub: 'x' }))).toBeNull();
    expect(scopesFromJwt('nao-e-jwt')).toBeNull();
    expect(scopesFromJwt('a.@@@.c')).toBeNull();
  });

  it('resposta do token: campo `scope` tem prioridade sobre a claim', () => {
    expect(grantedScopes({ scope: 'shipping-calculate' }, jwt({ scopes: ['cart-write'] }))).toEqual({ scopes: ['shipping-calculate'], source: 'response' });
    expect(grantedScopes({}, jwt({ scopes: ['cart-write'] }))).toEqual({ scopes: ['cart-write'], source: 'token' });
    expect(grantedScopes({ scope: '' }, 'opaco')).toBeNull();
  });
});

describe('avaliação', () => {
  it('legada só com cotação: cotação ok, etiquetas faltando', () => {
    expect(evaluateScopes('shipping-calculate', null)).toMatchObject({ source: 'legacy', verified: true, quoteScopesOk: true, labelScopesComplete: false, missing: { quote: [], labels: ME_LABEL_SCOPES } });
  });
  it('"requested" nunca conta como confirmado', () => {
    expect(evaluateScopes(ME_REQUESTED_SCOPES.join(' '), 'requested')).toMatchObject({ verified: false, labelScopesComplete: true });
  });
  it('perdeu a cotação: aparece em missing.quote', () => {
    expect(evaluateScopes(ME_LABEL_SCOPES.join(' '), 'token').missing.quote).toEqual(['shipping-calculate']);
  });
});
