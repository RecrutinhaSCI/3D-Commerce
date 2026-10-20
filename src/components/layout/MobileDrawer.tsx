import { Link } from 'react-router-dom';
import { Drawer } from '@/components/ui/Drawer';
import { useUIStore } from '@/store/useUIStore';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { LogOut, MessageCircle, Package, Search, ShoppingBag, User, UserPlus } from 'lucide-react';
import { useCurrentCustomer, useCustomerAuthStore } from '@/store/useCustomerAuthStore';
import toast from 'react-hot-toast';
import { whatsappContact } from '@/utils/whatsapp';
import { site } from '@/config/site';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function MobileDrawer() {
  const open = useUIStore((s) => s.mobileMenuOpen);
  const setOpen = useUIStore((s) => s.setMobileMenuOpen);
  const setCartOpen = useUIStore((s) => s.setCartOpen);
  const categories = useAdminDataStore((s) => s.categories);
  const products = useAdminDataStore((s) => s.products);
  // Mesmo critério do mega menu: categoria sem produto ativo não aparece
  // (Ofertas e a sazonal têm recorte próprio e ficam sempre).
  const hasProducts = (id: string) => products.some((p) => p.active && p.categoryIds.includes(id));
  const customer = useCurrentCustomer();
  const logoutCustomer = useCustomerAuthStore((s) => s.logoutCustomer);
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  function close() {
    setOpen(false);
  }

  function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    navigate(`/loja?q=${encodeURIComponent(q.trim())}`);
    close();
  }

  return (
    <Drawer open={open} onClose={close} side="left" title="Menu">
      <div className="p-5">
        <form onSubmit={search} className="mb-5 flex items-center gap-2 rounded-xl border border-ink-line bg-bg-card px-3 py-2.5">
          <Search className="h-4 w-4 text-ink-mute" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar produtos..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </form>

        {customer ? (
          <div className="mb-5 rounded-xl border border-ink-line bg-bg-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-ink-mute">Conectado como</p>
            <p className="mt-1 font-semibold">{customer.name}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link to="/minha-conta" onClick={close} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-1.5 text-xs font-semibold">
                <User className="h-3.5 w-3.5" /> Minha conta
              </Link>
              <Link to="/meus-pedidos" onClick={close} className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-1.5 text-xs font-semibold">
                <Package className="h-3.5 w-3.5" /> Meus pedidos
              </Link>
              <button
                onClick={() => {
                  logoutCustomer();
                  toast.success('Você saiu da conta.');
                  close();
                  navigate('/');
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-1.5 text-xs font-semibold"
              >
                <LogOut className="h-3.5 w-3.5" /> Sair
              </button>
            </div>
          </div>
        ) : (
          <div className="mb-5 grid grid-cols-2 gap-2">
            <Link to="/login" onClick={close} className="btn-secondary !py-2">
              <User className="h-4 w-4" /> Entrar
            </Link>
            <Link to="/criar-conta" onClick={close} className="btn-primary !py-2">
              <UserPlus className="h-4 w-4" /> Criar conta
            </Link>
          </div>
        )}

        <nav className="mb-6 space-y-1 text-sm font-medium">
          <Link to="/" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            Início
          </Link>
          <Link to="/loja" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            Loja
          </Link>
          <Link to="/materiais" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            Materiais
          </Link>
          <Link to="/blog" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            Blog
          </Link>
          <Link to="/sobre" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            Sobre
          </Link>
          <Link to="/contato" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            Contato
          </Link>
          <Link to="/faq" onClick={close} className="block rounded-lg px-3 py-2.5 hover:bg-ink/5">
            FAQ
          </Link>
        </nav>

        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-ink-mute">Categorias</p>
        <div className="mb-6 grid grid-cols-2 gap-2">
          {categories.filter((c) => c.showInMenu && (c.slug === 'ofertas' || c.isSeasonal || hasProducts(c.id))).sort((a, b) => a.order - b.order).map((c) => (
            <Link
              key={c.id}
              to={`/categoria/${c.slug}`}
              onClick={close}
              className="rounded-xl border border-ink-line px-3 py-2.5 text-xs font-semibold text-ink-soft hover:bg-ink/5"
            >
              {c.name}
            </Link>
          ))}
        </div>

        <div className="space-y-2">
          <a
            href={whatsappContact()}
            target="_blank"
            rel="noreferrer"
            className="btn-whatsapp w-full"
            onClick={close}
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp {site.whatsappDisplay}
          </a>
          <button
            onClick={() => {
              setCartOpen(true);
              close();
            }}
            className="btn-secondary w-full"
          >
            <ShoppingBag className="h-4 w-4" /> Ver carrinho
          </button>
        </div>
      </div>
    </Drawer>
  );
}
