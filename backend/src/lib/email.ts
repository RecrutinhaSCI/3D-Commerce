import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Infra de e-mail transacional. Dois provedores, escolhidos pelas envs:
 *
 * - **Brevo (API HTTP)** — com `BREVO_API_KEY`. Preferido em produção: o
 *   Render Free bloqueia as portas SMTP (25/465/587), e a API usa HTTPS (443).
 * - **SMTP (nodemailer)** — com `SMTP_HOST`. Gmail, e-mail do domínio etc.
 *
 * Os dois usam `SMTP_FROM` como remetente. As envs são OPCIONAIS: sem elas o
 * servidor sobe normalmente e o envio entra em "modo dev" — `sendEmail` apenas
 * loga um aviso e retorna sem erro, deixando o resto do sistema funcionar.
 *
 * Segurança: nunca logamos `SMTP_PASS`/`BREVO_API_KEY` nem o corpo do e-mail
 * (pode conter links de reset/verificação e outros dados sensíveis).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Fallback texto puro. Opcional — recomendado para acessibilidade/spam. */
  text?: string;
  /** Responder para (ex.: e-mail do cliente no formulário de contato). */
  replyTo?: string;
}

export interface SendEmailResult {
  /** true = entregue ao provedor; false = pulado (modo dev, e-mail não configurado). */
  sent: boolean;
  /** messageId retornado pelo provedor quando enviado. */
  messageId?: string;
}

/** Provedor ativo, ou null em "modo dev". Brevo tem prioridade sobre SMTP. */
export function emailProvider(): 'brevo' | 'smtp' | null {
  if (!env.SMTP_FROM) return null;
  if (env.BREVO_API_KEY) return 'brevo';
  if (env.SMTP_HOST) return 'smtp';
  return null;
}

/**
 * "Loja <loja@x.com>" → { name: 'Loja', email: 'loja@x.com' }; "loja@x.com" →
 * { email }. A API do Brevo exige o remetente separado em nome + e-mail.
 */
export function parseAddress(value: string): { name?: string; email: string } {
  const m = value.match(/^\s*"?([^"<]*?)"?\s*<\s*([^>]+?)\s*>\s*$/);
  if (m) return m[1] ? { name: m[1], email: m[2] } : { email: m[2] };
  return { email: value.trim() };
}

let transporter: Transporter | null = null;

/** Cria (uma vez) o transporter SMTP a partir das envs. */
function getTransporter(): Transporter {
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    // Default sensato: 465 => TLS implícito (secure), senão 587 (STARTTLS).
    port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
    secure: env.SMTP_SECURE ?? env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
    // Timeouts curtos: o envio acontece DENTRO da requisição (pedido, pagamento,
    // senha). Os padrões do nodemailer chegam a minutos — um SMTP travado faria
    // o cliente receber erro com o pedido já criado. Com 5s a falha é engolida
    // pelos chamadores (e-mail nunca derruba o fluxo) e a resposta segue.
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
  });

  return transporter;
}

const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

/** Envio pela API transacional do Brevo. Lança em erro (o chamador engole). */
async function sendViaBrevo(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text, replyTo } = input;
  const res = await fetch(BREVO_SEND_URL, {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY as string,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: parseAddress(env.SMTP_FROM as string),
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(text ? { textContent: text } : {}),
      ...(replyTo ? { replyTo: parseAddress(replyTo) } : {}),
    }),
    // Mesmo motivo dos timeouts do SMTP: não segurar a requisição do cliente.
    signal: AbortSignal.timeout(8_000),
  });

  const data = (await res.json().catch(() => ({}))) as { messageId?: string; code?: string; message?: string };
  if (!res.ok) {
    // `code`/`message` do Brevo explicam a falha (chave inválida, remetente
    // não verificado...) e não contêm a chave nem o corpo do e-mail.
    throw new Error(`Brevo recusou o envio (HTTP ${res.status}): ${data.code ?? ''} ${data.message ?? ''}`.trim());
  }
  return { sent: true, messageId: data.messageId };
}

/**
 * Envia um e-mail pelo provedor configurado. Em "modo dev" (nenhum
 * configurado), loga um aviso e retorna `{ sent: false }` sem lançar erro.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text, replyTo } = input;
  const provider = emailProvider();

  if (!provider) {
    // Aviso sem dados sensíveis: só subject e destinatário.
    // eslint-disable-next-line no-console
    console.warn(`[email] E-mail não configurado — e-mail não enviado: ${subject} -> ${to}`);
    return { sent: false };
  }

  if (provider === 'brevo') return sendViaBrevo(input);

  const info = await getTransporter().sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  return { sent: true, messageId: info.messageId };
}
