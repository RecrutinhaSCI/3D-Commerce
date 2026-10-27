import { z } from 'zod';
import { onlyDigits } from '../../../utils/cpf';
import { senderDocumentType, type ShippingSender } from './sender';

/**
 * Modalidade fiscal da etiqueta: declaração de conteúdo OU NF-e. Não emitimos
 * nota — só recebemos a CHAVE (44 dígitos) quando o envio é comercial.
 *
 * Campos do Melhor Envio (POST /api/v2/me/cart, documentação oficial):
 *   options.non_commercial = true      → declaração de conteúdo
 *   options.invoice.key + from.state_register → envio comercial com NF-e
 */

export type FiscalMode = 'DECLARATION' | 'NFE';

/**
 * Chave de acesso da NF-e: 44 dígitos, modelo 55 (posições 21–22) e dígito
 * verificador módulo 11 (pesos 2..9 da direita para a esquerda).
 */
export function isValidNfeKey(raw: string): boolean {
  const key = onlyDigits(raw);
  if (!/^\d{44}$/.test(key)) return false;
  if (key.slice(20, 22) !== '55') return false;
  let sum = 0;
  let weight = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(key[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  const dv = rest < 2 ? 0 : 11 - rest;
  return dv === Number(key[43]);
}

/** CNPJ do emitente embutido na chave (posições 7–20). */
export const nfeKeyIssuerCnpj = (key: string) => onlyDigits(key).slice(6, 20);

export const fiscalSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('DECLARATION') }).strict(),
  z
    .object({
      mode: z.literal('NFE'),
      nfeKey: z
        .string({ required_error: 'Informe a chave da NF-e.' })
        .transform(onlyDigits)
        .refine(isValidNfeKey, 'Chave da NF-e inválida (44 dígitos, modelo 55, dígito verificador).'),
    })
    .strict(),
]);
export type FiscalSelection = z.infer<typeof fiscalSelectionSchema>;

/**
 * Só bloqueia o que a API EXIGE (documentação de inserção no carrinho): envio
 * comercial precisa de `invoice.key` e `from.state_register`. O resto (CPF no
 * remetente, IE "ISENTO", chave de outro CNPJ) vira AVISO — quem valida a
 * regra fiscal/da transportadora é o Melhor Envio.
 */
export class FiscalError extends Error {
  constructor(
    public readonly code: 'SENDER_MISSING' | 'NFE_REQUIRES_STATE_REGISTER',
    message: string,
  ) {
    super(message);
    this.name = 'FiscalError';
  }
}

/** Partes fiscais do payload do carrinho (o resto vem de `buildCartPayload`). */
export interface FiscalPayloadParts {
  options: { non_commercial: true } | { non_commercial: false; invoice: { key: string } };
  /** Valor para `from.state_register` (vazio na declaração de conteúdo). */
  fromStateRegister: string;
  /** Persistência em shipment_labels. */
  fiscalMode: FiscalMode;
  nfeKey: string | null;
  /** Pontos de atenção que NÃO bloqueiam (o Melhor Envio decide). */
  warnings: string[];
}

/**
 * Monta as partes fiscais conforme a modalidade escolhida pelo admin.
 * NF-e: chave válida (já garantida pelo schema) + inscrição estadual.
 */
export function buildFiscalPayloadParts(selection: FiscalSelection, sender: ShippingSender | null): FiscalPayloadParts {
  if (!sender) throw new FiscalError('SENDER_MISSING', 'Cadastre o remetente antes de gerar etiquetas.');
  if (selection.mode === 'DECLARATION') {
    return { options: { non_commercial: true }, fromStateRegister: '', fiscalMode: 'DECLARATION', nfeKey: null, warnings: [] };
  }
  if (!sender.stateRegister) {
    throw new FiscalError('NFE_REQUIRES_STATE_REGISTER', 'Envio com NF-e exige a inscrição estadual do remetente.');
  }
  return {
    options: { non_commercial: false, invoice: { key: selection.nfeKey } },
    fromStateRegister: sender.stateRegister,
    fiscalMode: 'NFE',
    nfeKey: selection.nfeKey,
    warnings: nfeWarnings(sender, selection.nfeKey),
  };
}

/** Avisos (não bloqueiam) de um envio com NF-e. */
export function nfeWarnings(sender: ShippingSender, nfeKey?: string): string[] {
  const warnings: string[] = [];
  if (senderDocumentType(sender) !== 'CNPJ') warnings.push('Remetente com CPF: confira se a NF-e é aceita pelo Melhor Envio.');
  if (sender.stateRegister === 'ISENTO') warnings.push('Inscrição estadual "ISENTO" em envio com NF-e: confira com o Melhor Envio.');
  if (nfeKey && senderDocumentType(sender) === 'CNPJ' && nfeKeyIssuerCnpj(nfeKey) !== sender.document) {
    warnings.push('A chave da NF-e foi emitida por outro CNPJ, diferente do remetente.');
  }
  return warnings;
}
