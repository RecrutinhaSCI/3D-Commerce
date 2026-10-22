import { createHash } from 'node:crypto';
import { ShippingMethod } from '@prisma/client';
import { env } from '../../config/env';

/**
 * Melhor Envio — cliente de COTAÇÃO de frete (só cotação; etiqueta e rastreio
 * ficam fora). Endpoint: POST /api/v2/me/shipment/calculate.
 *
 * Decisões desta fase:
 *   - Só Correios PAC (serviço 1) e Sedex (serviço 2): mantém o enum
 *     ShippingMethod e o rastreio atual (SeuRastreio) compatíveis.
 *   - Usa `custom_price`/`custom_delivery_time` (já com as regras da conta).
 *   - Produto sem peso/medidas → erro MISSING_PRODUCT_DATA; quem chama decide
 *     o fallback (tabela fixa). Nunca inventamos medidas aqui.
 *   - Cache em memória (CEP + carrinho) por 10 min: a mesma cotação serve à
 *     tela do checkout e à criação do pedido sem nova chamada.
 *
 * Referência: docs/integracoes/frete-melhor-envio.md
 */

/** IDs dos serviços dos Correios no Melhor Envio → modalidade do pedido. */
export const CORREIOS_SERVICES: Record<number, ShippingMethod> = {
  1: ShippingMethod.PAC,
  2: ShippingMethod.SEDEX,
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

export interface QuoteItem {
  productId: string;
  quantity: number;
  /** Preço unitário cobrado (vira valor declarado/seguro). */
  unitPrice: number;
  weight: number | null; // kg
  width: number | null; // cm
  height: number | null; // cm
  depth: number | null; // cm (o "length" do Melhor Envio)
}

export interface QuotedOption {
  method: ShippingMethod;
  /** ID do serviço no Melhor Envio (1 = PAC, 2 = Sedex). */
  serviceId: number;
  serviceName: string;
  carrier: string;
  price: number;
  deadlineDays: number;
}

export type MelhorEnvioErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_CEP'
  | 'MISSING_PRODUCT_DATA'
  | 'TIMEOUT'
  | 'UNAUTHORIZED'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE';

export class MelhorEnvioError extends Error {
  constructor(
    public readonly code: MelhorEnvioErrorCode,
    message: string,
    /** Produtos sem peso/medidas (só em MISSING_PRODUCT_DATA). */
    public readonly productIds: string[] = [],
  ) {
    super(message);
    this.name = 'MelhorEnvioError';
  }
}

/** Cotação real ligada? Precisa do token e do CEP de origem. */
export function isMelhorEnvioConfigured(): boolean {
  return Boolean(env.MELHOR_ENVIO_TOKEN && env.SHIPPING_ORIGIN_CEP);
}

export function normalizeCep(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : null;
}

const hasPhysicalData = (i: QuoteItem) =>
  [i.weight, i.width, i.height, i.depth].every((v) => typeof v === 'number' && v > 0);

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------

const cache = new Map<string, { expiresAt: number; options: QuotedOption[] }>();

function cacheKey(toCep: string, items: QuoteItem[]): string {
  const normalized = [...items]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((i) => [i.productId, i.quantity, i.unitPrice, i.weight, i.width, i.height, i.depth].join(':'));
  return createHash('sha256').update(`${env.SHIPPING_ORIGIN_CEP}|${toCep}|${normalized.join('|')}`).digest('hex');
}

function cacheGet(key: string, now: number): QuotedOption[] | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }
  return hit.options;
}

function cacheSet(key: string, options: QuotedOption[], now: number) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Map mantém a ordem de inserção: a primeira chave é a mais antiga.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: now + CACHE_TTL_MS, options });
}

/** Só para testes. */
export function clearQuoteCache() {
  cache.clear();
}

// -----------------------------------------------------------------------------
// Cotação
// -----------------------------------------------------------------------------

interface MeService {
  id?: number;
  name?: string;
  price?: string | number;
  custom_price?: string | number;
  delivery_time?: number;
  custom_delivery_time?: number;
  error?: string;
  company?: { name?: string };
}

