import { afterEach, describe, expect, it, vi } from 'vitest';

// env controlado pelo teste (o real exige banco, MP etc.).
const mockEnv: Record<string, string | undefined> = {};
vi.mock('../config/env', () => ({ env: mockEnv }));

const { emailProvider, parseAddress, sendEmail } = await import('./email');

function setEnv(values: Record<string, string | undefined>) {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  Object.assign(mockEnv, values);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('parseAddress', () => {
  it('separa nome e e-mail', () => {
    expect(parseAddress('3DCommerce <contato@loja.com.br>')).toEqual({ name: '3DCommerce', email: 'contato@loja.com.br' });
    expect(parseAddress('"Loja X" <a@b.com>')).toEqual({ name: 'Loja X', email: 'a@b.com' });
  });
  it('aceita só o e-mail', () => {
    expect(parseAddress(' a@b.com ')).toEqual({ email: 'a@b.com' });
    expect(parseAddress('<a@b.com>')).toEqual({ email: 'a@b.com' });
  });
});

describe('emailProvider', () => {
  it('Brevo tem prioridade sobre SMTP; sem remetente = modo dev', () => {
    setEnv({ BREVO_API_KEY: 'k', SMTP_HOST: 'smtp.x', SMTP_FROM: 'a@b.com' });
    expect(emailProvider()).toBe('brevo');
    setEnv({ SMTP_HOST: 'smtp.x', SMTP_FROM: 'a@b.com' });
    expect(emailProvider()).toBe('smtp');
    setEnv({ BREVO_API_KEY: 'k' });
    expect(emailProvider()).toBeNull();
  });
});

describe('sendEmail via Brevo', () => {
  it('monta a requisição da API transacional', async () => {
    setEnv({ BREVO_API_KEY: 'xkeysib-test', SMTP_FROM: 'Loja <loja@x.com>' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messageId: '<id@brevo>' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendEmail({ to: 'cli@y.com', subject: 'Oi', html: '<p>oi</p>', text: 'oi', replyTo: 'Cli <cli@y.com>' });

    expect(res).toEqual({ sent: true, messageId: '<id@brevo>' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(init.headers['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(init.body)).toEqual({
      sender: { name: 'Loja', email: 'loja@x.com' },
      to: [{ email: 'cli@y.com' }],
      subject: 'Oi',
      htmlContent: '<p>oi</p>',
      textContent: 'oi',
      replyTo: { name: 'Cli', email: 'cli@y.com' },
    });
  });

  it('lança com o motivo do Brevo quando a API recusa', async () => {
    setEnv({ BREVO_API_KEY: 'bad', SMTP_FROM: 'loja@x.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), { status: 401 })),
    );
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })).rejects.toThrow(/HTTP 401.*unauthorized.*Key not found/);
  });

  it('modo dev: não chama a API e não lança', async () => {
    setEnv({});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(sendEmail({ to: 'a@b.com', subject: 's', html: 'h' })).resolves.toEqual({ sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
