import { Hero } from '@/components/home/Hero';
import { PromoCarousel } from '@/components/home/PromoCarousel';
import { CategoryCards } from '@/components/home/CategoryCards';
import { ShowcaseSection } from '@/components/home/ShowcaseSection';
import { SeasonalBanner } from '@/components/home/SeasonalBanner';
import { MaterialsEducation } from '@/components/home/MaterialsEducation';
import { WhyBuy } from '@/components/home/WhyBuy';
import { PhysicalStore } from '@/components/home/PhysicalStore';
import { Testimonials } from '@/components/home/Testimonials';
import { InstagramFeed } from '@/components/home/InstagramFeed';
import { YouTubeSection } from '@/components/home/YouTubeSection';
import { Newsletter } from '@/components/home/Newsletter';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { useSEO } from '@/utils/seo';

export default function Home() {
  useSEO('Tudo para impressão 3D', 'Filamentos, resinas, impressoras 3D e suporte especializado. Loja física em Bento Gonçalves/RS.');
  const products = useAdminDataStore((s) => s.products.filter((p) => p.active));

  const highlights = products.filter((p) => p.isHighlight);
  const offers = products.filter((p) => p.isOffer);
  const bestSellers = products.filter((p) => p.isBestSeller);

  return (
    <>
      <Hero />
      <PromoCarousel />
      <CategoryCards />
      <ShowcaseSection eyebrow="Em destaque" title="Os produtos do momento" ctaTo="/loja" products={highlights} />
      <ShowcaseSection eyebrow="Ofertas" title="Selecionados em promoção" ctaTo="/categoria/ofertas" products={offers} />
      <SeasonalBanner />
      <ShowcaseSection eyebrow="Mais vendidos" title="Quem chega leva" ctaTo="/loja" products={bestSellers} />
      <MaterialsEducation />
      <WhyBuy />
      <Testimonials />
      <PhysicalStore />
      <InstagramFeed />
      <YouTubeSection />
      <Newsletter />
    </>
  );
}
