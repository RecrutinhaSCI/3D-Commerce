import { PaymentProvider } from '@prisma/client';
import { env, paymentWebhookSecret } from '../../../config/env';
import { HttpError } from '../../../utils/httpError';
import { InterPaymentProvider } from './inter.provider';
import { MockPaymentProvider } from './mock.provider';
import type { PaymentProviderAdapter } from './types';

/**
 * Factory de providers (R19). O provider ATIVO vem de PAYMENT_PROVIDER;
 * `getProviderByName` existe para o webhook, que é roteado por provider
 * na URL (/api/webhooks/payments/:provider) — assim dá para receber
 * webhooks de um provider antigo mesmo depois de trocar o ativo.
 */

const instances = new Map<PaymentProvider, PaymentProviderAdapter>();

function build(name: PaymentProvider): PaymentProviderAdapter {
  switch (name) {
    case PaymentProvider.MOCK:
      return new MockPaymentProvider({ webhookSecret: paymentWebhookSecret });
    case PaymentProvider.INTER:
      return new InterPaymentProvider();
  }
}

export function getProviderByName(name: PaymentProvider): PaymentProviderAdapter {
  let instance = instances.get(name);
  if (!instance) {
    instance = build(name);
    instances.set(name, instance);
  }
  return instance;
}

/** Converte o slug da URL/env ("mock" | "inter") no enum do Prisma. */
export function parseProviderSlug(slug: string): PaymentProvider {
  const normalized = slug.trim().toUpperCase();
  if (normalized === PaymentProvider.MOCK || normalized === PaymentProvider.INTER) {
    return normalized as PaymentProvider;
  }
  throw HttpError.notFound(`Provider de pagamento desconhecido: ${slug}`);
}

/** Provider ativo, definido por PAYMENT_PROVIDER no .env. */
export function getActiveProvider(): PaymentProviderAdapter {
  return getProviderByName(parseProviderSlug(env.PAYMENT_PROVIDER));
}
