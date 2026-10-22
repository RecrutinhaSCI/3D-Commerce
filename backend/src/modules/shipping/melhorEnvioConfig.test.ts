/**
 * Configuração do Melhor Envio: valor inválido NUNCA derruba o boot — desliga
 * a cotação (ou cai no padrão) e vira aviso.
 */
import { describe, expect, it } from 'vitest';
import { environmentOf, ME_DEFAULT_BASE_URL, ME_DEFAULT_TIMEOUT_MS, resolveMelhorEnvioConfig, resolveMelhorEnvioOAuthConfig } from './melhorEnvioConfig';

const OK = {
  NODE_ENV: 'development',
  MELHOR_ENVIO_TOKEN: 'tok',
  MELHOR_ENVIO_BASE_URL: 'https://melhorenvio.com.br/',
  MELHOR_ENVIO_USER_AGENT: '3DCommerce (contato@loja.test)',
  MELHOR_ENVIO_TIMEOUT_MS: '5000',
  SHIPPING_ORIGIN_CEP: '95700-000',
};

describe('resolveMelhorEnvioConfig', () => {
  it('configuração completa: ligado, sem avisos, CEP sem máscara e URL sem barra final', () => {
    const c = resolveMelhorEnvioConfig(OK);
    expect(c).toMatchObject({ enabled: true, originCep: '95700000', baseUrl: 'https://melhorenvio.com.br', timeoutMs: 5000 });
    expect(c.issues).toEqual([]);
  });

  it('sem token: desligado de propósito, sem aviso (mesmo com CEP inválido não quebra)', () => {
    const c = resolveMelhorEnvioConfig({ SHIPPING_ORIGIN_CEP: '95700000' });
    expect(c.enabled).toBe(false);
    expect(c.issues).toEqual([]);
    expect(resolveMelhorEnvioConfig({ SHIPPING_ORIGIN_CEP: '123' }).enabled).toBe(false);
  });

  it('token sem CEP de origem: desligado + aviso', () => {
    const c = resolveMelhorEnvioConfig({ ...OK, SHIPPING_ORIGIN_CEP: undefined });
    expect(c.enabled).toBe(false);
    expect(c.issues.join()).toMatch(/SHIPPING_ORIGIN_CEP/);
  });

  it.each(['9570000', '957000000', 'abc'])('CEP de origem inválido (%s): desligado + aviso', (cep) => {
    const c = resolveMelhorEnvioConfig({ ...OK, SHIPPING_ORIGIN_CEP: cep });
    expect(c.enabled).toBe(false);
    expect(c.issues.join()).toMatch(/SHIPPING_ORIGIN_CEP inválido/);
  });

  it('URL inválida: desligado + aviso; ausente: sandbox', () => {
    const bad = resolveMelhorEnvioConfig({ ...OK, MELHOR_ENVIO_BASE_URL: 'melhorenvio' });
    expect(bad.enabled).toBe(false);
    expect(bad.issues.join()).toMatch(/MELHOR_ENVIO_BASE_URL/);
    expect(resolveMelhorEnvioConfig({ ...OK, MELHOR_ENVIO_BASE_URL: undefined }).baseUrl).toBe(ME_DEFAULT_BASE_URL);
  });

  it.each(['0', '-5', 'abc', '999', '60000', '1500.5'])('timeout inválido (%s): usa o padrão + aviso, sem desligar', (t) => {
    const c = resolveMelhorEnvioConfig({ ...OK, MELHOR_ENVIO_TIMEOUT_MS: t });
    expect(c.enabled).toBe(true);
    expect(c.timeoutMs).toBe(ME_DEFAULT_TIMEOUT_MS);
    expect(c.issues.join()).toMatch(/MELHOR_ENVIO_TIMEOUT_MS/);
  });

  it('User-Agent sem e-mail: aviso; token entre aspas é limpo', () => {
    const c = resolveMelhorEnvioConfig({ ...OK, MELHOR_ENVIO_TOKEN: '"tok"', MELHOR_ENVIO_USER_AGENT: undefined });
    expect(c.token).toBe('tok');
    expect(c.issues.join()).toMatch(/USER_AGENT/);
  });

  it('sandbox em produção: aviso', () => {
    const c = resolveMelhorEnvioConfig({ ...OK, NODE_ENV: 'production', MELHOR_ENVIO_BASE_URL: undefined });
    expect(c.issues.join()).toMatch(/SANDBOX/);
  });

  it('avisos nunca contêm o token', () => {
    const c = resolveMelhorEnvioConfig({ ...OK, MELHOR_ENVIO_TOKEN: 'segredo-123', SHIPPING_ORIGIN_CEP: 'x', MELHOR_ENVIO_TIMEOUT_MS: 'y' });
    expect(c.issues.join()).not.toContain('segredo-123');
  });
});

