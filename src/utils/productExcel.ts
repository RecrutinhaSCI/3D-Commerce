import * as XLSX from 'xlsx';
import type { Category, Product } from '@/types';

/**
 * Utilitários de Excel para produtos (R16).
 * - Exportação: gera .xlsx a partir dos produtos já carregados no admin.
 * - Modelo: cabeçalhos + 1 linha de exemplo.
 * - Importação: lê .xlsx, valida linha a linha e devolve prévia (sem gravar).
 *
 * Segurança: os valores são lidos como dados (nunca como fórmula); textos são
 * sanitizados (trim + limite de tamanho) e números validados.
 */

export const IMPORT_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// Cabeçalhos amigáveis (pt-BR). A importação casa por estes nomes (case-insensitive).
const HEADERS = {
  id: 'id',
  nome: 'nome',
  slug: 'slug',
  sku: 'sku',
  marca: 'marca',
  material: 'material',
  imagem: 'imagem',
  categoria: 'categoria',
  descricaoCurta: 'descricao_curta',
  descricaoCompleta: 'descricao_completa',
  preco: 'preco',
  precoPromocional: 'preco_promocional',
  estoque: 'estoque',
  ativo: 'ativo',
  destaque: 'destaque_home',
  lancamento: 'lancamento',
  oferta: 'oferta',
  maisVendido: 'mais_vendido',
  freteGratis: 'frete_gratis',
  criadoEm: 'criado_em',
} as const;

/**
 * R19-B — Aliases aceitos por coluna. Uma coluna nunca é alias de outra:
 * "marca" NUNCA vira `material`, "material" NUNCA vira `brand`.
 */
const COLUMN_ALIASES: Record<string, string> = {
  // Marca
  marca: HEADERS.marca,
  brand: HEADERS.marca,
  // Material
  material: HEADERS.material,
  // R19-C — Imagem principal (URL). Aliases comuns; nunca cruzam com outras colunas.
  imagem: HEADERS.imagem,
  imagemurl: HEADERS.imagem,
  imagem_url: HEADERS.imagem,
  image: HEADERS.imagem,
  imageurl: HEADERS.imagem,
  image_url: HEADERS.imagem,
};

function categoryName(product: Product, categories: Category[]): string {
  const c = categories.find((x) => product.categoryIds.includes(x.id));
  return c?.name ?? '';
}

function fmtDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR');
}

function triggerDownload(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename);
}

// -----------------------------------------------------------------------------
// Exportação
// -----------------------------------------------------------------------------

