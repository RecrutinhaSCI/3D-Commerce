import * as XLSX from 'xlsx';
import type { ApiProduct } from '@/services/types';

/**
 * Utilitários de Excel para produtos (R16).
 * - Exportação: gera .xlsx a partir dos produtos CRUS da API (buscados na hora
 *   do clique), para que reimportar o arquivo seja seguro: SKU real, imagem
 *   exatamente como gravada no banco, nenhuma coluna "decorativa".
 * - Modelo: cabeçalhos + 1 linha de exemplo.
 * - Importação: lê .xlsx, valida linha a linha e devolve prévia (sem gravar).
 *
 * Segurança: os valores são lidos como dados (nunca como fórmula); textos são
 * sanitizados (trim + limite de tamanho) e números validados.
 */

// A planilha é lida no navegador; só as fotos (já comprimidas) sobem para a
// API, uma por requisição. O limite alto comporta planilhas com fotos coladas.
export const IMPORT_MAX_BYTES = 60 * 1024 * 1024; // 60 MB

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
  // Só leitura (import ignora): aceito por compat com planilhas antigas.
  maisVendido: 'mais_vendido',
  criadoEm: 'criado_em',
  estoqueAtualizadoEm: 'estoque_atualizado_em',
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

/** URL da mídia principal exatamente como está no banco (menor position). */
function mainImageUrl(p: ApiProduct): string {
  const main = [...p.images].sort((a, b) => a.position - b.position)[0];
  return main?.url ?? '';
}

function fmtDate(iso?: string | null): string {
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

/**
 * Linhas da exportação — separado do download para ser testável.
 * Regras: SKU real; imagem = URL gravada no banco (nunca o placeholder SVG
 * que o front desenha para produto sem foto, nem a URL absoluta montada
 * com o host da API); vazio quando não há valor.
 */
export function buildExportRows(products: ApiProduct[]): Array<Record<string, string | number>> {
  return products.map((p) => ({
    [HEADERS.id]: p.id,
    [HEADERS.sku]: p.sku ?? '',
    [HEADERS.nome]: p.name,
    [HEADERS.slug]: p.slug,
    // R19-B — marca e material em colunas SEPARADAS. Nunca compartilham célula.
    [HEADERS.marca]: p.brand ?? '',
    [HEADERS.material]: p.material ?? '',
    [HEADERS.imagem]: mainImageUrl(p),
    [HEADERS.categoria]: p.category?.name ?? '',
    [HEADERS.descricaoCurta]: p.shortDescription ?? '',
    [HEADERS.descricaoCompleta]: p.description ?? '',
    [HEADERS.preco]: p.price,
    [HEADERS.precoPromocional]: p.promotionalPrice ?? '',
    [HEADERS.estoque]: p.stock,
    [HEADERS.ativo]: p.active ? 'sim' : 'não',
    [HEADERS.destaque]: p.featured ? 'sim' : 'não',
    [HEADERS.criadoEm]: fmtDate(p.createdAt),
    [HEADERS.estoqueAtualizadoEm]: fmtDate(p.stockUpdatedAt),
  }));
}

export function exportProductsXlsx(products: ApiProduct[]) {
  const ws = XLSX.utils.json_to_sheet(buildExportRows(products));
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
  /** Foto colada na planilha (na célula ou sobre a linha). Enviada após criar o produto. */
  embeddedImage?: File;
  errors: string[];
}

export interface ParseResult {
  rows: ParsedProductRow[];
  validCount: number;
  errorCount: number;
  /** Quantas linhas trazem foto colada na planilha. */
  imageCount: number;
}

// -----------------------------------------------------------------------------
// Fotos coladas na planilha
// -----------------------------------------------------------------------------
// O Excel guarda as fotos dentro do .xlsx (um zip) de dois jeitos:
//  1. "Colocar na célula": a célula tem `vm="N"` e o caminho até o arquivo passa
//     por metadata.xml → richData (rdrichvalue + richValueRel) → xl/media/.
//  2. Flutuando sobre a planilha: drawing ligado à aba, com a âncora `from.row`.
// Devolvemos a 1ª foto de cada linha (número da linha 1-based).

type ZipEntry = { content?: Uint8Array | ArrayBuffer | string | number[] };
type ZipFiles = Record<string, ZipEntry>;

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function zipBytes(files: ZipFiles, path: string): Uint8Array | undefined {
  const c = (files[path] ?? files[`/${path}`])?.content;
  if (c === undefined) return undefined;
  if (typeof c === 'string') return new TextEncoder().encode(c);
  return c instanceof Uint8Array ? c : new Uint8Array(c as ArrayBuffer);
}

function zipXml(files: ZipFiles, path: string): Document | undefined {
  const bytes = zipBytes(files, path);
  if (!bytes) return undefined;
  return new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'application/xml');
}