describe('resolveMelhorEnvioOAuthConfig', () => {
  const KEY = 'a'.repeat(64);
  const OAUTH = {
    MELHOR_ENVIO_CLIENT_ID: '1234',
    MELHOR_ENVIO_CLIENT_SECRET: 'segredo',
    MELHOR_ENVIO_REDIRECT_URI: 'https://staging.example.test/api/integrations/melhor-envio/callback',
    MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: KEY,
  };

  it('sem nenhuma variável: desligado, sem aviso', () => {
    expect(resolveMelhorEnvioOAuthConfig({})).toMatchObject({ enabled: false, issues: [] });
  });

  it('completo: ligado; ambiente vem do host (sandbox/produção)', () => {
    expect(resolveMelhorEnvioOAuthConfig(OAUTH)).toMatchObject({ enabled: true, environment: 'sandbox', clientId: '1234' });
    expect(resolveMelhorEnvioOAuthConfig({ ...OAUTH, MELHOR_ENVIO_BASE_URL: 'https://melhorenvio.com.br' }).environment).toBe('production');
    expect(environmentOf('http://localhost:4010')).toBe('sandbox');
  });

  it('incompleto: desligado e o aviso só cita NOMES de variáveis (nunca valores)', () => {
    const c = resolveMelhorEnvioOAuthConfig({ ...OAUTH, MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: undefined });
    expect(c.enabled).toBe(false);
    expect(c.issues.join()).toMatch(/MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY/);
    expect(c.issues.join()).not.toContain('segredo');
    expect(c.clientSecret).toBeNull();
  });

  it.each([
    ['client id não numérico', { MELHOR_ENVIO_CLIENT_ID: 'abc' }, /CLIENT_ID/],
    ['chave curta', { MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: 'abcd' }, /ENCRYPTION_KEY/],
    ['redirect sem HTTPS', { MELHOR_ENVIO_REDIRECT_URI: 'http://loja.test/cb' }, /REDIRECT_URI/],
  ])('%s: desligado + aviso', (_l, over, re) => {
    const c = resolveMelhorEnvioOAuthConfig({ ...OAUTH, ...over });
    expect(c.enabled).toBe(false);
    expect(c.issues.join()).toMatch(re);
  });

  it('http://localhost só fora de produção', () => {
    const local = { ...OAUTH, MELHOR_ENVIO_REDIRECT_URI: 'http://localhost:3333/api/integrations/melhor-envio/callback' };
    expect(resolveMelhorEnvioOAuthConfig(local).enabled).toBe(true);
    expect(resolveMelhorEnvioOAuthConfig({ ...local, NODE_ENV: 'production' }).enabled).toBe(false);
  });

  it('chave aceita em base64 (32 bytes)', () => {
    expect(resolveMelhorEnvioOAuthConfig({ ...OAUTH, MELHOR_ENVIO_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }).enabled).toBe(true);
  });

  it('cotação liga com OAuth configurado mesmo sem token manual', () => {
    const c = resolveMelhorEnvioConfig({ ...OAUTH, SHIPPING_ORIGIN_CEP: '95700000', MELHOR_ENVIO_USER_AGENT: 'x (a@b.c)' });
    expect(c).toMatchObject({ enabled: true, token: null, oauthEnabled: true });
  });
});
