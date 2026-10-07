import { describe, expect, it } from 'vitest';
import { HttpError } from '../../../utils/httpError';
import {
  MOCK_SIGNATURE_HEADER,
  MockPaymentProvider,
  buildPixBrCode,
  crc16ccitt,
  signMockWebhook,
} from './mock.provider';

const SECRET = 'test-secret-with-16chars-min';

function makeProvider() {
  return new MockPaymentProvider({ webhookSecret: SECRET });
}

describe('crc16ccitt', () => {
  it('calcula o CRC padrão do BR Code (vetor conhecido do Bacen)', () => {
    // Exemplo público da especificação Pix: payload "123456789" → CRC 29B1.
    expect(crc16ccitt('123456789')).toBe('29B1');
  });
});

describe('buildPixBrCode', () => {
  const code = buildPixBrCode({
    pixKey: 'pagamentos@loja.mock',
    merchantName: 'LOJA TESTE',
    merchantCity: 'CAXIAS DO SUL',
    amount: 149.9,
    txid: 'MOCKABC123',
  });

  it('gera payload EMV com formato, moeda BRL, país e valor corretos', () => {
    expect(code.startsWith('000201')).toBe(true); // payload format indicator
    expect(code).toContain('5303986'); // moeda 986 (BRL)
    expect(code).toContain('5802BR'); // país
    expect(code).toContain('5406149.90'); // valor com 2 casas
    expect(code).toContain('br.gov.bcb.pix'); // GUI do arranjo Pix
    expect(code).toContain('MOCKABC123'); // txid no campo 62
  });

  it('termina com CRC16 válido sobre o restante do payload', () => {
    const body = code.slice(0, -4);
    const crc = code.slice(-4);
    expect(crc16ccitt(body)).toBe(crc);
    expect(body.endsWith('6304')).toBe(true);
  });
});

describe('MockPaymentProvider.createPixCharge', () => {
  it('cria cobrança compatível com Pix real: txid, copia-e-cola, QR e expiração', async () => {
    const provider = makeProvider();
    const before = Date.now();
    const charge = await provider.createPixCharge({
      orderId: 'order_1',
      amount: 99.5,
      customerName: 'Cliente Teste',
      expirationMinutes: 30,
    });

    // txid alfanumérico no range aceito pelo Bacen (26–35 chars).
    expect(charge.txid).toMatch(/^[A-Z0-9]{26,35}$/);
    // QR = copia-e-cola (padrão Pix) e CRC confere.
    expect(charge.qrCodeText).toBe(charge.pixCopyPaste);
    expect(crc16ccitt(charge.pixCopyPaste.slice(0, -4))).toBe(charge.pixCopyPaste.slice(-4));
    // Campo 54 (valor): "99.50" tem 5 chars → "5405" + valor.
    expect(charge.pixCopyPaste).toContain('540599.50');
    // Expira ~30min à frente.
    const delta = charge.expiresAt.getTime() - before;
    expect(delta).toBeGreaterThan(29 * 60_000);
    expect(delta).toBeLessThan(31 * 60_000);
  });

  it('gera txid único por cobrança', async () => {
    const provider = makeProvider();
    const input = { orderId: 'o', amount: 1, customerName: 'x', expirationMinutes: 5 };
    const [a, b] = await Promise.all([provider.createPixCharge(input), provider.createPixCharge(input)]);
    expect(a.txid).not.toBe(b.txid);
  });

  it('recusa secret de webhook fraco', () => {
    expect(() => new MockPaymentProvider({ webhookSecret: 'curto' })).toThrow();
  });
});

describe('MockPaymentProvider.verifyAndParseWebhook', () => {
  const provider = makeProvider();
  const event = { eventId: 'evt_1', txid: 'MOCKTXID', type: 'pix.approved' };
  const body = Buffer.from(JSON.stringify(event), 'utf8');

  it('aceita webhook com assinatura HMAC válida e normaliza o evento', () => {
    const parsed = provider.verifyAndParseWebhook(body, {
      [MOCK_SIGNATURE_HEADER]: signMockWebhook(body, SECRET),
    });
    expect(parsed).toMatchObject({
      externalEventId: 'evt_1',
      txid: 'MOCKTXID',
      type: 'pix.approved',
    });
  });

  it('rejeita assinatura ausente', () => {
    expect(() => provider.verifyAndParseWebhook(body, {})).toThrow(HttpError);
  });

  it('rejeita assinatura com secret errado', () => {
    const bad = signMockWebhook(body, 'outro-secret-de-16-chars!!');
    expect(() =>
      provider.verifyAndParseWebhook(body, { [MOCK_SIGNATURE_HEADER]: bad }),
    ).toThrow(/inválida/);
  });

  it('rejeita body adulterado após assinar (proteção do raw body)', () => {
    const sig = signMockWebhook(body, SECRET);
    const tampered = Buffer.from(
      JSON.stringify({ ...event, type: 'pix.canceled' }),
      'utf8',
    );
    expect(() =>
      provider.verifyAndParseWebhook(tampered, { [MOCK_SIGNATURE_HEADER]: sig }),
    ).toThrow(/inválida/);
  });

  it('rejeita tipo de evento desconhecido', () => {
    const weird = Buffer.from(
      JSON.stringify({ eventId: 'e', txid: 't', type: 'pix.hacked' }),
      'utf8',
    );
    expect(() =>
      provider.verifyAndParseWebhook(weird, {
        [MOCK_SIGNATURE_HEADER]: signMockWebhook(weird, SECRET),
      }),
    ).toThrow(/inválido/);
  });
});
