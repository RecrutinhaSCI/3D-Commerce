import { ExternalLink, LogOut, Menu } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import toast from 'react-hot-toast';

export function AdminHeader({ onMenu, menuOnWide = false }: { onMenu?: () => void; menuOnWide?: boolean }) {
  const email = useAdminAuthStore((s) => s.email);
  const logout = useAdminAuthStore((s) => s.logout);
  const resetAll = useAdminDataStore((s) => s.resetAll);
  return (
    <header className="sticky top-0 z-30 border-b border-ink-line bg-bg/90 backdrop-blur print:hidden">
      <div className="flex h-14 items-center justify-between gap-3 px-5">
        <div className="flex items-center gap-2">
          {onMenu && (
            <button
              className={`rounded-lg p-2 hover:bg-ink/5 lg:hidden ${menuOnWide ? 'xl:inline-flex xl:items-center xl:gap-1.5' : ''}`}
              onClick={onMenu}
              aria-label="Menu"
            >
              <Menu className="h-5 w-5" />
              {menuOnWide && <span className="hidden text-xs font-semibold xl:inline">Menu</span>}
            </button>
          )}
          <p className="text-xs text-ink-mute">Logado como <strong className="text-ink">{email}</strong></p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/" target="_blank" className="hidden text-xs text-ink-soft hover:text-ink md:inline-flex md:items-center md:gap-1">
            Ver loja <ExternalLink className="h-3 w-3" />
          </Link>
          <button
            onClick={() => {
              resetAll();
              toast.success('Dados restaurados ao padrão.');
            }}
            className="rounded-lg border border-ink-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-ink/5"
          >
            Restaurar dados
          </button>
          <button onClick={logout} className="rounded-lg p-2 hover:bg-ink/5 lg:hidden" aria-label="Sair">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
