import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import slugify from 'slugify';
import { ChevronLeft, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { Product, PurchaseMode } from '@/types';
import { useSEO } from '@/utils/seo';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { Markdown } from '@/components/ui/Markdown';
import { productService } from '@/services/productService';
import { ApiError } from '@/services/api';
import { apiProductToInternal } from '@/services/adapters';
import type { ApiProduct } from '@/services/types';

// Inputs numéricos vazios chegam como "" e z.coerce.number() os transforma em 0.
// Isso fazia o "Preço promo" virar 0 e a vitrine exibir "R$ 0,00".
// Tratamos campo vazio como undefined antes de coagir.
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);
const optionalPositive = (msg: string) =>
  z.preprocess(emptyToUndefined, z.coerce.number().positive(msg).optional());

// Só campos que o backend PERSISTE. (Variações, especificações livres e
// flags como "lançamento"/"frete grátis" não existem no banco — foram removidos
// da tela para não parecer que salvam.)
const schema = z.object({
  name: z.string().min(3, 'Nome com no mínimo 3 caracteres'),
  // Marca persistida separada do material (coluna products.brand).
  brand: z.string().trim().max(80).optional(),
  shortDescription: z.string().min(5, 'Descrição curta com no mínimo 5 caracteres'),
  description: z.string().min(10, 'Descrição com no mínimo 10 caracteres'),
  price: z.coerce.number({ invalid_type_error: 'Informe um preço válido' }).min(0.01, 'Preço deve ser maior que zero'),
  promoPrice: optionalPositive('Preço promo deve ser maior que zero'),
  stock: z.coerce.number({ invalid_type_error: 'Informe o estoque' }).int().min(0),
  categoryId: z.string().min(1, 'Escolha a categoria'),
  material: z.enum(['PLA', 'PETG', 'ABS', 'Resina', '-']).optional(),
  purchaseMode: z.enum(['direct', 'quote', 'both']),
  sku: z
    .string()
    .trim()
    .max(60)
    .regex(/^[A-Za-z0-9._-]*$/, 'Use letras, números, ponto, hífen ou _')
    .optional(),
  color: z.string().trim().max(80).optional(),
  weight: optionalPositive('Peso deve ser maior que zero'),
  width: optionalPositive('Medida deve ser maior que zero'),
  height: optionalPositive('Medida deve ser maior que zero'),
  depth: optionalPositive('Medida deve ser maior que zero'),
  isHighlight: z.boolean().optional(),
  active: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

/**
 * Remonta o formulário ao trocar de produto (ex.: "novo" → recém-criado).
 *
 * Na edição, só monta o formulário quando o produto já está no store: com F5
 * (ou link direto) a página abria antes do carregamento — campos com valores
 * de "produto novo", galeria vazia, fotos não buscadas, e "Salvar" criava um
 * produto duplicado em vez de atualizar.
 */
export default function ProductFormPage() {
  const { id } = useParams();
  const found = useAdminDataStore((s) => (id ? s.products.some((p) => p.id === id) : true));
  const settled = useAdminDataStore((s) => s.ready && !s.loading);

  if (id && !found) {
    return settled ? (
      <div className="card mx-auto mt-10 max-w-md p-6 text-center">
        <p className="font-semibold">Produto não encontrado.</p>
        <p className="mt-1 text-sm text-ink-mute">Ele pode ter sido excluído.</p>
        <Link to="/admin/produtos" className="btn-secondary mt-4 inline-flex !py-2 !text-xs">
          <ChevronLeft className="h-3.5 w-3.5" /> Voltar para produtos
        </Link>
      </div>
    ) : (
      <p className="mt-10 text-center text-sm text-ink-mute">Carregando produto...</p>
    );
  }
  return <ProductForm key={id ?? 'novo'} />;
}

function ProductForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  useSEO(isEdit ? 'Editar produto' : 'Novo produto');
  const navigate = useNavigate();
  const { products, categories, addProduct, updateProduct } = useAdminDataStore();
  const existing = id ? products.find((p) => p.id === id) : undefined;
  const [saving, setSaving] = useState(false);

  const { register, handleSubmit, formState: { errors }, watch } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: existing
      ? {
          name: existing.name,
          brand: existing.brand ?? '',
          shortDescription: existing.shortDescription,
          description: existing.description,
          price: existing.price,
          promoPrice: existing.promoPrice,
          stock: existing.stock,
          categoryId: existing.categoryIds[0] ?? categories[0]?.id,
          material: existing.material ?? '-',
          purchaseMode: existing.purchaseMode,
          sku: existing.sku ?? '',
          color: existing.color ?? '',
          weight: existing.weight,
          width: existing.width,
          height: existing.height,
          depth: existing.depth,
          isHighlight: existing.isHighlight,
          active: existing.active,
        }
      : {
          purchaseMode: 'direct' as PurchaseMode,
          active: true,
          categoryId: categories[0]?.id,
          material: '-',
          stock: 1,
          price: 0,
        },
  });

  const descriptionValue = watch('description') ?? '';
  const [showPreview, setShowPreview] = useState(false);
  // Cada imagem carrega o id do backend para permitir remoção real.
  // O placeholder SVG que o adapter desenha para produto sem foto (data:) não
  // é mídia salva: não entra na lista (senão o admin "removia" o placeholder,
  // nada era apagado e ele voltava ao recarregar).
  const [images, setImages] = useState<Array<{ id: string | null; url: string; mediaType?: 'image' | 'video' }>>(
    existing
      ? existing.media && existing.media.length > 0
        ? existing.media
            .filter((m) => !m.url.startsWith('data:'))
            .map((m) => ({ id: m.id ?? null, url: m.url, mediaType: m.mediaType }))
        : existing.images.filter((u) => !u.startsWith('data:')).map((u) => ({ id: null, url: u }))
      : [],
  );

  /** Atualiza a galeria da tela e o cache da listagem com o produto do backend. */
  function applyServerMedia(product: ApiProduct) {
    setImages(product.images.map((img) => ({ id: img.id, url: img.url, mediaType: img.mediaType })));
    const internal = apiProductToInternal(product);
    useAdminDataStore.setState((s) => ({
      products: s.products.map((p) =>
        p.id === product.id ? { ...p, images: internal.images, media: internal.media } : p,
      ),
    }));
  }

  // Ao entrar em edição, busca o produto real do backend para pegar os IDs
  // das imagens (necessário para o DELETE por imageId). Usa a rota ADMIN:
  // a pública devolve 404 para produto inativo e as fotos ficavam sem ID
  // (o "remover foto" só sumia da tela e voltava ao recarregar).
  useEffect(() => {
    if (!existing) return;
    let cancelled = false;
    (async () => {
      try {
        const { product } = await productService.getAdminById(existing.id);
        if (cancelled) return;
        // Sempre substitui pelo que está no banco — inclusive lista vazia
        // (o cache da listagem pode ter fotos já removidas).
        applyServerMedia(product);
      } catch {
        // mantém as imagens do store como fallback
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(d: FormData) {
    const fields = {
      name: d.name,
      shortDescription: d.shortDescription,
      description: d.description,
      price: d.price,
      promoPrice: d.promoPrice,
      stock: d.stock,
      categoryIds: [d.categoryId],
      material: d.material as Product['material'],
      purchaseMode: d.purchaseMode,
      brand: d.brand ?? '',
      sku: d.sku ?? '',
      color: d.color ?? '',
      weight: d.weight,
      width: d.width,
      height: d.height,
      depth: d.depth,
      isHighlight: !!d.isHighlight,
      active: !!d.active,
    };

    setSaving(true);
    try {
      if (isEdit && existing) {
        await updateProduct(existing.id, fields);
        toast.success('Produto atualizado');
      } else {
        const created = await addProduct({
          ...fields,
          id: '',
          slug: slugify(d.name, { lower: true, strict: true }),
          images: [],
          freeShipping: false,
          variations: [],
          badges: [],
          isLaunch: false,
          isOffer: false,
          isBestSeller: false,
          createdAt: new Date().toISOString(),
          attributes: {},
        });
        toast.success('Produto criado. Agora envie as imagens.');
        // Vai para a edição do produto REAL (id do backend) para subir imagens.
        navigate(`/admin/produtos/${created.id}`, { replace: true });
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Não foi possível salvar o produto.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink">
        <ChevronLeft className="h-3 w-3" /> Voltar
      </button>
      <h1 className="mt-3 text-2xl font-bold">{isEdit ? 'Editar produto' : 'Novo produto'}</h1>

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="card p-5">
            <h2 className="text-base font-bold">Informações</h2>
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[2fr_1fr]">
                <div>
                  <Label>Nome</Label>
                  <Input {...register('name')} error={errors.name?.message} />
                </div>
                <div>
                  <Label>Marca</Label>
                  <Input {...register('brand')} placeholder="ex.: Bambu Lab" error={errors.brand?.message} />
                </div>
              </div>
              <div>
                <Label>Descrição curta</Label>
                <Input {...register('shortDescription')} error={errors.shortDescription?.message} />
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <Label className="mb-0">Descrição completa</Label>
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowPreview(false)}
                      className={`rounded-lg px-2 py-1 font-semibold ${!showPreview ? 'bg-ink text-white' : 'text-ink-mute hover:text-ink'}`}
                    >
                      Escrever
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPreview(true)}
                      className={`rounded-lg px-2 py-1 font-semibold ${showPreview ? 'bg-ink text-white' : 'text-ink-mute hover:text-ink'}`}
                    >
                      Preview
                    </button>
                  </div>
                </div>
                {showPreview ? (
                  <div className="min-h-[140px] rounded-xl border border-ink-line bg-white px-4 py-3">
                    {descriptionValue.trim() ? (
                      <Markdown content={descriptionValue} />
                    ) : (
                      <p className="text-sm text-ink-mute">Nada para visualizar ainda.</p>
                    )}
                  </div>
                ) : (
                  <Textarea {...register('description')} rows={8} error={errors.description?.message} />
                )}
                <p className="mt-1.5 text-xs text-ink-mute">
                  Suporta Markdown (igual ao GitHub): <code># Título</code>, <code>**negrito**</code>, <code>*itálico*</code>, listas com <code>-</code>, links <code>[texto](url)</code>.
                </p>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold">Preços e estoque</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label>Preço (R$)</Label>
                <Input type="number" step="0.01" {...register('price')} error={errors.price?.message} />
              </div>
              <div>
                <Label>Preço promo</Label>
                <Input type="number" step="0.01" {...register('promoPrice')} error={errors.promoPrice?.message} />
              </div>
              <div>
                <Label>Estoque</Label>
                <Input type="number" {...register('stock')} error={errors.stock?.message} />
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold">Classificação</h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label>Categoria</Label>
                <Select {...register('categoryId')}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Material</Label>
                <Select {...register('material')}>
                  <option value="-">—</option>
                  <option value="PLA">PLA</option>
                  <option value="PETG">PETG</option>
                  <option value="ABS">ABS</option>
                  <option value="Resina">Resina</option>
                </Select>
              </div>
              <div>
                <Label>Modo de compra</Label>
                <Select {...register('purchaseMode')}>
                  <option value="direct">Direct (apenas compra)</option>
                  <option value="quote">Quote (apenas orçamento)</option>
                  <option value="both">Both (compra + orçamento)</option>
                </Select>
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold">Ficha técnica e envio</h2>
            <p className="mt-1 text-xs text-ink-mute">
              Material, cor e peso aparecem na ficha técnica da loja. Peso e medidas da embalagem
              serão usados no cálculo de frete por CEP.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>SKU (código interno)</Label>
                <Input {...register('sku')} placeholder="ex.: PLA-PRETO-1KG" error={errors.sku?.message} />
              </div>
              <div>
                <Label>Cor</Label>
                <Input {...register('color')} placeholder="ex.: Preto" error={errors.color?.message} />
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label>Peso (kg)</Label>
                <Input type="number" step="0.001" {...register('weight')} error={errors.weight?.message} />
              </div>
              <div>
                <Label>Largura (cm)</Label>
                <Input type="number" step="0.1" {...register('width')} error={errors.width?.message} />
              </div>
              <div>
                <Label>Altura (cm)</Label>
                <Input type="number" step="0.1" {...register('height')} error={errors.height?.message} />
              </div>
              <div>
                <Label>Profundidade (cm)</Label>
                <Input type="number" step="0.1" {...register('depth')} error={errors.depth?.message} />
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-bold">Mídias do produto</h2>
            {!isEdit && (
              <p className="mt-1 text-[11px] text-ink-mute">
                Salve o produto primeiro; em seguida você já pode enviar imagens e vídeos.
              </p>
            )}
            <div className="mt-4">
              <RemoteImageUploader
                multiple
                allowVideo
                max={10}
                value={images.map((i) => i.url)}
                mediaTypes={images.map((i) => i.mediaType ?? (/\.mp4($|\?)/i.test(i.url) ? 'video' : 'image'))}
                onUploadMany={async (files) => {
                  if (!isEdit || !existing) {
                    throw new Error('Salve o produto antes de enviar mídias.');
                  }
                  try {
                    const { product } = await productService.addImages(existing.id, files);
                    // As mídias já foram salvas no upload: só sincroniza tela + cache.
                    applyServerMedia(product);
                    return product.images.map((img) => img.url);
                  } catch (err) {
                    const msg = err instanceof ApiError ? err.message : 'Falha ao enviar mídias.';
                    throw new Error(msg);
                  }
                }}
                onRemoveAt={async (idx) => {
                  const img = images[idx];
                  if (!img) return;
                  if (!img.id || !existing) {
                    // Sem id não há como apagar no banco: avisar em vez de só
                    // sumir da tela (e voltar ao recarregar).
                    throw new Error('Não foi possível identificar esta mídia. Recarregue a página e tente de novo.');
                  }
                  try {
                    await productService.removeImage(img.id);
                    // Relê do banco: confirma a remoção e atualiza a listagem.
                    const { product } = await productService.getAdminById(existing.id);
                    applyServerMedia(product);
                  } catch (err) {
                    throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover mídia.');
                  }
                }}
                hint="Fotos JPG, PNG ou WEBP de qualquer tamanho (reduzidas automaticamente); GIF ou MP4 até 4MB. A primeira mídia vira a principal."
              />
            </div>
          </div>
          <div className="card p-5">
            <h2 className="text-base font-bold">Exibição</h2>
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" {...register('isHighlight')} className="accent-ink" /> Destaque na home</label>
              <label className="flex items-center gap-2 border-t border-ink-line pt-3"><input type="checkbox" {...register('active')} className="accent-ink" /> Produto ativo</label>
            </div>
            <p className="mt-3 text-xs text-ink-mute">
              O selo “Oferta” aparece sozinho quando há preço promocional.
            </p>
          </div>
          <Button type="submit" fullWidth size="lg" loading={saving}>
            <Save className="h-4 w-4" /> Salvar produto
          </Button>
        </aside>
      </form>
    </div>
  );
}
