import { PaymentProvider } from '@prisma/client';
import { HttpError } from '../../../utils/httpError';
import type {
  CreatePixChargeInput,
  NormalizedWebhookEvent,
  PaymentProviderAdapter,
  PixChargeResult,
} from './types';

/**
 * Provider BANCO INTER (R19) — **stub preparado, SEM integração real**.
 *
 * Quando a integração for autorizada, este arquivo será o único ponto a
 * implementar. Roteiro previsto (API Pix do Inter, cert mTLS):
 *
 *  1. OAuth2 client_credentials em `${INTER_BASE_URL}/oauth/v2/token`
 *     usando INTER_CLIENT_ID/INTER_CLIENT_SECRET + certificado
 *     (INTER_CERT_PATH/INTER_KEY_PATH — arquivos FORA do repositório).
 *  2. Criar cobrança: PUT/POST `/pix/v2/cob` com chave INTER_PIX_KEY,
 *     valor e expiração → retorna txid + pixCopiaECola.
 *  3. Webhook: validar autenticidade conforme mecanismo do Inter
 *     (mTLS/HMAC com INTER_WEBHOOK_SECRET) e normalizar o evento.
 *
 * Nenhuma credencial, certificado ou chamada de rede existe aqui hoje.
 */
export class InterPaymentProvider implements PaymentProviderAdapter {
  readonly name = PaymentProvider.INTER;

  async createPixCharge(_input: CreatePixChargeInput): Promise<PixChargeResult> {
    throw new HttpError(
      501,
      'PROVIDER_NOT_IMPLEMENTED',
      'Provider INTER ainda não está habilitado. Use PAYMENT_PROVIDER=mock ou aguarde a integração com o Banco Inter.',
    );
  }

  verifyAndParseWebhook(
    _rawBody: Buffer,
    _headers: Record<string, string | string[] | undefined>,
  ): NormalizedWebhookEvent {
    throw new HttpError(
      501,
      'PROVIDER_NOT_IMPLEMENTED',
      'Webhook do Banco Inter ainda não está habilitado.',
    );
  }
}
