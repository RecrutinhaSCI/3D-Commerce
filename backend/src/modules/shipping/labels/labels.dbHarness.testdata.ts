/**
 * Base dos testes com Postgres REAL (só testes; fora do build). Mesma regra
 * do labelWorkflow.db.test: só roda com TEST_DATABASE_URL LOCAL cujo banco
 * termina em "_test" — os testes APAGAM etiquetas, pedidos e itens.
 */
import { PrismaClient } from '@prisma/client';
import type { MeLabelsRuntimeConfig } from './meLabelsClient';
import { senderSchema } from './sender';
import { validSenderInput } from './labels.testdata';

export const TEST_URL = process.env.TEST_DATABASE_URL;

export function isSafeTestDb(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && /_test$/.test(u.pathname.slice(1));
  } catch {
    return false;
  }
}
export const dbEnabled = isSafeTestDb(TEST_URL);

export const CFG: MeLabelsRuntimeConfig = {
  enabled: true,
  allowProduction: false,
  environment: 'sandbox',
  baseUrl: 'https://sandbox.melhorenvio.com.br',
  userAgent: 'teste (t@t.test)',
  timeoutMs: 1000,
};
export const PKG = { weightKg: 1.2, heightCm: 10, widthCm: 20, lengthCm: 30 };
export const DECL = { mode: 'DECLARATION' };

export const newClient = () => new PrismaClient({ datasourceUrl: TEST_URL });

/**
 * Os arquivos de teste com banco rodam em workers paralelos e todos limpam as
 * mesmas tabelas: um advisory lock (conexão única, mesma sessão no lock e no
 * unlock) faz cada ARQUIVO esperar o anterior terminar.
 */
export async function lockTestDb(): Promise<() => Promise<void>> {
  const url = new URL(TEST_URL!);
  url.searchParams.set('connection_limit', '1');
  const c = new PrismaClient({ datasourceUrl: url.toString() });
  await c.$executeRawUnsafe('SELECT pg_advisory_lock(42424201)');
  return async () => {
    await c.$executeRawUnsafe('SELECT pg_advisory_unlock(42424201)');
    await c.$disconnect();
  };
}
export const DB_LOCK_TIMEOUT_MS = 180_000;

/** Scopes completos (cotação + etiquetas), como se o ME tivesse confirmado. */
export const FULL_SCOPES = 'cart-write orders-read shipping-calculate shipping-cancel shipping-checkout shipping-generate shipping-print shipping-tracking';

/** Credenciais OAuth FICTÍCIAS (Sandbox e produção) (tokens falsos; só a lista de scopes importa nos testes). */
export async function seedCredential(db: PrismaClient, scope: string | null = FULL_SCOPES, scopeSource: string | null = 'response') {
  await db.integrationCredential.deleteMany();
  for (const environment of ['sandbox', 'production']) {
    await db.integrationCredential.create({
      data: {
        provider: 'melhor_envio', environment, accessTokenEnc: 'nao-e-token', refreshTokenEnc: 'nao-e-token',
        accessTokenExpiresAt: new Date('2099-01-01T00:00:00Z'), scope, scopeSource,
      },
    });
  }
}

export async function resetDb(db: PrismaClient) {
  await seedCredential(db);
  await db.shipmentLabelEvent.deleteMany();
  await db.shipmentLabel.deleteMany();
  await db.orderItem.deleteMany();
  await db.order.deleteMany();
  await db.siteSettings.upsert({
    where: { id: 'main' },
    create: { id: 'main', storeName: 'Loja', whatsapp: '54999990000', email: 'loja@t.test', address: 'x', shippingSenderJson: senderSchema.parse(validSenderInput()) },
    update: { shippingSenderJson: senderSchema.parse(validSenderInput()) },
  });
}

/**
 * Dados pessoais do pedido de teste — os testes conferem que NUNCA vazam.
 * O CEP de destino NÃO está aqui: o painel do admin o exibe de propósito
 * (pedido da Etapa 5); eventos e erros continuam sem ele.
 */
export const ORDER_PII = ['Paulista', '52998224725', 'cliente@exemplo.test', '11988887777'];

export async function createOrder(db: PrismaClient, p: Record<string, unknown> = {}) {
  const o = await db.order.create({
    data: {
      customerName: 'Cliente Teste', customerEmail: 'cliente@exemplo.test', customerPhone: '11988887777', customerCpf: '52998224725',
      addressSnapshot: { recipientName: 'Cliente Teste', zipCode: '01310100', street: 'Av. Paulista', number: '1000', district: 'Bela Vista', city: 'São Paulo', state: 'SP', country: 'BR' },
      subtotal: 212.3, shippingValue: 24.9, total: 237.2, paymentMethod: 'PIX', paymentStatus: 'PAID', status: 'CONFIRMED',
      shippingMethod: 'PAC', shippingQuoteSource: 'fixed',
      items: { create: [{ productName: 'Filamento PLA 1kg', quantity: 2, unitPrice: 99.9, total: 199.8 }, { productName: 'Bico 0.4', quantity: 1, unitPrice: 12.5, total: 12.5 }] },
      ...p,
    },
  });
  return o.id;
}
