/**
 * Peso/medidas nos schemas de produto (regra única em shared/physicalLimits):
 * obrigatórios na criação, opcionais na edição, texto inválido é ERRO (nunca
 * vira `null` em silêncio), arredondados à precisão da coluna.
 */
import { describe, expect, it } from 'vitest';
import { bulkImportSchema, createProductSchema, updateProductSchema } from './products.schemas';
import { physicalError, PHYSICAL_LIMITS, roundPhysical } from '../../shared/physicalLimits';

const BASE = { categoryId: 'c1', name: 'PLA Preto', price: 99.9 };
const MEDIDAS = { weight: 1.25, width: 21, height: 8, depth: 21 };

describe('regra compartilhada', () => {
  it('limites e precisão', () => {
    expect(PHYSICAL_LIMITS.weight).toMatchObject({ min: 0.001, max: 100, decimals: 3 });
    expect(PHYSICAL_LIMITS.depth).toMatchObject({ min: 0.01, max: 300, decimals: 2 });
    expect(roundPhysical('width', 20.456)).toBe(20.46);
    expect(roundPhysical('weight', 1.23456)).toBe(1.235);
  });

  it('valor que arredonda para zero é recusado', () => {
    expect(physicalError('width', 0.004)).not.toBeNull();
    expect(physicalError('weight', 0.0004)).not.toBeNull();
    expect(physicalError('width', 0.01)).toBeNull();
  });
});

describe('createProductSchema', () => {
  it('exige as 4 medidas', () => {
    const r = createProductSchema.safeParse(BASE);
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path[0]);
    expect(paths).toEqual(expect.arrayContaining(['weight', 'width', 'height', 'depth']));
  });

  it('aceita número, texto numérico e vírgula; arredonda', () => {
    const r = createProductSchema.parse({ ...BASE, weight: '1,2346', width: '20.456', height: 8, depth: 21 });
    expect(r).toMatchObject({ weight: 1.235, width: 20.46, height: 8, depth: 21 });
  });

  it.each([
    ['texto inválido', 'abc'],
    ['vazio', ''],
    ['null', null],
    ['zero', 0],
    ['negativo', -1],
    ['acima do limite', 101],
  ])('recusa peso %s', (_label, weight) => {
    expect(createProductSchema.safeParse({ ...BASE, ...MEDIDAS, weight }).success).toBe(false);
  });

  it('recusa medida acima de 300 cm', () => {
    expect(createProductSchema.safeParse({ ...BASE, ...MEDIDAS, depth: 301 }).success).toBe(false);
  });
});

describe('updateProductSchema', () => {
  it('produto antigo: edição sem medidas continua permitida (ausente = preserva)', () => {
    const r = updateProductSchema.parse({ price: 120 });
    expect(r.weight).toBeUndefined();
    expect(r.width).toBeUndefined();
  });

  it('se vier, precisa ser válido — texto inválido não apaga a medida', () => {
    expect(updateProductSchema.safeParse({ weight: 'abc' }).success).toBe(false);
    expect(updateProductSchema.safeParse({ weight: null }).success).toBe(false);
    expect(updateProductSchema.safeParse({ width: -2 }).success).toBe(false);
    expect(updateProductSchema.parse({ width: 22.45 }).width).toBe(22.45);
  });
});

describe('bulkImportSchema', () => {
  it('medidas opcionais, mesmos limites', () => {
    expect(bulkImportSchema.safeParse({ rows: [{ line: 2, sku: 'A' }] }).success).toBe(true);
    expect(bulkImportSchema.safeParse({ rows: [{ line: 2, sku: 'A', weight: 1250 }] }).success).toBe(false);
    expect(bulkImportSchema.safeParse({ rows: [{ line: 2, sku: 'A', width: 0.004 }] }).success).toBe(false);
  });
});
