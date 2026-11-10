import { z } from 'zod';

const digits = (v: string) => v.replace(/\D/g, '');

function validCpf(cpf: string): boolean {
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const check = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const rest = (sum * 10) % 11;
    return (rest === 10 ? 0 : rest) === Number(cpf[len]);
  };
  return check(9) && check(10);
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

const baseFields = {
  name: z.string().trim().min(2, 'Informe o nome.').max(120),
  phone: z.preprocess(emptyToNull, z.string().trim().min(8, 'Telefone inválido.').max(30).nullable().optional()),
  email: z.preprocess(
    emptyToNull,
    z.string().trim().toLowerCase().email('E-mail inválido.').max(160).nullable().optional(),
  ),
  document: z.preprocess(
    emptyToNull,
    z
      .string()
      .transform(digits)
      .refine((v) => (v.length === 11 ? validCpf(v) : v.length === 14), 'CPF/CNPJ inválido.')
      .nullable()
      .optional(),
  ),
  notes: z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
};

export const createCustomerSchema = z.object(baseFields);
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z.object(baseFields).partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

export const customersQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CustomersQuery = z.infer<typeof customersQuerySchema>;
