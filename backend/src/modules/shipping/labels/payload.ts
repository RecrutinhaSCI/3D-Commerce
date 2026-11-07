import { createHash } from 'node:crypto';
import { isValidCnpj, isValidCpf, onlyDigits } from '../../../utils/cpf';
import type { FiscalPayloadParts } from './fiscal';
import { toMelhorEnvioVolume, type ShipmentPackage } from './package';
import type { ShippingSender } from './sender';

/**
 * Montagem do payload de POST /api/v2/me/cart (inserir frete no carrinho).
 * Funções PURAS: nada de HTTP, banco ou env aqui.
 *
 * Campos conforme a documentação oficial (inserir-fretes-no-carrinho):
 *   service, from, to, products[{ name, quantity, unitary_value }],
 *   volumes[{ height, width, length, weight }],
 *   options{ insurance_value, receipt, own_hand, reverse, non_commercial,
 *            invoice{ key }, platform, tags[{ tag, url }] }
 * Correios: um volume por envio.
 */

/** Serviços aceitos nesta fase (Correios). */
export const LABEL_SERVICES = { PAC: 1, SEDEX: 2 } as const;
const KNOWN_SERVICE_IDS: readonly number[] = Object.values(LABEL_SERVICES);

export type PayloadErrorCode =
  | 'PICKUP_ORDER'
  | 'UNKNOWN_SERVICE'
  | 'INVALID_RECIPIENT_ADDRESS'
  | 'INVALID_RECIPIENT_DOCUMENT'
  | 'NO_PRODUCTS'
  | 'INVALID_DECLARED_VALUE';

export class PayloadError extends Error {
  constructor(
    public readonly code: PayloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PayloadError';
  }
}

/**
 * Serviço da etiqueta a partir do pedido: o `shippingServiceId` da cotação
 * real, ou (tabela fixa, id nulo) a modalidade PAC/SEDEX → 1/2.
 */
export function resolveLabelServiceId(order: { shippingMethod: string | null; shippingServiceId: number | null }): number {
  if (order.shippingMethod === 'PICKUP') throw new PayloadError('PICKUP_ORDER', 'Pedido com retirada na loja não tem etiqueta.');
  const id =
    order.shippingServiceId ??
    (order.shippingMethod === 'PAC' ? LABEL_SERVICES.PAC : order.shippingMethod === 'SEDEX' ? LABEL_SERVICES.SEDEX : null);
  if (id === null || !KNOWN_SERVICE_IDS.includes(id)) {
    throw new PayloadError('UNKNOWN_SERVICE', 'Serviço de entrega do pedido não suportado para etiqueta.');
  }
  return id;
}

/** Snapshot de endereço salvo no pedido (orders.address_snapshot). */
export interface OrderAddressSnapshot {
  recipientName?: string | null;
  zipCode?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
}

export interface LabelRecipient {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  /** CPF (ou CNPJ) do pedido; opcional no checkout atual. */
  document: string | null;
  address: OrderAddressSnapshot;
}

export interface LabelProduct {
  name: string;
  quantity: number;
  /** Preço unitário efetivamente cobrado (R$). */
  unitPrice: number;
}

export interface CartPayloadInput {
  serviceId: number;
  sender: ShippingSender;
  recipient: LabelRecipient;
  package: ShipmentPackage;
  products: LabelProduct[];
  /** Valor declarado/segurado (R$). Padrão: soma dos produtos. */
  declaredValue?: number;
  fiscal: FiscalPayloadParts;
  /** Referência do pedido (vai em options.tags para achar a etiqueta no painel do ME). */
  orderReference?: string;
}

export interface CartPayloadResult {
  payload: MeCartPayload;
  /** sha256 do payload canônico — detecta mudança sem guardar dados pessoais. */
  payloadHash: string;
  declaredValue: number;
  /** Pontos de atenção que NÃO bloqueiam (o Melhor Envio valida). */
  warnings: string[];
}

interface MeAddress {
  name: string;
  phone: string;
  email: string;
  document?: string;
  company_document?: string;
  state_register?: string;
  economic_activity_code?: string;
  address: string;
  complement: string;
  number: string;
  district: string;
  city: string;
  country_id: 'BR';
  postal_code: string;
  state_abbr: string;
}

export interface MeCartPayload {
  service: number;
  from: MeAddress;
  to: MeAddress;
  products: Array<{ name: string; quantity: string; unitary_value: string }>;
  volumes: Array<{ height: number; width: number; length: number; weight: number }>;
  options: {
    insurance_value: number;
    receipt: false;
    own_hand: false;
    reverse: false;
    non_commercial: boolean;
    invoice?: { key: string };
    platform: string;
    tags?: Array<{ tag: string; url: string | null }>;
  };
}

export const ME_PLATFORM = '3DCommerce';

