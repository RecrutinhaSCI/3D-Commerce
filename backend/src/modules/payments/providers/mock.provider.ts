import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PaymentProvider } from '@prisma/client';
import { HttpError } from '../../../utils/httpError';
import type {
  CreatePixChargeInput,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  PixChargeResult,
} from './types';

/**
 * Provider MOCK (R19) — simula um PSP Pix de verdade, 100% local:
 *
 * - Gera txid no formato aceito pelo Bacen (26–35 chars alfanuméricos).
 * - Gera um BR Code EMV **válido** (mesma estrutura de um Pix real, com
 *   CRC16-CCITT correto) — dá para renderizar QR Code e "escanear".
 * - Webhook autenticado por HMAC-SHA256 do body bruto no header
 *   `x-webhook-signature` (hex), com comparação timing-safe.
 *
 * Nenhuma chamada de rede é feita. Nada aqui depende do Banco Inter.
 */

export const MOCK_SIGNATURE_HEADER = 'x-webhook-signature';

const MOCK_EVENT_TYPES = {
  'pix.approved': true,
  'pix.expired': true,
  'pix.canceled': true,
} as const;
export type MockEventType = keyof typeof MOCK_EVENT_TYPES;

export interface MockProviderConfig {
  /** Secret do HMAC dos webhooks. */
  webhookSecret: string;
  /** Chave Pix fictícia exibida no BR Code. */
  pixKey?: string;
  /** Nome do recebedor no BR Code (máx. 25 chars no padrão EMV). */
  merchantName?: string;
  /** Cidade do recebedor no BR Code (máx. 15 chars). */
  merchantCity?: string;
}

/** Campo EMV: id (2 dígitos) + tamanho (2 dígitos) + valor. */
function emv(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

/** CRC16-CCITT (polinômio 0x1021, init 0xFFFF) — o mesmo do BR Code Pix. */
export function crc16ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Monta um payload Pix "copia e cola" (BR Code EMV) estruturalmente válido. */
export function buildPixBrCode(opts: {
  pixKey: string;
  merchantName: string;
  merchantCity: string;
  amount: number;
  txid: string;
}): string {
  const merchantAccount =
    emv('00', 'br.gov.bcb.pix') + emv('01', opts.pixKey);
  const additionalData = emv('05', opts.txid.slice(0, 25));

  const withoutCrc =
    emv('00', '01') + // payload format indicator
    emv('26', merchantAccount) + // merchant account info (Pix)
    emv('52', '0000') + // merchant category code
    emv('53', '986') + // moeda BRL
    emv('54', opts.amount.toFixed(2)) + // valor
    emv('58', 'BR') + // país
    emv('59', opts.merchantName.slice(0, 25)) +
    emv('60', opts.merchantCity.slice(0, 15)) +
    emv('62', additionalData) +
    '6304'; // id+len do CRC, calculado sobre tudo até aqui

  return withoutCrc + crc16ccitt(withoutCrc);
}

/** Assina um body de webhook MOCK (usado pela simulação local e pelos testes). */
export function signMockWebhook(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.MOCK;

  constructor(private readonly config: MockProviderConfig) {
    if (!config.webhookSecret || config.webhookSecret.length < 16) {
      throw new Error('MockPaymentProvider: webhookSecret ausente ou curto demais (mín. 16 chars).');
    }
  }

  async createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult> {
    // txid Bacen: alfanumérico, 26–35 chars. Prefixo identifica o mock.
    const txid = `MOCK${randomUUID().replace(/-/g, '').slice(0, 28)}`.toUpperCase();
    const expiresAt = new Date(Date.now() + input.expirationMinutes * 60_000);

    const brCode = buildPixBrCode({
      pixKey: this.config.pixKey ?? 'pagamentos@3dcommerce.mock',
      merchantName: this.config.merchantName ?? '3D COMMERCE',
      merchantCity: this.config.merchantCity ?? 'CAXIAS DO SUL',
      amount: input.amount,
      txid,
    });

    return {
      txid,
      pixCopyPaste: brCode,
      // No Pix real o QR Code é o próprio payload EMV.
      qrCodeText: brCode,
      expiresAt,
      raw: {
        provider: 'MOCK',
        txid,
        orderId: input.orderId,
        amount: input.amount,
        expiresAt: expiresAt.toISOString(),
        simulated: true,
      },
    };
  }

  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): NormalizedWebhookEvent {
    const signature = headers[MOCK_SIGNATURE_HEADER];
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) {
      throw HttpError.unauthorized('Assinatura do webhook ausente ou mal formatada.');
    }

    const expected = signMockWebhook(rawBody, this.config.webhookSecret);
    const sigBuf = Buffer.from(signature.toLowerCase(), 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw HttpError.unauthorized('Assinatura do webhook inválida.');
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw HttpError.badRequest('Body do webhook não é JSON válido.');
    }

    const b = body as Record<string, unknown>;
    const eventId = typeof b.eventId === 'string' ? b.eventId : '';
    const txid = typeof b.txid === 'string' ? b.txid : '';
    const type = typeof b.type === 'string' ? b.type : '';

    if (!eventId || !txid || !(type in MOCK_EVENT_TYPES)) {
      throw HttpError.badRequest(
        'Webhook MOCK inválido: esperado { eventId, txid, type: pix.approved|pix.expired|pix.canceled }.',
      );
    }

    return {
      externalEventId: eventId,
      txid,
      type: type as MockEventType,
      payload: b,
    };
  }
}
