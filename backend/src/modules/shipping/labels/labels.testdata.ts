/**
 * Geradores de documentos VÁLIDOS (dígitos verificadores calculados) só para
 * testes — nenhum dado real.
 */
export function makeCnpj(base12: string): string {
  const d = base12.split('').map(Number);
  const dv = (weights: number[]) => {
    const r = weights.reduce((s, w, i) => s + d[i] * w, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  d.push(dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  d.push(dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return d.join('');
}

/** Chave de NF-e (modelo 55) com DV módulo 11 válido. */
export function makeNfeKey(cnpj: string, opts: { model?: string; uf?: string } = {}): string {
  const body = `${opts.uf ?? '43'}2610${cnpj}${opts.model ?? '55'}001000001234100000001`;
  if (body.length !== 43) throw new Error(`corpo da chave com ${body.length} dígitos`);
  let sum = 0;
  let w = 2;
  for (let i = 42; i >= 0; i--) {
    sum += Number(body[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return body + (r < 2 ? 0 : 11 - r);
}

export const TEST_CNPJ = makeCnpj('112223330001');
export const OTHER_CNPJ = makeCnpj('998887770001');
/** CPF de teste com DV válido (gerado, não pertence a ninguém conhecido). */
export const TEST_CPF = '52998224725';

export const validSenderInput = () => ({
  name: 'Loja Teste 3D',
  document: TEST_CNPJ.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
  stateRegister: '123/4567890',
  economicActivityCode: '4751-2/01',
  phone: '(54) 99999-0000',
  email: 'Envio@Loja.Test',
  postalCode: '95700-000',
  address: 'Rua das Impressoras',
  number: '100',
  complement: '',
  district: 'Centro',
  city: 'Bento Gonçalves',
  stateAbbr: 'rs',
});
