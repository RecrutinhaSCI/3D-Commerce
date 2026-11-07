import { z } from 'zod';
import { isValidCnpj, isValidCpf, onlyDigits } from '../../../utils/cpf';

/**
 * Remetente das etiquetas (dados da loja que vão no `from` do Melhor Envio).
 * Fica em site_settings.shipping_sender_json e é SÓ do admin — nunca entra no
 * DTO público de settings.
 */

export const BR_STATES = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

const text = (min: number, max: number, label: string) =>
  z.string({ required_error: `${label} é obrigatório.` }).trim().min(min, `${label} é obrigatório.`).max(max, `${label}: máximo de ${max} caracteres.`);

/** Texto opcional: vazio vira null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));

export const senderSchema = z
  .object({
    name: text(2, 100, 'Nome do remetente'),
    /** CPF (11) ou CNPJ (14), com ou sem máscara — gravado só com dígitos. */
    document: z
      .string({ required_error: 'CPF/CNPJ é obrigatório.' })
      .transform(onlyDigits)
      .refine((d) => (d.length === 14 ? isValidCnpj(d) : d.length === 11 ? isValidCpf(d) : false), 'CPF ou CNPJ inválido.'),
    /** Inscrição estadual (só dígitos) ou "ISENTO". Obrigatória para envio com NF-e. */
    stateRegister: z
      .string()
      .trim()
      .nullable()
      .optional()
      .transform((v) => {
        if (!v) return null;
        return /^isento$/i.test(v) ? 'ISENTO' : onlyDigits(v);
      })
      .refine((v) => v === null || v === 'ISENTO' || /^\d{2,20}$/.test(v), 'Inscrição estadual inválida (só números ou "ISENTO").'),
    /** CNAE (7 dígitos) — opcional. */
    economicActivityCode: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v ? onlyDigits(v) : null))
      .refine((v) => v === null || /^\d{7}$/.test(v), 'CNAE inválido (7 dígitos).'),
    phone: z
      .string({ required_error: 'Telefone é obrigatório.' })
      .transform(onlyDigits)
      .refine((d) => /^\d{10,11}$/.test(d), 'Telefone inválido (DDD + número).'),
    email: z.string({ required_error: 'E-mail é obrigatório.' }).trim().toLowerCase().email('E-mail inválido.').max(120),
    postalCode: z
      .string({ required_error: 'CEP é obrigatório.' })
      .transform(onlyDigits)
      .refine((d) => /^\d{8}$/.test(d), 'CEP inválido (8 dígitos).'),
    address: text(2, 150, 'Endereço'),
    number: text(1, 20, 'Número'),
    complement: optionalText(60),
    district: text(2, 80, 'Bairro'),
    city: text(2, 80, 'Cidade'),
    stateAbbr: z
      .string({ required_error: 'UF é obrigatória.' })
      .trim()
      .toUpperCase()
      .refine((v): v is (typeof BR_STATES)[number] => (BR_STATES as readonly string[]).includes(v), 'UF inválida.'),
  })
  .strict();

export type ShippingSender = z.infer<typeof senderSchema>;

/** JSON gravado → remetente válido, ou null (registro ausente ou corrompido). */
export function parseStoredSender(raw: unknown): ShippingSender | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = senderSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type SenderDocumentType = 'CPF' | 'CNPJ';
export const senderDocumentType = (s: Pick<ShippingSender, 'document'>): SenderDocumentType =>
  s.document.length === 14 ? 'CNPJ' : 'CPF';

export interface SenderReadiness {
  /** Pronto para declaração de conteúdo. */
  declaration: boolean;
  /** Pronto para envio com NF-e (a API exige a inscrição estadual). */
  nfe: boolean;
  /** Pendências e avisos em português, sem dados sensíveis. */
  issues: string[];
}

/**
 * O que falta no remetente para cada modalidade fiscal. Só a IE bloqueia a
 * NF-e (exigência documentada da API); CPF/"ISENTO" viram aviso. `originCep`
 * é o SHIPPING_ORIGIN_CEP da cotação: se diferir, o preço cotado ao cliente
 * saiu de outro CEP — também aviso.
 */
export function senderReadiness(sender: ShippingSender | null, originCep: string | null): SenderReadiness {
  if (!sender) {
    return { declaration: false, nfe: false, issues: ['Cadastre o remetente (dados da loja) em Configurações → Remetente das etiquetas.'] };
  }
  const issues: string[] = [];
  const hasIe = Boolean(sender.stateRegister);
  if (!hasIe) issues.push('Envio com NF-e exige a inscrição estadual do remetente.');
  else if (senderDocumentType(sender) !== 'CNPJ') issues.push('Remetente com CPF: confira se a NF-e é aceita pelo Melhor Envio.');
  else if (sender.stateRegister === 'ISENTO') issues.push('Inscrição estadual "ISENTO" em envio com NF-e: confira com o Melhor Envio.');
  if (originCep && originCep !== sender.postalCode) {
    issues.push('O CEP do remetente é diferente do CEP de origem usado na cotação (SHIPPING_ORIGIN_CEP).');
  }
  return { declaration: true, nfe: hasIe, issues };
}

/**
 * Sugestão para o primeiro cadastro, a partir das configurações da loja
 * (nome, CNPJ, e-mail, WhatsApp) e do CEP de origem. Nunca é gravada sozinha.
 */
export function suggestSender(settings: { storeName: string; cnpj: string | null; email: string; whatsapp: string }, originCep: string | null) {
  return {
    name: settings.storeName,
    document: settings.cnpj ? onlyDigits(settings.cnpj) : '',
    stateRegister: null,
    economicActivityCode: null,
    phone: onlyDigits(settings.whatsapp).replace(/^55(?=\d{10,11}$)/, ''),
    email: settings.email,
    postalCode: originCep ?? '',
    address: '',
    number: '',
    complement: null,
    district: '',
    city: '',
    stateAbbr: '',
  };
}
