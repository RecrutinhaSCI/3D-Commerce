// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { customerService } from './customerService';

afterEach(() => vi.unstubAllGlobals());

it('busca de cliente manda o termo no corpo, nunca na URL', async () => {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, data: { customers: [], pagination: {} } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);

  await customerService.list({ search: '529.982.247-25', page: 2, limit: 20 });

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toMatch(/\/api\/admin\/customers\/search$/);
  expect(url).not.toContain('?');
  expect(init.method).toBe('POST');
  expect(JSON.parse(String(init.body))).toEqual({ search: '529.982.247-25', page: 2, limit: 20 });
});
