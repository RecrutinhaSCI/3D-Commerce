import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/admin/pdv', label: 'Frente de caixa', end: true },
  { to: '/admin/pdv/historico', label: 'Histórico de caixas' },
  { to: '/admin/pdv/movimentacoes', label: 'Movimentações de estoque' },
];

export function PosNav() {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-ink-line print:hidden">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition ${
              isActive ? 'border-ink text-ink' : 'border-transparent text-ink-mute hover:text-ink'
            }`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
