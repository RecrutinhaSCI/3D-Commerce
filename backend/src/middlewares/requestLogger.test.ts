import { describe, expect, it } from 'vitest';
import { sanitizeUrlForLog } from './requestLogger';

describe('sanitizeUrlForLog', () => {
  it('callback OAuth: code e state nunca aparecem', () => {
    const out = sanitizeUrlForLog('/api/integrations/melhor-envio/callback?code=abc123&state=xyz789');
    expect(out).toBe('/api/integrations/melhor-envio/callback?code=[redacted]&state=[redacted]');
    expect(out).not.toMatch(/abc123|xyz789/);
  });

  it('tokens e segredos em qualquer rota (sem diferenciar maiúsculas)', () => {
    const out = sanitizeUrlForLog('/x?access_token=a&Refresh_Token=b&client_secret=c&token=d&page=2');
    expect(out).not.toMatch(/=a&|=b&|=c&|=d&/);
    expect(out).toContain('page=2');
  });

  it('sem query: igual', () => {
    expect(sanitizeUrlForLog('/api/health')).toBe('/api/health');
  });
});
