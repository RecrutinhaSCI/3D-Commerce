import { beforeEach, describe, expect, it, vi } from 'vitest';

// env controlado pelo teste (o real exige banco, MP etc.).
const mockEnv: Record<string, unknown> = {};
vi.mock('../../config/env', () => ({ env: mockEnv }));

const { clearQuoteCache, isMelhorEnvioConfigured, MelhorEnvioError, normalizeCep, parseQuoteResponse, quoteMelhorEnvio } =
  await import('./melhorEnvio');

const BASE_ENV = {
  MELHOR_ENVIO_TOKEN: 'token-de-teste',
  MELHOR_ENVIO_BASE_URL: 'https://sandbox.melhorenvio.com.br',
  MELHOR_ENVIO_USER_AGENT: '3DCommerce (contato@loja.test)',
  MELHOR_ENVIO_TIMEOUT_MS: 8000,
  SHIPPING_ORIGIN_CEP: '95700000',
};

function setEnv(values: Record<string, unknown>) {
  for (const k of Object.keys(mockEnv)) delete mockEnv[k];
  Object.assign(mockEnv, values);
}

const item = (over: Partial<Parameters<typeof quoteMelhorEnvio>[1][number]> = {}) => ({
  productId: 'p1',
  quantity: 2,
  unitPrice: 129.9,
  weight: 1.25,
  width: 20.4,
  height: 8,
  depth: 21,
  ...over,
});

/** Resposta típica: PAC, Sedex, uma Jadlog (ignorada) e um serviço sem cotação. */
const ME_RESPONSE = [
  { id: 2, name: 'SEDEX', custom_price: '41.30', price: '45.00', custom_delivery_time: 3, company: { name: 'Correios' } },
  { id: 1, name: 'PAC', custom_price: '23.50', price: '25.00', custom_delivery_time: 7.5, company: { name: 'Correios' } },
  { id: 3, name: '.Package', custom_price: '19.90', custom_delivery_time: 6, company: { name: 'Jadlog' } },
  { id: 17, name: 'Mini Envios', error: 'Serviço indisponível para o trecho.' },
];

function okFetch(body: unknown = ME_RESPONSE, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  setEnv(BASE_ENV);
  clearQuoteCache();
});

