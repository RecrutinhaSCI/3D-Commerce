import { useCallback, useEffect, useState } from 'react';
import { formatBRL } from '@/utils/price';
import { Package, ShoppingCart, AlertTriangle, DollarSign, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSEO } from '@/utils/seo';
import { StatusBadge } from '@/components/admin/StatusBadge';
import { Button } from '@/components/ui/Button';
import { motion } from 'framer-motion';
import { dashboardService } from '@/services/dashboardService';
import { enumAdapters } from '@/services/adapters';
import { ApiError } from '@/services/api';
import type { ApiDashboard } from '@/services/types';

function Sparkline({ values, color = '#22D3EE' }: { values: number[]; color?: string }) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const w = 100;
  const h = 32;
  const pad = 2;
  const step = (w - pad * 2) / Math.max(values.length - 1, 1);
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / Math.max(max - min, 1)) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-full overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <polygon points={`${pad},${h - pad} ${points} ${w - pad},${h - pad}`} fill={`url(#sg-${color.slice(1)})`} />
    </svg>
  );
}

export default function Dashboard() {
  useSEO('Admin Dashboard');
  const [data, setData] = useState<ApiDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Números SEMPRE do backend (/api/admin/dashboard): receita só de pedidos
  // pagos e não cancelados; séries reais dos últimos 7 dias.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await dashboardService.overview());
      setUpdatedAt(new Date());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar o painel.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const m = data?.metrics;
  const days = data?.last7Days ?? [];
  const recent = data?.recentOrders ?? [];

  const stats = [
    { icon: ShoppingCart, label: 'Pedidos (total)', value: m ? m.totalOrders : '—', color: '#22D3EE', tone: 'bg-cyan-50 text-cyan-700', spark: days.map((d) => d.orders), to: '/admin/pedidos' },
    { icon: DollarSign, label: 'Faturamento do mês (pagos)', value: m ? formatBRL(m.revenueThisMonth) : '—', color: '#10B981', tone: 'bg-emerald-50 text-emerald-700', spark: days.map((d) => d.revenue), to: '/admin/pedidos' },
    { icon: Package, label: 'Produtos ativos', value: m ? m.totalActiveProducts : '—', color: '#A78BFA', tone: 'bg-violet-50 text-violet-700', spark: [] as number[], to: '/admin/produtos' },
    { icon: AlertTriangle, label: 'Estoque baixo (até 5)', value: m ? m.lowStockCount : '—', color: '#F43F5E', tone: 'bg-rose-50 text-rose-700', spark: [] as number[], to: '/admin/produtos?filter=low-stock' },
  ];

  const summary = m
    ? `${m.paidOrdersThisMonth} pedido(s) pago(s) no mês · ticket médio ${formatBRL(m.averageOrderValue)}`
    : 'Carregando dados da loja…';
  const updatedLabel = updatedAt
    ? ` · atualizado às ${updatedAt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    : '';

  return (
    <div>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Painel</p>
          <h1 className="section-title">Visão geral da loja</h1>
          <p className="mt-1 text-sm text-ink-mute">{summary}{updatedLabel}</p>
        </div>
        <Button variant="secondary" size="sm" loading={loading} onClick={load}>
          <RefreshCw className="h-4 w-4" /> Atualizar
        </Button>
      </header>

      {error && (
        <div className="mb-6 rounded-xl bg-rose-50 p-4 text-sm text-rose-600">
          {error}{' '}
          <button onClick={load} className="font-semibold underline">Tentar novamente</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s, i) => (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Link
              to={s.to}
              aria-label={`Ver ${s.label}`}
              className="card block cursor-pointer p-5 transition-all hover:-translate-y-0.5 hover:border-ink/20 hover:shadow-card"
            >
              <div className="flex items-center justify-between">
                <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl ${s.tone}`}>
                  <s.icon className="h-5 w-5" />
                </div>
                {s.spark.length > 0 && <span className="text-[10px] font-semibold text-ink-mute">7 dias</span>}
              </div>
              <p className="mt-4 price-display text-2xl font-bold leading-none">{s.value}</p>
              <p className="mt-1 text-xs text-ink-mute">{s.label}</p>
              {s.spark.length > 0 && (
                <div className="mt-3">
                  <Sparkline values={s.spark} color={s.color} />
                </div>
              )}
            </Link>
          </motion.div>
        ))}
      </div>

      <section className="mt-10">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Últimos pedidos</h2>
          <Link to="/admin/pedidos" className="text-xs font-semibold text-ink-soft hover:text-ink">
            Ver todos →
          </Link>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-bg-soft text-left text-[11px] uppercase tracking-[0.14em] text-ink-mute">
              <tr>
                <th className="px-5 py-3">Pedido</th>
                <th className="px-5 py-3">Cliente</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-line">
              {!loading && recent.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-ink-mute">Sem pedidos ainda.</td></tr>
              )}
              {recent.map((o) => (
                <tr key={o.id} className="transition-colors hover:bg-bg-soft/60">
                  <td className="px-5 py-3 font-semibold tabular-nums">{o.id}</td>
                  <td className="px-5 py-3 text-ink-soft">{o.customerName}</td>
                  <td className="px-5 py-3 tabular-nums">{formatBRL(o.total)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={enumAdapters.orderStatusToInternal(o.status)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
