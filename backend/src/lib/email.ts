import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';

/**
 * Infra de e-mail transacional (SMTP via nodemailer).
 *
 * As envs SMTP são OPCIONAIS. Sem elas o servidor sobe normalmente e o envio
 * entra em "modo dev": `sendEmail` apenas loga um aviso e retorna sem erro,
 * deixando o resto do sistema funcionar sem SMTP configurado.
 *
 * Segurança: nunca logamos `SMTP_PASS` nem o corpo do e-mail (pode conter
 * links de reset/verificação e outros dados sensíveis).
 */

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Fallback texto puro. Opcional — recomendado para acessibilidade/spam. */
  text?: string;
}

export interface SendEmailResult {
  /** true = entregue ao SMTP; false = pulado (modo dev, SMTP não configurado). */
  sent: boolean;
  /** messageId retornado pelo SMTP quando enviado. */
  messageId?: string;
}

/** SMTP está configurado o suficiente para enviar? (host + from são o mínimo). */
const isSmtpConfigured = (): boolean => Boolean(env.SMTP_HOST && env.SMTP_FROM);

let transporter: Transporter | null = null;

/** Cria (uma vez) o transporter a partir das envs. Null se não configurado. */
function getTransporter(): Transporter | null {
  if (!isSmtpConfigured()) return null;
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

/**
 * Envia um e-mail via SMTP. Em "modo dev" (SMTP não configurado), loga um
 * aviso e retorna `{ sent: false }` sem lançar erro.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text } = input;
  const tx = getTransporter();

  if (!tx) {
    // Aviso sem dados sensíveis: só subject e destinatário.
    // eslint-disable-next-line no-console
    console.warn(`[email] SMTP não configurado — e-mail não enviado: ${subject} -> ${to}`);
    return { sent: false };
  }

  const info = await tx.sendMail({
    from: env.SMTP_FROM,
    to,
    subject,
    html,
    text,
  });

  return { sent: true, messageId: info.messageId };
}
