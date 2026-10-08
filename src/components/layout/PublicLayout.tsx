import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { Topbar } from './Topbar';
import { Header } from './Header';
import { Footer } from './Footer';
import { MobileDrawer } from './MobileDrawer';
import { WhatsappFloating } from './WhatsappFloating';
import { CookieBanner } from './CookieBanner';
import { CartDrawer } from '@/components/cart/CartDrawer';
import { useUIStore } from '@/store/useUIStore';
import { trackPageView } from '@/lib/analytics';

export function PublicLayout() {
  const { pathname } = useLocation();
  const setCartOpen = useUIStore((s) => s.setCartOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);

  // Fecha drawers ao navegar e rola para o topo (instantâneo, sem jank visual)
  useEffect(() => {
    setCartOpen(false);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, setCartOpen, setMobileMenuOpen]);

  // page_view da SPA (no-op sem GA configurado ou sem consentimento).
  // Pequeno atraso para o título da página (useSEO) já estar aplicado.
  useEffect(() => {
    const t = window.setTimeout(() => trackPageView(pathname), 300);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return (
    // overflow-x-clip: contém qualquer transbordo horizontal de elementos
    // decorativos (blobs) sem afetar rolagem vertical nem sticky (R17).
    <div className="flex min-h-screen flex-col overflow-x-clip">
      <Topbar />
      <Header />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <MobileDrawer />
      <CartDrawer />
      <WhatsappFloating />
      <CookieBanner />
      <ScrollRestoration />
    </div>
  );
}