const byTag = (node: Document | Element, tag: string) => Array.from(node.getElementsByTagNameNS('*', tag));
const relId = (el: Element, attr: string) =>
  el.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', attr) ?? el.getAttribute(`r:${attr}`);

/** Resolve o Target de um .rels relativo à pasta do arquivo de origem. */
function resolveTarget(fromFile: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** Lê um .rels e devolve Id → caminho absoluto no zip. */
function readRels(files: ZipFiles, ownerFile: string): Map<string, string> {
  const dir = ownerFile.split('/').slice(0, -1).join('/');
  const name = ownerFile.split('/').pop();
  const doc = zipXml(files, `${dir}/_rels/${name}.rels`);
  const map = new Map<string, string>();
  if (!doc) return map;
  for (const r of byTag(doc, 'Relationship')) {
    const id = r.getAttribute('Id');
    const target = r.getAttribute('Target');
    if (id && target && r.getAttribute('TargetMode') !== 'External') map.set(id, resolveTarget(ownerFile, target));
  }
  return map;
}

function rowOf(cellRef: string): number {
  return Number(cellRef.replace(/^[A-Z]+/i, ''));
}

/** Imagens "na célula" (Excel 365): célula com vm → richData → mídia. */
function inCellImages(files: ZipFiles, sheetPath: string, out: Map<number, string>) {
  const sheet = zipXml(files, sheetPath);
  const meta = zipXml(files, 'xl/metadata.xml');
  const rv = zipXml(files, 'xl/richData/rdrichvalue.xml');
  const rvStruct = zipXml(files, 'xl/richData/rdrichvaluestructure.xml');
  const rvRel = zipXml(files, 'xl/richData/richValueRel.xml');
  if (!sheet || !meta || !rv || !rvRel) return;

  const relTargets = readRels(files, 'xl/richData/richValueRel.xml');
  const relIds = byTag(rvRel, 'rel').map((el) => relId(el, 'id'));
  const futureBk = byTag(meta, 'futureMetadata')
    .filter((f) => f.getAttribute('name') === 'XLRICHVALUE')
    .flatMap((f) => byTag(f, 'bk'));
  const valueBk = byTag(meta, 'valueMetadata').flatMap((v) => byTag(v, 'bk'));
  const structures = rvStruct ? byTag(rvStruct, 's') : [];
  const values = byTag(rv, 'rv');

  for (const c of byTag(sheet, 'c')) {
    const vm = Number(c.getAttribute('vm'));
    const ref = c.getAttribute('r');
    if (!vm || !ref) continue;
    const rc = valueBk[vm - 1] ? byTag(valueBk[vm - 1], 'rc')[0] : undefined;
    const fut = rc ? futureBk[Number(rc.getAttribute('v'))] : undefined;
    const rvb = fut ? byTag(fut, 'rvb')[0] : undefined;
    const value = rvb ? values[Number(rvb.getAttribute('i'))] : undefined;
    if (!value) continue;
    // A posição do identificador da imagem vem da estrutura do valor.
    const keys = byTag(structures[Number(value.getAttribute('s'))] ?? value, 'k').map((k) => k.getAttribute('n'));
    const pos = Math.max(0, keys.indexOf('_rvRel:LocalImageIdentifier'));
    const relIndex = Number(byTag(value, 'v')[pos]?.textContent);
    const target = relTargets.get(relIds[relIndex] ?? '');
    const row = rowOf(ref);
    if (target && !out.has(row)) out.set(row, target);
  }
}

/** Imagens flutuantes: drawing da aba, ancoradas pela linha de início. */
function drawingImages(files: ZipFiles, sheetPath: string, out: Map<number, string>) {
  for (const drawingPath of readRels(files, sheetPath).values()) {
    if (!/\/drawings\/[^/]+\.xml$/.test(drawingPath)) continue;
    const drawing = zipXml(files, drawingPath);
    if (!drawing) continue;
    const rels = readRels(files, drawingPath);
    const anchors = [...byTag(drawing, 'twoCellAnchor'), ...byTag(drawing, 'oneCellAnchor')];
    for (const a of anchors) {
      const from = byTag(a, 'from')[0];
      const blip = byTag(a, 'blip')[0];
      const rowText = from ? byTag(from, 'row')[0]?.textContent : undefined;
      const target = blip ? rels.get(relId(blip, 'embed') ?? '') : undefined;
      if (rowText == null || !target) continue;
      const row = Number(rowText) + 1; // âncora é 0-based
      if (!out.has(row)) out.set(row, target);
    }
  }
}

function extractRowImages(wb: XLSX.WorkBook): Map<number, File> {
  const files = (wb as unknown as { files?: ZipFiles }).files;
  const sheetPath = (wb as unknown as { Directory?: { sheets?: string[] } }).Directory?.sheets?.[0]?.replace(/^\//, '');
  const result = new Map<number, File>();
  if (!files || !sheetPath) return result;

  const targets = new Map<number, string>();
  try {
    inCellImages(files, sheetPath, targets);
    drawingImages(files, sheetPath, targets);
  } catch {
    return result; // estrutura inesperada: segue a importação sem fotos
  }
  for (const [row, path] of targets) {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const bytes = zipBytes(files, path);
    if (!bytes || !MIME_BY_EXT[ext]) continue;
    result.set(row, new File([new Uint8Array(bytes)], `linha-${row}.${ext}`, { type: MIME_BY_EXT[ext] }));
  }
  return result;
}

const MAX_TEXT = 5000;

/**
 * Placeholder SVG que o front gera para produto sem foto. Planilhas exportadas
 * antes da correção traziam isso na coluna imagem — e o backend recusava a
 * linha INTEIRA (preço/estoque inclusive). Tratamos como "sem imagem".
 */
function isGeneratedPlaceholder(v: string): boolean {
  return /^data:image\/svg\+xml/i.test(v);
}

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
  // Célula numérica: usa o valor real, independente da formatação exibida
  // (ex.: "1,299.00" com formato de milhar seria lido errado como texto).
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
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
    throw new Error('Arquivo muito grande (máx. 60 MB).');
  }

  const buf = await file.arrayBuffer();
  // bookFiles: mantém os arquivos internos do .xlsx para extrair as fotos.
  const wb = XLSX.read(buf, { type: 'array', bookFiles: true });
  return parseWorkbook(wb);
}

