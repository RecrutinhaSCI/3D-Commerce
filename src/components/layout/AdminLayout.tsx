import { Outlet, ScrollRestoration, Navigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { Drawer } from '@/components/ui/Drawer';

export function AdminLayout() {
  const isAuth = useAdminAuthStore((s) => s.isAuthenticated);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  // Lista + editor lado a lado (só de xl para cima, ver Products): a sidebar sai
  // da largura e o menu continua a um clique, no mesmo Drawer do celular.
  const productsWorkspace = /^\/admin\/produtos\/?$/.test(pathname);
  useEffect(() => setMobileOpen(false), [pathname]);
  if (!isAuth) return <Navigate to="/admin/login" replace />;
  return (
    <div className="flex min-h-screen bg-bg-soft">
      <div className={productsWorkspace ? 'contents xl:hidden' : 'contents'}>
        <AdminSidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminHeader onMenu={() => setMobileOpen(true)} menuOnWide={productsWorkspace} />
        <main className="flex-1 p-5 lg:p-7">
          <Outlet />
        </main>
      </div>
      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" title="Menu Admin">
        <AdminSidebar variant="mobile" onNavigate={() => setMobileOpen(false)} />
      </Drawer>
      <ScrollRestoration />
    </div>
  );
}