const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const trimmed = (v: string | null | undefined, max: number) => (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** CPF → `document`; CNPJ → `company_document`. Documento inválido nunca vai à API. */
function documentFields(raw: string | null): Pick<MeAddress, 'document' | 'company_document'> | null {
  if (!raw) return {};
  const d = onlyDigits(raw);
  if (d.length === 11 && isValidCpf(d)) return { document: d };
  if (d.length === 14 && isValidCnpj(d)) return { company_document: d };
  return null;
}

function senderAddress(sender: ShippingSender, fiscal: FiscalPayloadParts): MeAddress {
  const doc = sender.document.length === 14 ? { company_document: sender.document } : { document: sender.document };
  return {
    name: sender.name,
    phone: sender.phone,
    email: sender.email,
    ...doc,
    // Comercial: IE do remetente; declaração: vazio (nunca mandamos IE à toa).
    ...(fiscal.fromStateRegister ? { state_register: fiscal.fromStateRegister } : {}),
    ...(sender.economicActivityCode ? { economic_activity_code: sender.economicActivityCode } : {}),
    address: sender.address,
    complement: sender.complement ?? '',
    number: sender.number,
    district: sender.district,
    city: sender.city,
    country_id: 'BR',
    postal_code: sender.postalCode,
    state_abbr: sender.stateAbbr,
  };
}

function recipientAddress(r: LabelRecipient, warnings: string[]): MeAddress {
  const a = r.address ?? {};
  const postal = onlyDigits(a.zipCode ?? '');
  const state = trimmed(a.state, 2).toUpperCase();
  const fields = { street: trimmed(a.street, 150), number: trimmed(a.number, 20), district: trimmed(a.district, 80), city: trimmed(a.city, 80) };
  if (!/^\d{8}$/.test(postal) || !/^[A-Z]{2}$/.test(state) || Object.values(fields).some((v) => !v)) {
    throw new PayloadError('INVALID_RECIPIENT_ADDRESS', 'Endereço de entrega do pedido incompleto ou com CEP inválido.');
  }
  const doc = documentFields(r.document);
  if (doc === null) throw new PayloadError('INVALID_RECIPIENT_DOCUMENT', 'CPF/CNPJ do destinatário inválido.');
  if (!doc.document && !doc.company_document) {
    warnings.push('Destinatário sem CPF/CNPJ: o Melhor Envio pode exigir o documento.');
  }
  return {
    name: trimmed(a.recipientName, 100) || trimmed(r.customerName, 100),
    phone: onlyDigits(r.customerPhone ?? ''),
    email: trimmed(r.customerEmail, 120).toLowerCase(),
    ...doc,
    address: fields.street,
    complement: trimmed(a.complement, 60),
    number: fields.number,
    district: fields.district,
    city: fields.city,
    country_id: 'BR',
    postal_code: postal,
    state_abbr: state,
  };
}

/** JSON com chaves ordenadas (hash estável independente da ordem de montagem). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export const hashPayload = (payload: unknown) => createHash('sha256').update(canonical(payload)).digest('hex');

/**
 * Monta o payload do carrinho. Lança `PayloadError` para dado inválido do
 * NOSSO lado; regras da transportadora ficam para o Melhor Envio (422).
 */
export function buildCartPayload(input: CartPayloadInput): CartPayloadResult {
  if (!KNOWN_SERVICE_IDS.includes(input.serviceId)) {
    throw new PayloadError('UNKNOWN_SERVICE', 'Serviço de entrega não suportado para etiqueta.');
  }
  const products = input.products.filter((p) => p.quantity > 0);
  if (products.length === 0) throw new PayloadError('NO_PRODUCTS', 'Pedido sem itens para declarar.');

  const warnings = [...input.fiscal.warnings];
  const itemsTotal = products.reduce((s, p) => s + p.unitPrice * p.quantity, 0);
  const declaredValue = Math.round((input.declaredValue ?? itemsTotal) * 100) / 100;
  if (!Number.isFinite(declaredValue) || declaredValue <= 0) {
    throw new PayloadError('INVALID_DECLARED_VALUE', 'Valor declarado inválido.');
  }

  const payload: MeCartPayload = {
    service: input.serviceId,
    from: senderAddress(input.sender, input.fiscal),
    to: recipientAddress(input.recipient, warnings),
    // DC-e (desde 06/04/2026): lista de produtos exata.
    products: products.map((p) => ({
      name: trimmed(p.name, 255),
      quantity: String(p.quantity),
      unitary_value: money(p.unitPrice),
    })),
    volumes: [toMelhorEnvioVolume(input.package)],
    options: {
      insurance_value: declaredValue,
      receipt: false,
      own_hand: false,
      reverse: false,
      ...input.fiscal.options,
      platform: ME_PLATFORM,
      ...(input.orderReference ? { tags: [{ tag: trimmed(input.orderReference, 60), url: null }] } : {}),
    },
  };
  return { payload, payloadHash: hashPayload(payload), declaredValue, warnings };
}
