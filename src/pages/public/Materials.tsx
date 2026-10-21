import { Link } from 'react-router-dom';
import { useSEO } from '@/utils/seo';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { categoryPath, findMaterialCategory } from '@/utils/categoryGroups';

/**
 * Conteúdo editorial por material. O LINK não é fixo: vem da categoria real
 * do admin cujo nome corresponde ao material ("Filamentos PLA" → PLA). Sem
 * categoria ativa correspondente, o botão não aparece (nada de 404).
 */
const materials = [
  {
    name: 'PLA',
    color: '#22D3EE',
    intro: 'O filamento mais usado no mundo. Fácil de imprimir, biodegradável, ótimo acabamento.',
    bestFor: 'Iniciantes, peças decorativas, protótipos e brinquedos.',
    avoid: 'Peças expostas ao sol direto ou a temperaturas acima de 60°C.',
  },
  {
    name: 'PETG',
    color: '#34D399',
    intro: 'Equilíbrio entre PLA e ABS. Mais resistente, brilhante e bom para peças funcionais.',
    bestFor: 'Suportes, peças mecânicas leves, embalagens, projetos ao ar livre.',
    avoid: 'Pode ser pegajoso na adesão se mal calibrado.',
  },
  {
    name: 'ABS',
    color: '#F472B6',
    intro: 'Material clássico da indústria. Resistente ao calor e a impactos, exige câmara fechada.',
    bestFor: 'Peças funcionais, componentes automotivos, eletrônicos.',
    avoid: 'Iniciantes sem câmara fechada — sofre com contração e odor.',
  },
  {
    name: 'ASA',
    color: '#F59E0B',
    intro: 'Parente do ABS com resistência a raios UV e ao tempo. Mantém cor e forma ao ar livre.',
    bestFor: 'Peças externas, suportes, carenagens e componentes expostos ao sol.',
    avoid: 'Impressoras abertas e sem ventilação — exige câmara fechada e local arejado.',
  },
  {
    name: 'TPU',
    color: '#FB7185',
    intro: 'Filamento flexível e emborrachado, com ótima resistência a impacto e desgaste.',
    bestFor: 'Capas, vedações, amortecedores, pneus e peças que precisam dobrar.',
    avoid: 'Velocidade alta e extrusoras Bowden longas — imprima devagar.',
  },
  {
    name: 'Resina',
    color: '#A78BFA',
    intro: 'Para impressoras LCD/SLA. Resolução excepcional, ideal para miniaturas.',
    bestFor: 'Miniaturas, jóias, modelos dentais, brinquedos detalhados.',
    avoid: 'Requer EPI, lavagem e cura UV no pós-processo.',
  },
];

export default function Materials() {
  useSEO('Materiais e aplicações');
  const categories = useAdminDataStore((s) => s.categories);
  return (
    <div className="container-x py-12">
      <header className="max-w-3xl">
        <p className="eyebrow">Guia</p>
        <h1 className="section-title">Materiais e aplicações</h1>
        <p className="mt-4 text-base leading-relaxed text-ink-mute">
          Um guia rápido para você escolher o material certo para o seu projeto.
        </p>
      </header>

      <div className="mt-10 space-y-6">
        {materials.map((m) => {
          const category = findMaterialCategory(categories, m.name);
          const image = category?.image;
          return (
          <article
            key={m.name}
            className={`group card overflow-hidden transition-shadow hover:shadow-card ${
              image ? 'md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]' : ''
            }`}
          >
            {/* Imagem = a da categoria do material (Admin → Categorias). Sem imagem, layout só texto. */}
            {image && (
              <div className="relative aspect-[16/9] overflow-hidden bg-bg-soft md:aspect-auto md:h-full">
                <img
                  src={image}
                  alt={`Filamento ${m.name}`}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
            )}
            <div className="p-6 md:p-8">
              <div className="flex items-center gap-3">
                <span className="h-3 w-14 rounded-full transition-all group-hover:w-20" style={{ background: m.color }} />
                <h2 className="font-display text-2xl font-bold tracking-tight">{m.name}</h2>
              </div>
              <p className="mt-3 text-ink-soft">{m.intro}</p>
              <div className={`mt-5 grid grid-cols-1 gap-4 ${image ? 'lg:grid-cols-2' : 'md:grid-cols-2'}`}>
                <div className="rounded-xl bg-bg-soft p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-emerald-600">Indicado para</p>
                  <p className="mt-1 text-sm">{m.bestFor}</p>
                </div>
                <div className="rounded-xl bg-bg-soft p-4">
                  <p className="text-xs font-bold uppercase tracking-widest text-rose-500">Evitar</p>
                  <p className="mt-1 text-sm">{m.avoid}</p>
                </div>
              </div>
              {category && (
                <Link to={categoryPath(category.slug)} className="btn-secondary mt-5">
                  Ver produtos de {m.name}
                </Link>
              )}
            </div>
          </article>
          );
        })}
      </div>
    </div>
  );
}
