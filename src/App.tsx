import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { router } from '@/routes/AppRoutes';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { useCustomerAuthStore } from '@/store/useCustomerAuthStore';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { useCartStore } from '@/store/useCartStore';

export default function App() {
  const customLogo = useAdminDataStore((s) => s.settings.logo);
  const bootAdminData = useAdminDataStore((s) => s.refresh);
  const initCustomer = useCustomerAuthStore((s) => s.init);
  const initAdmin = useAdminAuthStore((s) => s.init);
  const fetchCart = useCartStore((s) => s.fetch);
  const resetCart = useCartStore((s) => s.reset);

  // Boot único: reidrata sessões e carrega dados públicos/admin.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([initCustomer(), initAdmin()]);
      if (cancelled) return;
      // Depois de reidratar, o refresh também pega dados admin se logado.
      await bootAdminData();
      // Carrinho vem do backend se cliente logado.
      await fetchCart();
    })();

    function onAuthExpired(e: Event) {
      // Token expirou/rejeitado. Desloga só o escopo que falhou — um 401 numa
      // rota de cliente não pode derrubar o admin logado, e vice-versa.
      const scope = (e as CustomEvent<{ scope?: 'admin' | 'customer' }>).detail?.scope;
      if (scope === 'admin') {
        useAdminAuthStore.getState().logout();
      } else if (scope === 'customer') {
        useCustomerAuthStore.getState().logoutCustomer();
        resetCart();
      } else {
        // Sem escopo (evento legado) — limpa tudo, comportamento antigo.
        useCustomerAuthStore.getState().logoutCustomer();
        useAdminAuthStore.getState().logout();
        resetCart();
      }
    }
    window.addEventListener('auth:expired', onAuthExpired);
    return () => {
      cancelled = true;
      window.removeEventListener('auth:expired', onAuthExpired);
    };
  }, [initCustomer, initAdmin, bootAdminData, fetchCart, resetCart]);

  // Favicon reflete a logo custom quando disponível.
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    if (customLogo) {
      link.type = customLogo.startsWith('data:image/svg') ? 'image/svg+xml' : 'image/png';
      link.href = customLogo;
    } else {
      link.type = 'image/svg+xml';
      link.href = '/favicon.svg';
    }
  }, [customLogo]);

  return (
    <>
      <RouterProvider router={router} />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#0F1115',
            color: '#FAFAF7',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: '14px',
            fontSize: '14px',
            fontWeight: 500,
          },
          success: { iconTheme: { primary: '#22D3EE', secondary: '#0F1115' } },
        }}
      />
    </>
  );
}
