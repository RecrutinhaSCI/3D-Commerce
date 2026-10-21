import { Navigate, useParams } from 'react-router-dom';
import Shop from './Shop';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import { useSEO } from '@/utils/seo';
import { categoryPath, resolveCategoryAlias } from '@/utils/categoryGroups';

export default function Category() {
  const { slug } = useParams();
  const categories = useAdminDataStore((s) => s.categories);
  const category = categories.find((c) => c.slug === slug);
  // URL antiga (/categoria/pla) → categoria real (/categoria/filamentos-pla).
  const alias = !category && slug ? resolveCategoryAlias(categories, slug) : undefined;
  useSEO(category?.name ?? 'Categoria', category?.description);
  if (alias) return <Navigate to={categoryPath(alias.slug)} replace />;
  if (!category) {
    return (
      <div className="container-x py-20 text-center">
        <h1 className="text-2xl font-bold">Categoria não encontrada</h1>
      </div>
    );
  }
  return <Shop categorySlug={slug} title={category.name} />;
}
