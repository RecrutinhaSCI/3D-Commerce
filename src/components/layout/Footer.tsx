import { Link } from 'react-router-dom';
import { Logo } from '@/components/ui/Logo';
import { Instagram, Mail, MapPin, MessageCircle, ShieldCheck, Truck, Wrench, Youtube } from 'lucide-react';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { whatsappContact } from '@/utils/whatsapp';
import { site } from '@/config/site';
import { FILAMENTS_GROUP_PATH, categoryPath, isFilamentCategory, isMaterialCategory, showsInMenu } from '@/utils/categoryGroups';

export function Footer() {
  const settings = useAdminDataStore((s) => s.settings);
  const categories = useAdminDataStore((s) => s.categories);
  const products = useAdminDataStore((s) => s.products);
  // Mesma regra do mega menu: sem produto ativo não aparece (Ofertas é virtual).
  const hasProducts = (id: string) => products.some((p) => p.active && p.categoryIds.includes(id));
  const visible = categories.filter(
    (c) => showsInMenu(c) && !c.isSeasonal && (c.slug === 'ofertas' || hasProducts(c.id)),
  );
  const hasFilaments = visible.some(isFilamentCategory);
  // Tipos de produto (ex.: Impressoras 3D) + Ofertas; materiais ficam no "Filamentos".
  const footerCats = visible
    .filter((c) => !isMaterialCategory(c))
    .sort((a, b) => Number(a.slug === 'ofertas') - Number(b.slug === 'ofertas'));
  return (
    <footer className="mt-20 border-t border-ink-line bg-bg-card">
      <div className="container-x grid grid-cols-1 gap-10 py-12 md:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-4 text-sm leading-relaxed text-ink-mute">
            {settings.footerDescription ||
              'Especialistas em impressoras 3D, filamentos, resinas e acessórios. Loja física em Bento Gonçalves e envio para todo o Brasil.'}
          </p>
          {settings.footerShowSocials && (
            <div className="mt-5 flex items-center gap-3">
              {settings.instagram && (
                <a
                  href={settings.instagram}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full border border-ink-line p-2 text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                  aria-label="Seguir no Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </a>
              )}
              {settings.youtubeUrl && (
                <a
                  href={settings.youtubeUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-full border border-ink-line p-2 text-ink-soft transition hover:bg-rose-50 hover:text-rose-600"
                  aria-label="Assistir no YouTube"
                >
                  <Youtube className="h-4 w-4" />
                </a>
              )}
              <a
                href={whatsappContact()}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-ink-line p-2 text-ink-soft transition hover:bg-emerald-50 hover:text-emerald-600"
                aria-label="Falar pelo WhatsApp"
              >
                <MessageCircle className="h-4 w-4" />
              </a>
              <a
                href={`mailto:${settings.email}`}
                className="rounded-full border border-ink-line p-2 text-ink-soft transition hover:bg-ink/5 hover:text-ink"
                aria-label="Enviar e-mail"
              >
                <Mail className="h-4 w-4" />
              </a>
            </div>
          )}
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-mute">Loja</p>
          <ul className="space-y-2 text-sm">
            <li><Link to="/loja" className="text-ink-soft transition hover:text-ink">Todos os produtos</Link></li>
            {/* Links das categorias REAIS do admin (antes: /categoria/pla, que não existe). */}
            {hasFilaments && (
              <li><Link to={FILAMENTS_GROUP_PATH} className="text-ink-soft transition hover:text-ink">Filamentos</Link></li>
            )}
            {footerCats.map((c) => (
              <li key={c.id}>
                <Link to={categoryPath(c.slug)} className="text-ink-soft transition hover:text-ink">{c.name}</Link>
              </li>
            ))}
            <li><Link to="/orcamento" className="text-ink-soft transition hover:text-ink">Pedir orçamento</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-mute">Institucional</p>
          <ul className="space-y-2 text-sm">
            <li><Link to="/sobre" className="text-ink-soft transition hover:text-ink">Sobre a 3DCommerce</Link></li>
            <li><Link to="/como-comprar" className="text-ink-soft transition hover:text-ink">Como comprar</Link></li>
            <li><Link to="/trocas-devolucoes" className="text-ink-soft transition hover:text-ink">Trocas e devoluções</Link></li>
            <li><Link to="/privacidade" className="text-ink-soft transition hover:text-ink">Política de privacidade</Link></li>
            <li><Link to="/faq" className="text-ink-soft transition hover:text-ink">Perguntas frequentes</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-ink-mute">Atendimento</p>
          <ul className="space-y-3 text-sm">
            <li>
              <a
                href={site.mapsUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Abrir endereço no Google Maps"
                className="group flex items-start gap-2.5 text-ink-soft transition hover:text-ink"
              >
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-mute group-hover:text-ink" />
                <span className="leading-relaxed">{settings.address}</span>
              </a>
            </li>
            <li>
              <a
                href={whatsappContact()}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={`WhatsApp ${site.whatsappDisplay}`}
                className="group flex items-start gap-2.5 text-ink-soft transition hover:text-emerald-600"
              >
                <MessageCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-mute group-hover:text-emerald-600" />
                <span>{site.whatsappDisplay}</span>
              </a>
            </li>
            <li>
              <a
                href={`mailto:${settings.email}`}
                aria-label={`Enviar e-mail para ${settings.email}`}
                className="group flex items-start gap-2.5 text-ink-soft transition hover:text-ink"
              >
                <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-mute group-hover:text-ink" />
                <span>{settings.email}</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-ink-line">
        <div className="container-x grid grid-cols-2 gap-4 py-6 text-xs text-ink-mute md:grid-cols-4">
          <span className="inline-flex items-center gap-1.5"><Truck className="h-3.5 w-3.5" /> Envio para todo o Brasil</span>
          <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Compra segura</span>
          <span className="inline-flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5" /> Suporte técnico</span>
          <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Loja física {site.city}</span>
        </div>
      </div>

      <div className="border-t border-ink-line bg-bg">
        <div className="container-x flex flex-col items-start gap-1 py-5 text-[11px] text-ink-mute md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} 3DCommerce. CNPJ {settings.cnpj}. Todos os direitos reservados.</p>
          <p>Desenvolvido por G-Rec Company.</p>
        </div>
      </div>
    </footer>
  );
}