function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Converte a resposta do Melhor Envio nas opções aceitas (só Correios PAC/Sedex). */
export function parseQuoteResponse(body: unknown): QuotedOption[] {
  if (!Array.isArray(body)) {
    throw new MelhorEnvioError('BAD_RESPONSE', 'Resposta inesperada do Melhor Envio.');
  }
  const options: QuotedOption[] = [];
  for (const s of body as MeService[]) {
    const method = typeof s?.id === 'number' ? CORREIOS_SERVICES[s.id] : undefined;
    if (!method || s.error) continue; // serviço não usado ou sem cotação para este CEP
    const price = toNumber(s.custom_price ?? s.price);
    const deadline = toNumber(s.custom_delivery_time ?? s.delivery_time);
    if (price === null || price < 0 || deadline === null || deadline < 0) continue;
    options.push({
      method,
      serviceId: s.id as number,
      serviceName: s.name?.trim() || method,
      carrier: s.company?.name?.trim() || 'Correios',
      price: Number(price.toFixed(2)),
      deadlineDays: Math.ceil(deadline),
    });
  }
  return options.sort((a, b) => a.price - b.price);
}

export interface QuoteDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Cota PAC e Sedex para o CEP de destino. Lança `MelhorEnvioError` em
 * qualquer falha; lista vazia = nenhum serviço atende o CEP.
 */
export async function quoteMelhorEnvio(
  toCepRaw: string,
  items: QuoteItem[],
  deps: QuoteDeps = {},
): Promise<QuotedOption[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;

  if (!isMelhorEnvioConfigured()) {
    throw new MelhorEnvioError('NOT_CONFIGURED', 'Cotação do Melhor Envio não configurada.');
  }
  const toCep = normalizeCep(toCepRaw);
  if (!toCep) throw new MelhorEnvioError('INVALID_CEP', 'CEP de destino inválido.');

  const missing = items.filter((i) => !hasPhysicalData(i)).map((i) => i.productId);
  if (items.length === 0 || missing.length > 0) {
    throw new MelhorEnvioError(
      'MISSING_PRODUCT_DATA',
      'Há produtos sem peso ou medidas cadastrados.',
      missing,
    );
  }

  const key = cacheKey(toCep, items);
  const cached = cacheGet(key, now());
  if (cached) return cached;

  const payload = {
    from: { postal_code: env.SHIPPING_ORIGIN_CEP },
    to: { postal_code: toCep },
    products: items.map((i) => ({
      id: i.productId,
      // Medidas inteiras (cm, arredondadas para cima — nunca subestima a caixa).
      width: Math.max(1, Math.ceil(i.width as number)),
      height: Math.max(1, Math.ceil(i.height as number)),
      length: Math.max(1, Math.ceil(i.depth as number)),
      weight: i.weight as number,
      insurance_value: Number(i.unitPrice.toFixed(2)),
      quantity: i.quantity,
    })),
    options: { receipt: false, own_hand: false },
    services: Object.keys(CORREIOS_SERVICES).join(','),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.MELHOR_ENVIO_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(`${env.MELHOR_ENVIO_BASE_URL.replace(/\/+$/, '')}/api/v2/me/shipment/calculate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MELHOR_ENVIO_TOKEN}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': env.MELHOR_ENVIO_USER_AGENT || '3DCommerce',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw new MelhorEnvioError('TIMEOUT', 'O Melhor Envio demorou para responder.');
    }
    throw new MelhorEnvioError('HTTP_ERROR', 'Não foi possível falar com o Melhor Envio.');
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new MelhorEnvioError('UNAUTHORIZED', 'Token do Melhor Envio inválido ou sem permissão.');
  }
  if (!res.ok) {
    throw new MelhorEnvioError('HTTP_ERROR', `Melhor Envio respondeu ${res.status}.`);
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new MelhorEnvioError('BAD_RESPONSE', 'Resposta inválida do Melhor Envio.');
  }

  const options = parseQuoteResponse(body);
  // Só guarda cotação com resultado: CEP sem atendimento pode ser instabilidade.
  if (options.length > 0) cacheSet(key, options, now());
  return options;
}
