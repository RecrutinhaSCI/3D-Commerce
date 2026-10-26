import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Menu, Search, ShoppingBag, MessageCircle, ChevronDown, X, User, LogOut, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCurrentCustomer, useCustomerAuthStore } from '@/store/useCustomerAuthStore';
import toast from 'react-hot-toast';
import { useState, useEffect, useRef } from 'react';
import { Logo } from '@/components/ui/Logo';
import { useUIStore } from '@/store/useUIStore';
import { useCartStore } from '@/store/useCartStore';
import { whatsappContact } from '@/utils/whatsapp';
import { MegaMenu } from './MegaMenu';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { categoryPath, showsInMenu } from '@/utils/categoryGroups';
import { seasonalTheme } from '@/utils/seasonalTheme';

export function Header() {
  const setCartOpen = useUIStore((s) => s.setCartOpen);
  const setMobileMenuOpen = useUIStore((s) => s.setMobileMenuOpen);
  const count = useCartStore((s) => s.count());
  const categories = useAdminDataStore((s) => s.categories);
  const seasonal = categories.find((c) => c.isSeasonal && c.seasonalActive && showsInMenu(c));

  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const shopActive = location.pathname === '/loja' || location.pathname.startsWith('/categoria/') || location.pathname.startsWith('/produto/');
  const customer = useCurrentCustomer();
  const logoutCustomer = useCustomerAuthStore((s) => s.logoutCustomer);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  // Timer de fechamento por hover — evita que o dropdown suma ao mover o mouse
  // do botão até o menu (atravessando o pequeno gap entre eles).
  const accountCloseTimer = useRef<number | null>(null);
  function openAccount() {
    if (accountCloseTimer.current !== null) {
      window.clearTimeout(accountCloseTimer.current);
      accountCloseTimer.current = null;
    }
    setAccountOpen(true);
  }
  function scheduleCloseAccount() {
    if (accountCloseTimer.current !== null) window.clearTimeout(accountCloseTimer.current);
    accountCloseTimer.current = window.setTimeout(() => {
      setAccountOpen(false);
      accountCloseTimer.current = null;
    }, 180);
  }

  useEffect(() => {
    if (!accountOpen) return;
    function onDocClick(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setAccountOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountOpen]);

  useEffect(() => () => {
    if (accountCloseTimer.current !== null) window.clearTimeout(accountCloseTimer.current);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (searchValue.trim()) {
      navigate(`/loja?q=${encodeURIComponent(searchValue.trim())}`);
      setShowSearch(false);
    }
  }

  const closeTimer = useRef<number | null>(null);
  function openMega() {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setMenuOpen(true);
  }
  function scheduleCloseMega() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setMenuOpen(false);
      closeTimer.current = null;
    }, 160);
  }
  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div className={`sticky top-0 z-40 bg-bg/90 backdrop-blur transition-shadow ${scrolled ? 'shadow-soft' : ''}`}>
      <div className="relative">
        <div className="container-x flex h-16 items-center gap-4 lg:h-20">
          <button
            className="rounded-lg p-2 hover:bg-ink/5 lg:hidden"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          <Logo />

          <nav className="ml-8 hidden flex-1 items-center gap-7 lg:flex">
            <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'text-ink' : ''}`}>
              Início
            </NavLink>
            <button
              className={`nav-link inline-flex items-center gap-1 ${shopActive ? 'text-ink' : ''}`}
              onMouseEnter={openMega}
              onMouseLeave={scheduleCloseMega}
              onClick={() => (menuOpen ? setMenuOpen(false) : openMega())}
              aria-expanded={menuOpen}
              aria-haspopup="true"
            >
              Loja <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <NavLink to="/materiais" className={({ isActive }) => `nav-link ${isActive ? 'text-ink' : ''}`}>
              Materiais
            </NavLink>
            <NavLink to="/blog" className={({ isActive }) => `nav-link ${isActive ? 'text-ink' : ''}`}>
              Blog
            </NavLink>
            {seasonal && (
              // Cor da campanha (Admin → Categoria sazonal), com contraste AA
              // sobre o fundo claro; o sublinhado do nav-link segue a mesma cor.
              <NavLink
                to={categoryPath(seasonal.slug)}
                data-seasonal-link="header"
                className={({ isActive }) => `nav-link font-semibold hover:opacity-80 ${isActive ? 'after:!w-full' : ''}`}
                style={{ color: seasonalTheme(seasonal.seasonalColors).accent }}
              >
                {seasonal.name}
              </NavLink>
            )}
            <NavLink to="/sobre" className={({ isActive }) => `nav-link ${isActive ? 'text-ink' : ''}`}>
              Sobre
            </NavLink>
            <NavLink to="/contato" className={({ isActive }) => `nav-link ${isActive ? 'text-ink' : ''}`}>
              Contato
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              className="hidden rounded-lg p-2 text-ink-soft hover:bg-ink/5 hover:text-ink md:inline-flex"
              onClick={() => setShowSearch((v) => !v)}
              aria-label="Buscar"
            >
              <Search className="h-5 w-5" />
            </button>
            <a
              href={whatsappContact()}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg p-2 text-ink-soft hover:bg-ink/5 hover:text-emerald-600 md:inline-flex"
              aria-label="WhatsApp"
            >
              <MessageCircle className="h-5 w-5" />
            </a>
            {customer ? (
              <div
                ref={accountRef}
                className="relative"
                onMouseEnter={openAccount}
                onMouseLeave={scheduleCloseAccount}
              >
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink"
                  aria-label={`Conta de ${customer.name}`}
                  aria-expanded={accountOpen}
                  aria-haspopup="menu"
                  onClick={() => setAccountOpen((v) => !v)}
                >
                  <User className="h-4 w-4" />
                  <span className="hidden lg:inline">{customer.name.split(' ')[0]}</span>
                  <ChevronDown className="hidden h-3.5 w-3.5 lg:inline" />
                </button>
                {accountOpen && (
                  <div className="absolute right-0 top-full z-30 mt-1 w-52 overflow-hidden rounded-xl border border-ink-line bg-bg-card shadow-card">
                    <Link
                      to="/minha-conta"
                      onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-bg-soft"
                    >
                      <User className="h-4 w-4 text-ink-mute" /> Minha conta
                    </Link>
                    <Link
                      to="/meus-pedidos"
                      onClick={() => setAccountOpen(false)}
                      className="flex items-center gap-2 px-4 py-2.5 text-sm hover:bg-bg-soft"
                    >
                      <Package className="h-4 w-4 text-ink-mute" /> Meus pedidos
                    </Link>
                    <button
                      onClick={() => {
                        logoutCustomer();
                        toast.success('Você saiu da conta.');
                        setAccountOpen(false);
                        navigate('/');
                      }}
                      className="flex w-full items-center gap-2 border-t border-ink-line px-4 py-2.5 text-left text-sm hover:bg-bg-soft"
                    >
                      <LogOut className="h-4 w-4 text-ink-mute" /> Sair
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                to="/login"
                className="hidden items-center gap-1.5 rounded-lg px-2 py-2 text-sm font-semibold text-ink-soft hover:bg-ink/5 hover:text-ink md:inline-flex"
                aria-label="Entrar"
              >
                <User className="h-4 w-4" /> <span className="hidden lg:inline">Entrar</span>
              </Link>
            )}

            <button
              onClick={() => setCartOpen(true)}
              className="relative rounded-lg p-2 text-ink-soft hover:bg-ink/5 hover:text-ink"
              aria-label="Carrinho"
            >
              <ShoppingBag className="h-5 w-5" />
              {count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-bg">
                  {count}
                </span>
              )}
            </button>
          </div>
        </div>

        <MegaMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          onMouseEnter={openMega}
          onMouseLeave={scheduleCloseMega}
        />

        {showSearch && (
          <div className="border-t border-ink-line bg-bg-card">
            <form onSubmit={handleSearch} className="container-x flex h-14 items-center gap-3">
              <Search className="h-5 w-5 text-ink-mute" />
              <input
                autoFocus
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Buscar produto, material, cor ou marca..."
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-mute"
              />
              <button type="button" onClick={() => setShowSearch(false)} aria-label="Fechar busca">
                <X className="h-5 w-5 text-ink-mute" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

