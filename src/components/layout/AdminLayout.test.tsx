// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { AdminLayout } from './AdminLayout';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/admin', element: <AdminLayout />, children: [{ path: '*', element: <p>Página</p> }, { index: true, element: <p>Início</p> }] }],
    { initialEntries: [path] },
  );
  await act(async () => root.render(<RouterProvider router={router} />));
}
const sidebarWrapper = () => host.querySelector('aside')!.parentElement!;
const menuButton = () => host.querySelector<HTMLButtonElement>('button[aria-label="Menu"]')!;

beforeEach(() => {
  useAdminAuthStore.setState({ isAuthenticated: true });
  window.scrollTo = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it('na lista de produtos a sidebar sai só no desktop largo e o menu fica à mão', async () => {
  await renderAt('/admin/produtos');
  expect(sidebarWrapper().className).toContain('xl:hidden');
  expect(menuButton().className).toContain('xl:inline-flex');
  await act(async () => menuButton().click());
  expect(document.querySelector('[role="dialog"][aria-label="Menu Admin"]')).toBeTruthy();
});

it.each(['/admin/pedidos', '/admin/pdv', '/admin/produtos/novo', '/admin/produtos/abc'])('%s mantém a sidebar', async (path) => {
  await renderAt(path);
  expect(sidebarWrapper().className).not.toContain('xl:hidden');
  expect(menuButton().className).not.toContain('xl:inline-flex');
});