export function exportProductsXlsx(products: Product[], categories: Category[]) {
  const rows = products.map((p) => ({
    [HEADERS.id]: p.id,
    [HEADERS.sku]: '', // SKU real vive no backend; exportação inclui a coluna para reimport com matching seguro.
    [HEADERS.nome]: p.name,
    [HEADERS.slug]: p.slug,
    // R19-B — marca e material em colunas SEPARADAS. Nunca compartilham célula.
    [HEADERS.marca]: p.brand ?? '',
    [HEADERS.material]: p.material && p.material !== '-' ? p.material : '',
    // R19-C — imagem PRINCIPAL (menor position). `apiProductToInternal` já
    // ordenou a galeria; o [0] é a principal. Exporta a string exatamente
    // como armazenada (path relativo /uploads/... ou URL absoluta).
    [HEADERS.imagem]: p.images[0] ?? '',
    [HEADERS.categoria]: categoryName(p, categories),
    [HEADERS.descricaoCurta]: p.shortDescription,
    [HEADERS.descricaoCompleta]: p.description,
    [HEADERS.preco]: p.price,
    [HEADERS.precoPromocional]: p.promoPrice ?? '',
    [HEADERS.estoque]: p.stock,
    [HEADERS.ativo]: p.active ? 'sim' : 'não',
    [HEADERS.destaque]: p.isHighlight ? 'sim' : 'não',
    [HEADERS.lancamento]: p.isLaunch ? 'sim' : 'não',
    [HEADERS.oferta]: p.isOffer ? 'sim' : 'não',
    [HEADERS.maisVendido]: p.isBestSeller ? 'sim' : 'não',
    [HEADERS.freteGratis]: p.freeShipping ? 'sim' : 'não',
    [HEADERS.criadoEm]: fmtDate(p.createdAt),
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
  const date = new Date().toISOString().slice(0, 10);
  triggerDownload(wb, `produtos-3dcommerce-${date}.xlsx`);
}

export function downloadProductTemplate() {
  const example = {
    [HEADERS.nome]: 'Filamento PLA Verde 1kg',
    [HEADERS.slug]: '', // opcional — gerado pelo nome se vazio
    // R19-B — Marca (fabricante) e Material são colunas distintas.
    [HEADERS.marca]: '3D Prime',
    [HEADERS.material]: 'PLA',
    // R19-C — imagem principal por URL (opcional). Só https/http ou /uploads/...
    [HEADERS.imagem]: 'https://cdn.example.com/filamento-pla-verde.jpg',
    [HEADERS.categoria]: 'Filamentos PLA',
    [HEADERS.descricaoCurta]: 'PLA 1.75mm verde, 1kg.',
    [HEADERS.descricaoCompleta]: 'Descrição completa em **Markdown** opcional.',
    [HEADERS.preco]: 129.9,
    [HEADERS.precoPromocional]: 109.9,
    [HEADERS.estoque]: 25,
    [HEADERS.ativo]: 'sim',
    [HEADERS.destaque]: 'não',
  };
  const ws = XLSX.utils.json_to_sheet([example]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Modelo');
  triggerDownload(wb, 'modelo-importacao-produtos.xlsx');
}

// -----------------------------------------------------------------------------
// Importação (parse + validação — NÃO grava)
// -----------------------------------------------------------------------------

/**
 * R19-A — Uma linha da planilha traduzida em payload seguro para o backend.
 *
 * REGRA DE OURO: célula vazia vira `undefined`, NUNCA `null`/`""`/`0`.
 * O backend só toca em campos definidos no payload — assim, célula vazia
 * significa "não alterar" no update parcial, e o admin não perde dados por
 * acidente. `estoque = 0` explicitamente digitado é enviado como número,
 * então continua funcionando (0 ≠ vazio).
 */
export interface ParsedProductRow {
  line: number; // linha na planilha (1-based, considerando cabeçalho)
  data: {
    id?: string;
    sku?: string;
    slug?: string; // explícito na planilha — usado pelo matching seguro do backend.
    name?: string;
    categoryName?: string;
    shortDescription?: string;
    description?: string;
    price?: number;
    promotionalPrice?: number;
    stock?: number;
    active?: boolean;
    featured?: boolean;
    // R19-B — marca e material INDEPENDENTES.
    brand?: string;
    material?: string;
    // R19-C — URL da imagem principal (validação sintática detalhada acontece
    // no backend, por linha; aqui só recolhemos e mandamos como texto).
    imageUrl?: string;
  };
  errors: string[];
}

export interface ParseResult {
  rows: ParsedProductRow[];
  validCount: number;
  errorCount: number;
}

const MAX_TEXT = 5000;

/** Vazio → `undefined` (preserva). Texto → trim + limite. */
function optText(v: unknown, max = MAX_TEXT): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s.slice(0, max);
}

/** Vazio → `undefined`. Aceita sim/não, true/false, 1/0, s/n. */
function optBool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().toLowerCase();
  if (['sim', 's', 'true', '1', 'yes', 'y', 'ativo'].includes(s)) return true;
  if (['nao', 'não', 'n', 'false', '0', 'no', 'inativo'].includes(s)) return false;
  return undefined;
}

/**
 * Vazio → `undefined` (preserva); valor inválido → `null` (marca para o
 * chamador validar). `0` explícito é preservado como número.
 */
function optNumber(v: unknown): number | undefined | null {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim().replace(/\s/g, '').replace(/\./g, (m, _i, str) =>
    // separador de milhar só quando há vírgula decimal depois
    str.includes(',') ? '' : m,
  ).replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Lê o header real da planilha e mapeia para a chave canônica.
 * Aplica também os aliases de coluna (R19-B): "Brand" → "marca", etc.
 * NUNCA promove alias entre conceitos distintos ("marca" nunca vira "material").
 */
function normalizeKey(key: string): string {
  const raw = key.trim().toLowerCase().replace(/\s+/g, '_');
  return COLUMN_ALIASES[raw] ?? raw;
}

export async function parseProductsXlsx(file: File): Promise<ParseResult> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error('Envie um arquivo .xlsx válido.');
  }
  if (file.size > IMPORT_MAX_BYTES) {
    throw new Error('Arquivo muito grande (máx. 2 MB).');
  }

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // raw:false força valores como texto/computados (nunca fórmula), defval '' evita undefined.
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: false, defval: '' });

  const rows: ParsedProductRow[] = json.map((raw, idx) => {
    // Normaliza chaves da linha.
    const row: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw)) row[normalizeKey(k)] = v;

    const errors: string[] = [];

    const id = optText(row[HEADERS.id], 60);
    const sku = optText(row[HEADERS.sku], 60);
    const slug = optText(row[HEADERS.slug], 160);
    const name = optText(row[HEADERS.nome], 200);
    const categoryName = optText(row[HEADERS.categoria], 120);

    // R19-A: identidade obrigatória mínima. Sem NADA que identifique nem
    // nome novo, a linha é lixo.
    if (!id && !sku && !slug && !name) {
      errors.push('Linha vazia: informe ao menos ID, SKU, slug ou nome.');
    }
    if (name !== undefined && name.length < 2) errors.push('Nome muito curto (mín. 2 caracteres).');

    // Números: `null` = valor inválido; `undefined` = vazio (preservar).
    const priceRaw = optNumber(row[HEADERS.preco]);
    if (priceRaw === null) errors.push('Preço inválido.');
    else if (priceRaw !== undefined && priceRaw <= 0) errors.push('Preço deve ser maior que zero.');
    const price = priceRaw === null ? undefined : priceRaw;

    const promoRaw = optNumber(row[HEADERS.precoPromocional]);
    if (promoRaw === null) errors.push('Preço promocional inválido.');
    else if (promoRaw !== undefined && promoRaw <= 0) errors.push('Preço promocional deve ser maior que zero.');
    const promotionalPrice = promoRaw === null ? undefined : promoRaw;

    const stockRaw = optNumber(row[HEADERS.estoque]);
    let stock: number | undefined;
    if (stockRaw === null) {
      errors.push('Estoque inválido.');
    } else if (stockRaw !== undefined) {
      if (!Number.isInteger(stockRaw) || stockRaw < 0) errors.push('Estoque deve ser inteiro ≥ 0.');
      else stock = stockRaw; // `0` explícito é preservado como número.
    }

    // Booleanos.
    const active = optBool(row[HEADERS.ativo]);
    const destaqueVal = optBool(row[HEADERS.destaque]);
    const maisVendidoVal = optBool(row[HEADERS.maisVendido]);
    // Só marca `featured` quando o admin explicitamente disse algo.
    const featured = destaqueVal ?? maisVendidoVal;

    return {
      line: idx + 2, // +1 header, +1 base-1
      data: {
        id,
        sku,
        slug,
        name,
        categoryName,
        shortDescription: optText(row[HEADERS.descricaoCurta], 300),
        description: optText(row[HEADERS.descricaoCompleta]),
        price,
        promotionalPrice,
        stock,
        active,
        featured,
        // R19-B — Marca (fabricante) e Material são independentes. A coluna
        // "marca" (com seus aliases) vai para `brand`; a coluna "material"
        // vai para `material`. Nenhum caminho faz um substituir o outro.
        brand: optText(row[HEADERS.marca], 80),
        material: optText(row[HEADERS.material], 80),
        // R19-C — imagem por URL. Validação sintática por linha é do backend
        // (uma URL ruim aqui só afeta a própria linha, não o lote).
        imageUrl: optText(row[HEADERS.imagem], 2000),
      },
      errors,
    };
  });

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  return { rows, validCount, errorCount: rows.length - validCount };
}
