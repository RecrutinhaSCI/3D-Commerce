/**
 * Templates de e-mail transacional do 3DCommerce.
 *
 * Cada função retorna apenas `{ subject, html, text }` — NÃO dispara nada.
 * O disparo por evento (pedido criado, pagamento aprovado, etc.) é outra
 * tarefa; aqui só montamos o conteúdo, pronto para passar ao `sendEmail`.
 */

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

const BRAND = '3DCommerce';

/** Item resumido de um pedido, para listar no corpo do e-mail. */
export interface OrderEmailItem {
  productName: string;
  quantity: number;
}

/** Dados do pedido usados para enriquecer os e-mails transacionais. */
export interface OrderEmailData {
  /** Id do pedido — exibido ao cliente como número do pedido. */
  orderId: string;
  /** Total do pedido em reais (number). */
  total: number;
  /** Itens do pedido (opcional). */
  items?: OrderEmailItem[];
}

/** Escapa texto para interpolar com segurança em HTML (evita quebra/injeção). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Formata um valor numérico como moeda BRL (ex.: R$ 1.234,56). */
function formatBRL(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Tabela HTML simples com os itens do pedido (nome x quantidade). */
function itemsTable(items: OrderEmailItem[]): string {
  if (items.length === 0) return '';
  const rows = items
    .map(
      (it) =>
        `<tr>
          <td style="padding:6px 0;font-size:14px;color:#3f3f46;">${escapeHtml(it.productName)}</td>
          <td style="padding:6px 0;font-size:14px;color:#3f3f46;text-align:right;">x${it.quantity}</td>
        </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border-top:1px solid #e4e4e7;">
    ${rows}
  </table>`;
}

/**
 * Layout base: título + corpo HTML com a marca. `bodyHtml` já vem como HTML
 * (o chamador é responsável por escapar valores dinâmicos que embutir nele).
 */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body style="margin:0;background:#f4f4f5;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="background:#111827;padding:20px 28px;">
          <span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:0.5px;">${BRAND}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:20px;color:#111827;">${escapeHtml(title)}</h1>
          <div style="font-size:15px;line-height:1.6;color:#3f3f46;">${bodyHtml}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 28px;border-top:1px solid #e4e4e7;font-size:12px;color:#a1a1aa;">
          Este é um e-mail automático do ${BRAND}. Por favor, não responda.
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Botão HTML simples para call-to-action (usado em links de reset/verificação). */
function button(label: string, href: string): string {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;">${escapeHtml(label)}</a>
  </p>`;
}

/** E-mail: pedido criado (aguardando pagamento). */
export function orderCreatedEmail(order: OrderEmailData): EmailContent {
  const subject = `Recebemos seu pedido — ${BRAND}`;
  const html = layout(
    'Pedido recebido',
    `<p>Obrigado pela sua compra! Recebemos seu pedido <strong>#${escapeHtml(order.orderId)}</strong> e ele já está registrado.</p>
     ${itemsTable(order.items ?? [])}
     <p>Total: <strong>${formatBRL(order.total)}</strong></p>
     <p>Assim que o pagamento for confirmado, avisaremos você por aqui.</p>`,
  );
  const text =
    `Recebemos seu pedido #${order.orderId} (total ${formatBRL(order.total)})! ` +
    'Assim que o pagamento for confirmado, avisaremos você.';
  return { subject, html, text };
}

/** E-mail: pagamento aprovado. */
export function paymentApprovedEmail(order: Pick<OrderEmailData, 'orderId' | 'total'>): EmailContent {
  const subject = `Pagamento aprovado — ${BRAND}`;
  const html = layout(
    'Pagamento aprovado',
    `<p>Seu pagamento do pedido <strong>#${escapeHtml(order.orderId)}</strong> foi aprovado com sucesso.</p>
     <p>Valor: <strong>${formatBRL(order.total)}</strong></p>
     <p>Já estamos preparando seu pedido para envio. Você receberá o código de rastreio assim que ele for despachado.</p>`,
  );
  const text =
    `Seu pagamento do pedido #${order.orderId} (${formatBRL(order.total)}) foi aprovado. ` +
    'Já estamos preparando seu pedido para envio.';
  return { subject, html, text };
}

/** E-mail: pedido enviado, com código de rastreio. */
export function orderShippedEmail(trackingCode: string, orderId?: string): EmailContent {
  const subject = `Seu pedido foi enviado — ${BRAND}`;
  const orderLine = orderId
    ? `<p>Seu pedido <strong>#${escapeHtml(orderId)}</strong> está a caminho!</p>`
    : `<p>Boas notícias: seu pedido está a caminho!</p>`;
  const html = layout(
    'Pedido enviado',
    `${orderLine}
     <p>Código de rastreio:</p>
     <p style="font-size:18px;font-weight:bold;letter-spacing:1px;color:#111827;">${escapeHtml(trackingCode)}</p>`,
  );
  const text = orderId
    ? `Seu pedido #${orderId} foi enviado! Código de rastreio: ${trackingCode}`
    : `Seu pedido foi enviado! Código de rastreio: ${trackingCode}`;
  return { subject, html, text };
}

/** E-mail: redefinição de senha, com link. */
export function passwordResetEmail(link: string): EmailContent {
  const subject = `Redefinição de senha — ${BRAND}`;
  const html = layout(
    'Redefinir sua senha',
    `<p>Recebemos um pedido para redefinir a senha da sua conta.</p>
     ${button('Redefinir senha', link)}
     <p style="font-size:13px;color:#71717a;">Se você não solicitou, ignore este e-mail — sua senha continua a mesma. O link expira em breve.</p>`,
  );
  const text = `Redefina sua senha pelo link: ${link}\nSe você não solicitou, ignore este e-mail.`;
  return { subject, html, text };
}

/** E-mail: verificação de endereço de e-mail, com link. */
export function verifyEmail(link: string): EmailContent {
  const subject = `Confirme seu e-mail — ${BRAND}`;
  const html = layout(
    'Confirme seu e-mail',
    `<p>Bem-vindo(a) ao ${BRAND}! Confirme seu endereço de e-mail para ativar sua conta.</p>
     ${button('Confirmar e-mail', link)}
     <p style="font-size:13px;color:#71717a;">Se você não criou esta conta, ignore este e-mail.</p>`,
  );
  const text = `Confirme seu e-mail pelo link: ${link}`;
  return { subject, html, text };
}