describe('configuração', () => {
  it('exige token e CEP de origem', () => {
    expect(isMelhorEnvioConfigured()).toBe(true);
    setEnv({ ...BASE_ENV, MELHOR_ENVIO_TOKEN: undefined });
    expect(isMelhorEnvioConfigured()).toBe(false);
    setEnv({ ...BASE_ENV, SHIPPING_ORIGIN_CEP: undefined });
    expect(isMelhorEnvioConfigured()).toBe(false);
  });

  it('sem configuração lança NOT_CONFIGURED sem chamar a API', async () => {
    setEnv({ ...BASE_ENV, MELHOR_ENVIO_TOKEN: undefined });
    const fetchImpl = okFetch();
    await expect(quoteMelhorEnvio('01310-100', [item()], { fetchImpl })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('normalizeCep', () => {
  it('aceita com ou sem máscara e recusa tamanho errado', () => {
    expect(normalizeCep('01310-100')).toBe('01310100');
    expect(normalizeCep(' 95700000 ')).toBe('95700000');
    expect(normalizeCep('1234')).toBeNull();
    expect(normalizeCep('013101000')).toBeNull();
  });
});

describe('parseQuoteResponse', () => {
  it('mantém só Correios PAC/Sedex, usa custom_price e ordena pelo preço', () => {
    const options = parseQuoteResponse(ME_RESPONSE);
    expect(options).toEqual([
      { method: 'PAC', serviceId: 1, serviceName: 'PAC', carrier: 'Correios', price: 23.5, deadlineDays: 8 },
      { method: 'SEDEX', serviceId: 2, serviceName: 'SEDEX', carrier: 'Correios', price: 41.3, deadlineDays: 3 },
    ]);
  });

  it('ignora PAC/Sedex com erro ou valores inválidos', () => {
    const options = parseQuoteResponse([
      { id: 1, name: 'PAC', error: 'CEP fora da área' },
      { id: 2, name: 'SEDEX', custom_price: 'abc', custom_delivery_time: 2 },
    ]);
    expect(options).toEqual([]);
  });

  it('resposta que não é lista = BAD_RESPONSE', () => {
    expect(() => parseQuoteResponse({ message: 'erro' })).toThrow(MelhorEnvioError);
  });
});

describe('quoteMelhorEnvio', () => {
  it('monta o payload certo (medidas inteiras, depth → length, só serviços 1 e 2)', async () => {
    const fetchImpl = okFetch();
    await quoteMelhorEnvio('01310-100', [item()], { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://sandbox.melhorenvio.com.br/api/v2/me/shipment/calculate');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-de-teste');
    expect(headers['User-Agent']).toBe('3DCommerce (contato@loja.test)');
    expect(JSON.parse(init.body as string)).toEqual({
      from: { postal_code: '95700000' },
      to: { postal_code: '01310100' },
      products: [{ id: 'p1', width: 21, height: 8, length: 21, weight: 1.25, insurance_value: 129.9, quantity: 2 }],
      options: { receipt: false, own_hand: false },
      services: '1,2',
    });
  });

  it('produto sem peso/medidas = MISSING_PRODUCT_DATA com os ids, sem chamar a API', async () => {
    const fetchImpl = okFetch();
    const err = await quoteMelhorEnvio('01310100', [item(), item({ productId: 'p2', weight: null })], { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(MelhorEnvioError);
    expect(err.code).toBe('MISSING_PRODUCT_DATA');
    expect(err.productIds).toEqual(['p2']);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('CEP inválido = INVALID_CEP', async () => {
    await expect(quoteMelhorEnvio('123', [item()], { fetchImpl: okFetch() })).rejects.toMatchObject({ code: 'INVALID_CEP' });
  });

  it('401 = UNAUTHORIZED; 500 = HTTP_ERROR; JSON inválido = BAD_RESPONSE', async () => {
    await expect(quoteMelhorEnvio('01310100', [item()], { fetchImpl: okFetch({}, 401) })).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    await expect(quoteMelhorEnvio('01310100', [item()], { fetchImpl: okFetch({}, 500) })).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    const badJson = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(quoteMelhorEnvio('01310100', [item()], { fetchImpl: badJson })).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('falha de rede = HTTP_ERROR; demora = TIMEOUT', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(quoteMelhorEnvio('01310100', [item()], { fetchImpl: offline })).rejects.toMatchObject({ code: 'HTTP_ERROR' });

    const slow = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    );
    await expect(
      quoteMelhorEnvio('01310100', [item()], { fetchImpl: slow as unknown as typeof fetch, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('corpo lento depois dos headers também respeita o timeout', async () => {
    const slowBody = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        },
      });
      return new Response(body, { status: 200 });
    });
    await expect(
      quoteMelhorEnvio('01310100', [item()], { fetchImpl: slowBody as unknown as typeof fetch, timeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('chamadas simultâneas iguais fazem UMA ida à API', async () => {
    const fetchImpl = okFetch();
    const [a, b] = await Promise.all([
      quoteMelhorEnvio('01310100', [item()], { fetchImpl }),
      quoteMelhorEnvio('01310-100', [item()], { fetchImpl }),
    ]);
    expect(a).toEqual(b);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('configuração inválida (CEP de origem) desliga a cotação sem chamar a API', async () => {
    setEnv({ ...BASE_ENV, SHIPPING_ORIGIN_CEP: '9570000' });
    expect(isMelhorEnvioConfigured()).toBe(false);
    const fetchImpl = okFetch();
    await expect(quoteMelhorEnvio('01310100', [item()], { fetchImpl })).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('usa o cache por 10 min para o mesmo CEP + carrinho', async () => {
    let t = 1_000_000;
    const now = () => t;
    const fetchImpl = okFetch();

    const first = await quoteMelhorEnvio('01310-100', [item()], { fetchImpl, now });
    const second = await quoteMelhorEnvio('01310100', [item()], { fetchImpl, now });
    expect(second).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Carrinho diferente → nova cotação.
    await quoteMelhorEnvio('01310100', [item({ quantity: 3 })], { fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Expirou → nova cotação.
    t += 10 * 60 * 1000 + 1;
    await quoteMelhorEnvio('01310100', [item()], { fetchImpl, now });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('não guarda no cache cotação sem opções', async () => {
    const fetchImpl = okFetch([]);
    expect(await quoteMelhorEnvio('01310100', [item()], { fetchImpl })).toEqual([]);
    await quoteMelhorEnvio('01310100', [item()], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('token via camada OAuth', () => {
  const withStatus = (status: number) => new Response(JSON.stringify(status === 200 ? ME_RESPONSE : {}), { status });

  it('sem token disponível (OAuth não conectado, sem manual) = NOT_CONFIGURED', async () => {
    const fetchImpl = okFetch();
    await expect(
      quoteMelhorEnvio('01310100', [item()], { fetchImpl, getToken: async () => null }),
    ).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('usa o token OAuth no header', async () => {
    const fetchImpl = okFetch();
    await quoteMelhorEnvio('01310100', [item()], { fetchImpl, getToken: async () => ({ token: 'oauth-1', source: 'oauth' }) });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer oauth-1');
  });

  it('401 com token OAuth: renova UMA vez e repete com o token novo', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(withStatus(401)).mockResolvedValueOnce(withStatus(200));
    const refreshToken = vi.fn(async () => 'oauth-2');
    const r = await quoteMelhorEnvio('01310100', [item()], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: async () => ({ token: 'oauth-1', source: 'oauth' }),
      refreshToken,
    });
    expect(r).toHaveLength(2);
    expect(refreshToken).toHaveBeenCalledWith('oauth-1');
    const auths = fetchImpl.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization);
    expect(auths).toEqual(['Bearer oauth-1', 'Bearer oauth-2']);
  });

  it('401 e renovação falha: UNAUTHORIZED (checkout trata como indisponível)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(withStatus(401));
    await expect(
      quoteMelhorEnvio('01310100', [item()], {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        getToken: async () => ({ token: 'oauth-1', source: 'oauth' }),
        refreshToken: async () => {
          throw new Error('refresh recusado');
        },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('401 com token MANUAL: não tenta renovar', async () => {
    const refreshToken = vi.fn(async () => 'x');
    await expect(
      quoteMelhorEnvio('01310100', [item()], {
        fetchImpl: okFetch({}, 401),
        getToken: async () => ({ token: 'manual', source: 'manual' }),
        refreshToken,
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('camada OAuth indisponível (precisa reconectar): UNAUTHORIZED', async () => {
    await expect(
      quoteMelhorEnvio('01310100', [item()], {
        fetchImpl: okFetch(),
        getToken: async () => {
          throw new Error('needs_reconnect');
        },
      }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });
});
