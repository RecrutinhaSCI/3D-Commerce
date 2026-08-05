import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import slugify from 'slugify';
import { ChevronLeft, Plus, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { useAdminDataStore } from '@/store/useAdminDataStore';
import type { Product, ProductVariation, PurchaseMode, VariationType } from '@/types';
import { productSvg } from '@/utils/productImage';
import { useSEO } from '@/utils/seo';
import { RemoteImageUploader } from '@/components/admin/RemoteImageUploader';
import { Markdown } from '@/components/ui/Markdown';
import { productService } from '@/services/productService';
import { ApiError } from '@/services/api';
import { apiProductToInternal } from '@/services/adapters';

// Inputs numéricos vazios chegam como "" e z.coerce.number() os transforma em 0.
// Isso fazia o "Preço promo" virar 0 e a vitrine exibir "R$ 0,00".
// Tratamos campo vazio como undefined antes de coagir.
const emptyToUndefined = (v: unknown) => (v === '' || v === null ? undefined : v);

const schema = z.object({
  name: z.string().min(3),
  shortDescription: z.string().min(5),
  description: z.string().min(10),
  brand: z.string().min(1),
  price: z.coerce.number({ invalid_type_error: 'Informe um preço válido' }).min(0.01, 'Preço deve ser maior que zero'),
  promoPrice: z.preprocess(emptyToUndefined, z.coerce.number().min(0.01, 'Preço promo deve ser maior que zero').optional()),
  stock: z.coerce.number({ invalid_type_error: 'Informe o estoque' }).min(0),
  categoryId: z.string().min(1),
  material: z.enum(['PLA', 'PETG', 'ABS', 'Resina', '-']).optional(),
  purchaseMode: z.enum(['direct', 'quote', 'both']),
  isHighlight: z.boolean().optional(),
  isLaunch: z.boolean().optional(),
  isOffer: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  freeShipping: z.boolean().optional(),
  active: z.boolean().optional(),
});
type FormData = z.infer<typeof schema>;

export default function ProductForm() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  useSEO(isEdit ? 'Editar produto' : 'Novo produto');
  const navigate = useNavigate();
  const { products, categories, addProduct, updateProduct } = useAdminDataStore();
  const existing = id ? products.find((p) => p.id === id) : undefined;

  const { register, handleSubmit, formState: { errors }, watch } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: existing
      ? {
          name: existing.name,
          shortDescription: existing.shortDescription,
          description: existing.description,
          brand: existing.brand,
          price: existing.price,
          promoPrice: existing.promoPrice,
          stock: existing.stock,
          categoryId: existing.categoryIds[0] ?? categories[0]?.id,
          material: existing.material ?? '-',
          purchaseMode: existing.purchaseMode,
          isHighlight: existing.isHighlight,
          isLaunch: existing.isLaunch,
          isOffer: existing.isOffer,
          isBestSeller: existing.isBestSeller,
          freeShipping: existing.freeShipping,
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

  const name = watch('name');
  const descriptionValue = watch('description') ?? '';
  const [showPreview, setShowPreview] = useState(false);
  // Cada imagem carrega o id do backend para permitir remoção real.
  // Se `id === null`, é placeholder local (produto ainda não persistido).
  const [images, setImages] = useState<Array<{ id: string | null; url: string; mediaType?: 'image' | 'video' }>>(
    existing
      ? existing.media && existing.media.length > 0
        ? existing.media.map((m) => ({ id: m.id ?? null, url: m.url, mediaType: m.mediaType }))
        : existing.images.map((u) => ({ id: null, url: u }))
      : [],
  );

  // Especificações = pares chave/valor (product.attributes). Editáveis aqui.
  const [specs, setSpecs] = useState<{ key: string; value: string }[]>(
    existing ? Object.entries(existing.attributes).map(([key, value]) => ({ key, value })) : [],
  );

  function addSpec() {
    setSpecs((s) => [...s, { key: '', value: '' }]);
  }
  function updateSpec(index: number, field: 'key' | 'value', val: string) {
    setSpecs((s) => s.map((row, i) => (i === index ? { ...row, [field]: val } : row)));
  }
  function removeSpec(index: number) {
    setSpecs((s) => s.filter((_, i) => i !== index));
  }
  // Converte os pares em objeto, ignorando linhas sem chave.
  function buildAttributes(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const { key, value } of specs) {
      const k = key.trim();
      if (k) out[k] = value.trim();
    }
    return out;
  }

  // Variações do produto (cor, peso, modelo...). Editáveis aqui.
  const [variations, setVariations] = useState<ProductVariation[]>(existing ? existing.variations : []);

  function addVariation() {
    setVariations((v) => [
      ...v,
      { id: 'var-' + Date.now() + '-' + v.length, label: '', type: 'modelo', inStock: true },
    ]);
  }
  function updateVariation(index: number, patch: Partial<ProductVariation>) {
    setVariations((v) => v.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function removeVariation(index: number) {
    setVariations((v) => v.filter((_, i) => i !== index));
  }
  // Mantém só variações com rótulo; normaliza priceDelta/swatch vazios.
  function buildVariations(): ProductVariation[] {
    return variations
      .filter((v) => v.label.trim())
      .map((v) => ({
        ...v,
        label: v.label.trim(),
        priceDelta: v.priceDelta && v.priceDelta > 0 ? v.priceDelta : undefined,
        swatch: v.type === 'cor' ? v.swatch : undefined,
      }));
  }

  const variationTypes: VariationType[] = ['cor', 'material', 'peso', 'diametro', 'voltagem', 'tamanho', 'modelo'];

  useEffect(() => {
    if (!existing && images.length === 0 && name) {
      setImages([{ id: null, url: productSvg(name, 'generic', Math.floor(Math.random() * 999)) }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  // Ao entrar em edição, busca o produto real do backend para pegar os IDs
  // das imagens (necessário para o DELETE por imageId).
  useEffect(() => {
    if (!existing) return;
    let cancelled = false;
    (async () => {
      try {
        const { product } = await productService.getPublicBySlug(existing.slug);
        if (cancelled) return;
        if (product.images.length > 0) {
          setImages(product.images.map((img) => ({
            id: img.id,
            url: img.url,
            mediaType: img.mediaType,
          })));
        }
      } catch {
        // mantém as imagens do store como fallback
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onSubmit(d: FormData) {
    const badges: Product['badges'] = [];
    if (d.isOffer) badges.push('oferta');
    if (d.isLaunch) badges.push('lancamento');
    if (d.isBestSeller) badges.push('mais-vendido');
    if (d.stock <= 0) badges.push('esgotado');
    if (d.freeShipping) badges.push('frete-gratis');

    // Não empurramos mais imagens Base64 para o backend — o upload real
    // acontece via RemoteImageUploader (endpoint /products/:id/images).
    // O store guarda a lista de URLs só para exibição imediata.
    const finalImages = images.length > 0
      ? images.map((i) => i.url)
      : [productSvg(d.name, 'generic', 1)];
    if (isEdit && existing) {
      updateProduct(existing.id, {
        ...d,
        material: d.material as Product['material'],
        categoryIds: [d.categoryId],
        images: finalImages,
        badges,
        isHighlight: !!d.isHighlight,
        isLaunch: !!d.isLaunch,
        isOffer: !!d.isOffer,
        isBestSeller: !!d.isBestSeller,
        freeShipping: !!d.freeShipping,
        active: !!d.active,
        attributes: buildAttributes(),
        variations: buildVariations(),
      });
      toast.success('Produto atualizado');
    } else {
      const newId = 'prod-' + Date.now();
      const product: Product = {
        id: newId,
        slug: slugify(d.name, { lower: true, strict: true }),
        name: d.name,
        shortDescription: d.shortDescription,
        description: d.description,
        brand: d.brand,
        material: d.material as Product['material'],
        categoryIds: [d.categoryId],
        images: finalImages,
        media: finalImages.map((url) => ({
          url,
          mediaType: /\.mp4($|\?)/i.test(url) ? 'video' : 'image',
          mimeType: null,
        })),
        price: d.price,
        promoPrice: d.promoPrice,
        stock: d.stock,
        freeShipping: !!d.freeShipping,
        purchaseMode: d.purchaseMode,
        variations: buildVariations(),
        badges,
        isHighlight: !!d.isHighlight,
        isLaunch: !!d.isLaunch,
        isOffer: !!d.isOffer,
        isBestSeller: !!d.isBestSeller,
        active: !!d.active,
        createdAt: new Date().toISOString().slice(0, 10),
        attributes: buildAttributes(),
      };
      addProduct(product);
      toast.success('Produto criado');
      // Permanece na tela de edição do produto recém-criado, sem voltar à lista.
      navigate(`/admin/produtos/${newId}`, { replace: true });
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
              <div>
                <Label>Nome</Label>
                <Input {...register('name')} error={errors.name?.message} />
              </div>
              <div>
                <Label>Marca</Label>
                <Input {...register('brand')} error={errors.brand?.message} />
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
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <Label>Preço (R$)</Label>
                <Input type="number" step="0.01" {...register('price')} error={errors.price?.message} />
              </div>
              <div>
                <Label>Preço promo</Label>
                <Input type="number" step="0.01" {...register('promoPrice')} />
              </div>
              <div>
                <Label>Estoque</Label>
                <Input type="number" {...register('stock')} error={errors.stock?.message} />
              </div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-base font-bold">Classificação</h2>
            <div className="mt-4 grid grid-cols-3 gap-3">
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
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Especificações</h2>
              <button
                type="button"
                onClick={addSpec}
                className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/10"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-mute">
              Aparecem na ficha técnica do produto na loja (ex.: Material → PLA, Peso → 1kg, Diâmetro → 1.75mm).
            </p>

            {specs.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-ink-line px-4 py-6 text-center text-sm text-ink-mute">
                Nenhuma especificação. Clique em “Adicionar” para incluir.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {specs.map((row, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Input
                      placeholder="Nome (ex.: Peso)"
                      value={row.key}
                      onChange={(e) => updateSpec(i, 'key', e.target.value)}
                      className="flex-1"
                    />
                    <Input
                      placeholder="Valor (ex.: 1kg)"
                      value={row.value}
                      onChange={(e) => updateSpec(i, 'value', e.target.value)}
                      className="flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => removeSpec(i)}
                      className="mt-0.5 rounded-lg p-2 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                      aria-label="Remover especificação"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold">Variações</h2>
              <button
                type="button"
                onClick={addVariation}
                className="inline-flex items-center gap-1 rounded-lg bg-bg-soft px-3 py-1.5 text-xs font-semibold text-ink hover:bg-ink/10"
              >
                <Plus className="h-3.5 w-3.5" /> Adicionar
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-mute">
              Opções escolhidas pelo cliente (ex.: cor, peso, modelo). O acréscimo soma ao preço base.
            </p>

            {variations.length === 0 ? (
              <p className="mt-4 rounded-xl border border-dashed border-ink-line px-4 py-6 text-center text-sm text-ink-mute">
                Nenhuma variação. Clique em “Adicionar” para incluir.
              </p>
            ) : (
              <div className="mt-4 space-y-3">
                {variations.map((v, i) => (
                  <div key={v.id} className="rounded-xl border border-ink-line p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_130px_140px_auto]">
                      <div>
                        <Label>Rótulo</Label>
                        <Input
                          placeholder="ex.: Preto, 1kg, A1 Combo"
                          value={v.label}
                          onChange={(e) => updateVariation(i, { label: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label>Tipo</Label>
                        <Select
                          value={v.type}
                          onChange={(e) => updateVariation(i, { type: e.target.value as VariationType })}
                        >
                          {variationTypes.map((t) => (
                            <option key={t} value={t} className="capitalize">{t}</option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <Label>Acréscimo (R$)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0,00"
                          value={v.priceDelta ?? ''}
                          onChange={(e) =>
                            updateVariation(i, { priceDelta: e.target.value === '' ? undefined : Number(e.target.value) })
                          }
                        />
                      </div>
                      <div className="flex items-end pb-0.5">
                        <button
                          type="button"
                          onClick={() => removeVariation(i)}
                          className="rounded-lg p-2 text-ink-mute hover:bg-rose-50 hover:text-rose-500"
                          aria-label="Remover variação"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={v.inStock}
                          onChange={(e) => updateVariation(i, { inStock: e.target.checked })}
                          className="accent-ink"
                        />
                        Em estoque
                      </label>
                      {v.type === 'cor' && (
                        <label className="flex items-center gap-2 text-sm">
                          Cor:
                          <input
                            type="color"
                            value={v.swatch ?? '#000000'}
                            onChange={(e) => updateVariation(i, { swatch: e.target.value })}
                            className="h-7 w-10 cursor-pointer rounded border border-ink-line"
                          />
                        </label>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-5">
          <div className="card p-5">
            <h2 className="text-base font-bold">Mídias do produto</h2>
            {!isEdit && (
              <p className="mt-1 text-[11px] text-ink-mute">
                Salve o produto primeiro para poder enviar mídias ao servidor.
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
                    const next = product.images.map((img) => ({
                      id: img.id,
                      url: img.url,
                      mediaType: img.mediaType,
                    }));
                    setImages(next);
                    // Atualiza cache no store também.
                    const internal = apiProductToInternal(product);
                    updateProduct(existing.id, { images: internal.images, media: internal.media });
                    return next.map((n) => n.url);
                  } catch (err) {
                    const msg = err instanceof ApiError ? err.message : 'Falha ao enviar mídias.';
                    throw new Error(msg);
                  }
                }}
                onRemoveAt={async (idx) => {
                  const img = images[idx];
                  if (!img) return;
                  if (img.id) {
                    try {
                      await productService.removeImage(img.id);
                    } catch (err) {
                      throw new Error(err instanceof ApiError ? err.message : 'Erro ao remover mídia.');
                    }
                  }
                  setImages((prev) => prev.filter((_, i) => i !== idx));
                }}
                hint="JPG/PNG/WEBP/GIF até 5MB · MP4 até 8MB. A primeira mídia vira a principal."
              />
            </div>
          </div>
          <div className="card p-5">
            <h2 className="text-base font-bold">Flags</h2>
            <div className="mt-3 space-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" {...register('isHighlight')} className="accent-ink" /> Destaque na home</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('isLaunch')} className="accent-ink" /> Lançamento</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('isOffer')} className="accent-ink" /> Oferta</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('isBestSeller')} className="accent-ink" /> Mais vendido</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('freeShipping')} className="accent-ink" /> Frete grátis</label>
              <label className="flex items-center gap-2 border-t border-ink-line pt-3"><input type="checkbox" {...register('active')} className="accent-ink" /> Produto ativo</label>
            </div>
          </div>
          <Button type="submit" fullWidth size="lg">
            <Save className="h-4 w-4" /> Salvar produto
          </Button>
        </aside>
      </form>
    </div>
  );
}
