/**
 * Configuração do Melhor Envio: valor inválido NUNCA derruba o boot — desliga
 * a cotação (ou cai no padrão) e vira aviso.
 */
import { describe, expect, it } from 'vitest';
import { ME_DEFAULT_BASE_URL, ME_DEFAULT_TIMEOUT_MS, resolveMelhorEnvioConfig } from './melhorEnvioConfig';

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
