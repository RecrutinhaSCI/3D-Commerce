import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Tags,
  Sparkles,
  Image,
  ShoppingCart,
  Settings,
  LogOut,
  FileText,
  MessageSquareQuote,
  Ticket,
  MessageCircle,
  Mail,
  type LucideIcon,
} from 'lucide-react';
import { useAdminAuthStore } from '@/store/useAdminAuthStore';
import { Logo } from '@/components/ui/Logo';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

// Menu lateral agrupado por seções (R12).
// "Novo produto" removido — a criação continua acessível dentro de Produtos.
const groups: NavGroup[] = [
  {
    title: 'Geral',
    items: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    title: 'Catálogo',
    items: [
      { to: '/admin/produtos', label: 'Produtos', icon: Package },
      { to: '/admin/categorias', label: 'Categorias', icon: Tags },
      { to: '/admin/categoria-sazonal', label: 'Categoria Sazonal', icon: Sparkles },
      { to: '/admin/banners', label: 'Banners', icon: Image },
    ],
  },
  {
    title: 'Vendas',
    items: [
      { to: '/admin/pedidos', label: 'Pedidos', icon: ShoppingCart },
      { to: '/admin/orcamentos', label: 'Orçamentos', icon: FileText },
      { to: '/admin/mensagens', label: 'Mensagens', icon: Mail },
      { to: '/admin/cupons', label: 'Cupons', icon: Ticket },
    ],
  },
  {
    title: 'Conteúdo',
    items: [
      { to: '/admin/depoimentos', label: 'Depoimentos', icon: MessageSquareQuote },
      { to: '/admin/scripts', label: 'Scripts', icon: MessageCircle },
    ],
  },
  {
    title: 'Sistema',
    items: [{ to: '/admin/configuracoes', label: 'Configurações', icon: Settings }],
  },
];

interface Props {
  onNavigate?: () => void;
  variant?: 'desktop' | 'mobile';
}

export function AdminSidebar({ onNavigate, variant = 'desktop' }: Props) {
  const logout = useAdminAuthStore((s) => s.logout);
  const isDesktop = variant === 'desktop';
  return (
    <aside
      className={
        isDesktop
          ? 'sticky top-0 hidden h-screen w-64 flex-shrink-0 border-r border-ink-line bg-bg-card lg:flex lg:flex-col'
          : 'flex h-full flex-col bg-bg-card'
      }
    >
      {isDesktop && (
        <div className="border-b border-ink-line px-5 py-4">
          <Logo />
          <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-ink-mute">Admin</p>
        </div>
      )}
      <nav className="flex-1 space-y-4 overflow-y-auto p-3">
        {groups.map((group) => (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-mute">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                      isActive ? 'bg-ink text-bg' : 'text-ink-soft hover:bg-ink/5 hover:text-ink'
                    }`
                  }
                >
                  <it.icon className="h-4 w-4" />
                  {it.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <button
        onClick={() => {
          logout();
          onNavigate?.();
        }}
        className="m-3 flex items-center gap-2 rounded-lg border border-ink-line px-3 py-2 text-sm text-ink-soft hover:bg-ink/5"
      >
        <LogOut className="h-4 w-4" /> Sair
      </button>
    </aside>
  );
}
