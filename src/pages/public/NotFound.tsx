import { Link, Navigate, useLocation } from 'react-router-dom';
import { useSEO } from '@/utils/seo';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { categoryPath } from '@/utils/categoryGroups';

export default function NotFound() {
  useSEO('Página não encontrada');
  const { pathname } = useLocation();
  // Link de categoria sem o prefixo (/filamentos-abs) → rota canônica.
  // Só para um slug que existe de fato; o resto continua 404.
  const single = /^\/([a-z0-9-]+)\/?$/.exec(pathname)?.[1];
  const category = useAdminDataStore((s) =>
    single ? s.categories.find((c) => c.slug === single && c.active !== false) : undefined,
  );
  if (category) return <Navigate to={categoryPath(category.slug)} replace />;
  return (
    <div className="container-x flex flex-col items-center justify-center py-24 text-center">
      <p className="font-display text-7xl font-bold text-ink-mute">404</p>
      <h1 className="mt-3 text-2xl font-bold">Página não encontrada</h1>
      <p className="mt-2 text-sm text-ink-mute">A página que você procura pode ter sido movida ou não existe mais.</p>
      <Link to="/" className="btn-primary mt-6">
        Voltar para a Home
      </Link>
    </div>
  );
}
