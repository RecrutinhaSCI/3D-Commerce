import { ExternalLink, MapPin, MessageCircle } from 'lucide-react';
import { whatsappContact } from '@/utils/whatsapp';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { site } from '@/config/site';

export function PhysicalStore() {
  const settings = useAdminDataStore((s) => s.settings);
  // Iframe usa a URL de embed dedicada (foca no L'América Shopping Center).
  // Links externos (âncora envolvendo o iframe + botão abaixo) usam `site.mapsUrl`.
  const mapsEmbed = site.mapsEmbedUrl;
  return (
    <section className="container-x py-16">
      <div className="grid grid-cols-1 gap-8 rounded-3xl border border-ink-line bg-bg-card p-6 md:grid-cols-2 md:p-10">
        <div>
          <p className="eyebrow">Visite-nos</p>
          <h2 className="section-title">Loja física em Bento Gonçalves</h2>
          <p className="mt-4 text-sm leading-relaxed text-ink-mute">
            Conheça todos os filamentos, veja as impressoras 3D em funcionamento e tire dúvidas com nossa equipe técnica.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            <li>
              <a
                href={site.mapsUrl}
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Abrir endereço no Google Maps"
                className="group inline-flex items-start gap-2 text-ink-soft transition hover:text-ink"
              >
                <MapPin className="mt-0.5 h-4 w-4 text-ink-mute group-hover:text-ink" />
                <span>{settings.address}</span>
              </a>
            </li>
            <li className="flex items-start gap-2 text-ink-soft">
              <MessageCircle className="mt-0.5 h-4 w-4 text-emerald-500" />
              Atendimento de segunda a sábado
            </li>
          </ul>
          <div className="mt-7 flex flex-wrap gap-2">
            <a href={whatsappContact()} target="_blank" rel="noreferrer noopener" className="btn-whatsapp">
              <MessageCircle className="h-4 w-4" /> Falar com a loja
            </a>
            <a
              href={site.mapsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="btn-secondary"
              aria-label="Abrir localização no Google Maps"
            >
              <MapPin className="h-4 w-4" /> Abrir no Google Maps
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </a>
          </div>
        </div>

        <a
          href={site.mapsUrl}
          target="_blank"
          rel="noreferrer noopener"
          aria-label="Ver localização no Google Maps"
          className="group relative block min-h-[280px] overflow-hidden rounded-2xl border border-ink-line bg-ink"
        >
          <iframe
            title="Localização da 3DCommerce no Google Maps"
            src={mapsEmbed}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="absolute inset-0 h-full w-full border-0 grayscale-[20%] transition group-hover:grayscale-0"
            aria-hidden="true"
          />
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-bg px-3 py-1.5 text-[11px] font-bold text-ink shadow-xl">
            <ExternalLink className="h-3 w-3" /> Ver no Google Maps
          </span>
        </a>
      </div>
    </section>
  );
}
