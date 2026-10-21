import type { BlogPost } from '@/types';

/** Campos do post editáveis no admin (o slug é fixo). */
export type BlogPostOverride = Partial<Pick<BlogPost, 'title' | 'category' | 'excerpt' | 'readTime' | 'content'>>;

/** Palavras de um texto em Markdown (ignora a sintaxe). */
export function countWords(markdown: string): number {
  return markdown
    .replace(/\]\([^)]*\)/g, ']') // URLs de links não contam
    .replace(/[#*_`>|[\]()-]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Tempo de leitura estimado (~200 palavras/min), ex.: "5 min". */
export function estimateReadTime(markdown: string): string {
  return `${Math.max(1, Math.ceil(countWords(markdown) / 200))} min`;
}

/**
 * Post final = padrão do código + versão salva no admin (campo a campo) +
 * capa. Campo salvo vazio nunca apaga o padrão: o post não fica sem texto.
 */
export function resolveBlogPost(
  base: BlogPost,
  override?: BlogPostOverride,
  cover?: string,
): BlogPost & { customized: boolean } {
  const pick = (k: keyof BlogPostOverride) => {
    const v = override?.[k];
    return typeof v === 'string' && v.trim() ? v : base[k];
  };
  return {
    ...base,
    title: pick('title'),
    category: pick('category'),
    excerpt: pick('excerpt'),
    readTime: pick('readTime'),
    content: pick('content'),
    cover: cover || base.cover,
    customized: !!override && Object.values(override).some((v) => typeof v === 'string' && v.trim()),
  };
}

export function resolveBlogPosts(
  bases: BlogPost[],
  overrides: Record<string, BlogPostOverride> | undefined,
  covers: Record<string, string> | undefined,
) {
  return bases.map((b) => resolveBlogPost(b, overrides?.[b.slug], covers?.[b.slug]));
}