/** Parse a partir do workbook já lido — separado para ser testável sem File. */
export function parseWorkbook(wb: XLSX.WorkBook): ParseResult {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // raw:true → valor real da célula (número continua número; fórmula vem
  // como o valor calculado em cache, nunca é executada). defval '' evita undefined.
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: '' });
  // Fotos coladas (só existem quando o workbook foi lido com bookFiles).
  const rowImages = extractRowImages(wb);

  const rows: ParsedProductRow[] = json.map((raw, idx) => {
    // Linha real da planilha (o sheet_to_json pula linhas em branco).
    const rowNum = (raw as { __rowNum__?: number }).__rowNum__;
    const line = rowNum !== undefined ? rowNum + 1 : idx + 2;
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

    // Foto colada tem prioridade sobre URL. Célula com foto "na célula" vem
    // como erro do Excel (#VALUE!) — nunca é uma URL; nem o placeholder SVG.
    const embeddedImage = rowImages.get(line);
    const imageText = optText(row[HEADERS.imagem], 2000);
    const imageUrl =
      embeddedImage || !imageText || imageText.startsWith('#') || isGeneratedPlaceholder(imageText)
        ? undefined
        : imageText;

    return {
      line,
      embeddedImage,
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
        imageUrl,
      },
      errors,
    };
  });

  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const imageCount = rows.filter((r) => r.embeddedImage).length;
  return { rows, validCount, errorCount: rows.length - validCount, imageCount };
}
