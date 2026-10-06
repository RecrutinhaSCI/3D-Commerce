import { Link } from 'react-router-dom';
import { ShoppingBag, CreditCard, Truck, MessageCircle } from 'lucide-react';
import { useSEO } from '@/utils/seo';
import { site } from '@/config/site';

const steps = [
  { icon: ShoppingBag, title: 'Escolha seu produto', desc: 'Use a busca, filtros ou navegue pelas categorias para encontrar o que precisa.' },
  { icon: CreditCard, title: 'Finalize com segurança', desc: `Pix com desconto, cartão de crédito em até ${site.installments.max}x${site.installments.interestFree ? ' sem juros' : ''} ou boleto. Cupons e frete grátis automáticos.` },
  { icon: Truck, title: 'Receba em casa', desc: 'Despachamos para todo o Brasil. Você acompanha cada etapa do seu pedido.' },
  { icon: MessageCircle, title: 'Suporte completo', desc: 'Antes, durante e depois — nossa equipe está no WhatsApp para te ajudar.' },
];

export default function HowToBuy() {
  useSEO('Como comprar');
  return (
    <div className="container-x py-12">
      <header className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Guia</p>
        <h1 className="mt-2 font-display text-4xl font-bold">Como comprar na 3DCommerce</h1>
        <p className="mt-3 text-ink-mute">Em 4 passos simples você recebe seu pedido com segurança e qualidade.</p>
      </header>

      <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="card p-6">
            <p className="text-xs font-bold uppercase tracking-widest text-ink-mute">Passo {i + 1}</p>
            <div className="mt-2 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-ink text-bg">
              <s.icon className="h-5 w-5" />
            </div>
            <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
            <p className="mt-1 text-sm text-ink-mute">{s.desc}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8">
        <Link to="/loja" className="btn-primary">
          Ir para a loja
        </Link>
      </div>
    </div>
  );
}
