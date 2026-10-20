import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Carousel } from '@/components/ui/Carousel';

const items = [
  {
    name: 'PLA',
    desc: 'Fácil de imprimir e ideal para iniciantes. Excelente para protótipos e itens decorativos.',
    color: '#22D3EE',
  },
  {
    name: 'PETG',
    desc: 'Resistência mecânica e química, acabamento brilhante. Bom para peças funcionais.',
    color: '#34D399',
  },
  {
    name: 'ABS',
    desc: 'Alta resistência térmica e mecânica. Indicado para peças funcionais sob calor.',
    color: '#F472B6',
  },
  {
    name: 'Resina',
    desc: 'Detalhamento extremo para impressoras LCD/SLA. Ideal para miniaturas e jóias.',
    color: '#A78BFA',
  },
];

export function MaterialsEducation() {
  return (
    <section className="bg-bg-soft py-20">
      <div className="container-x">
        <div className="mb-10 max-w-2xl">
          <p className="eyebrow">Materiais explicados</p>
          <h2 className="section-title">Em dúvida sobre qual material usar?</h2>
          <p className="mt-3 text-base text-ink-mute">
            Conheça os principais filamentos e resinas que trabalhamos e escolha o que combina com o seu projeto.
          </p>
        </div>
        <Carousel ariaLabel="Materiais" itemClassName="w-[78%] sm:w-[45%] lg:w-[24%]">
          {items.map((it, i) => (
            <motion.div
              key={it.name}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="group h-full rounded-2xl border border-ink-line/70 bg-bg-card p-6 transition-all hover:-translate-y-1 hover:border-ink/20 hover:shadow-card"
            >
              <span className="block h-2 w-14 rounded-full transition-all group-hover:w-20" style={{ background: it.color }} />
              <h3 className="mt-5 font-display text-2xl font-bold">{it.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink-mute">{it.desc}</p>
            </motion.div>
          ))}
        </Carousel>
        <div className="mt-6">
          <Link to="/materiais" className="text-sm font-semibold text-ink hover:underline">
            Ver guia completo de materiais →
          </Link>
        </div>
      </div>
    </section>
  );
}
