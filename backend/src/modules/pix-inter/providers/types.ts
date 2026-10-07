import type { PaymentProvider } from '@prisma/client';

/**
 * Camada de providers de pagamento (R19).
 *
 * O serviço de pagamentos conversa APENAS com este contrato — trocar de
 * gateway (MOCK → INTER → outro) não muda nada fora de `providers/`.
 */

/** Dados necessários para criar uma cobrança Pix. */
export interface CreatePixChargeInput {
  /** Id interno do pedido (vira referência/txid junto ao provider). */
  orderId: string;
  /** Valor em reais (ex.: 149.9). */
  amount: number;
  /** Nome do pagador (vai no BR Code / cobrança). */
  customerName: string;
  /** Validade da cobrança em minutos. */
  expirationMinutes: number;
}

/** Cobrança Pix retornada pelo provider — compatível com um Pix real. */
export interface PixChargeResult {
  /** Identificador da cobrança no provider (txid). */
  txid: string;
  /** Código Pix "copia e cola" (payload EMV / BR Code). */
  pixCopyPaste: string;
  /** Conteúdo para gerar o QR Code (no Pix é o próprio BR Code). */
  qrCodeText: string;
  /** Expiração da cobrança. */
  expiresAt: Date;
  /** Payload bruto do provider, guardado para auditoria. */
  raw: Record<string, unknown>;
}

/** Evento normalizado extraído de um webhook do provider. */
export interface NormalizedWebhookEvent {
  /** Id único do evento NO PROVIDER (chave de idempotência). */
  externalEventId: string;
  /** txid da cobrança a que o evento se refere. */
  txid: string;
  /** Tipo normalizado do evento. */
  type: 'pix.approved' | 'pix.expired' | 'pix.canceled';
  /** Payload original completo. */
  payload: Record<string, unknown>;
}

/**
 * Contrato que todo provider implementa.
 * `verifyAndParseWebhook` recebe o body BRUTO (bytes) + headers, porque cada
 * provider tem seu próprio esquema de autenticação de webhook.
 */
export interface PaymentProviderAdapter {
  readonly name: PaymentProvider;
  createPixCharge(input: CreatePixChargeInput): Promise<PixChargeResult>;
  /**
   * Valida a autenticidade do webhook e o converte num evento normalizado.
   * Deve lançar HttpError.unauthorized/badRequest quando inválido.
   */
  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedWebhookEvent;
}
