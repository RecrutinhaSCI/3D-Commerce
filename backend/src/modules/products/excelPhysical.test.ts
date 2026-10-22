/**
 * Peso/dimensões na planilha de produtos (sem banco): export → parse e
 * validação das colunas peso_kg, largura_cm, altura_cm, profundidade_cm.
 */
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { buildExportRows, parseWorkbook } from '../../../../src/utils/productExcel';
import type { ApiProduct } from '../../../../src/services/types';

function workbookFrom(rows: Array<Record<string, unknown>>): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Produtos');
  // Ida e volta pelo binário, como no arquivo real.
  return XLSX.read(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
}

describe('planilha — peso e dimensões', () => {
  it('exporta e reimporta os 4 campos', () => {
    const product = {
      id: 'p1', sku: 'PLA-1', name: 'PLA Preto 1kg', slug: 'pla-preto-1kg', brand: null, material: 'PLA',
      images: [], category: { id: 'c1', name: 'Filamentos PLA', slug: 'pla' }, shortDescription: null,
      description: null, price: 129.9, promotionalPrice: null, stock: 3, active: true, featured: false,
      weight: 1.25, width: 21, height: 8, depth: 21, createdAt: null, stockUpdatedAt: null,
    } as unknown as ApiProduct;

    const exported = buildExportRows([product])[0];
    expect(exported).toMatchObject({ peso_kg: 1.25, largura_cm: 21, altura_cm: 8, profundidade_cm: 21 });

    const { rows } = parseWorkbook(workbookFrom([exported]));
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].data).toMatchObject({ weight: 1.25, width: 21, height: 8, depth: 21 });
  });

  it('célula vazia não envia o campo (preserva o valor atual)', () => {
    const { rows } = parseWorkbook(workbookFrom([{ sku: 'PLA-1', peso_kg: '', largura_cm: 20 }]));
    expect(rows[0].data.weight).toBeUndefined();
    expect(rows[0].data.width).toBe(20);
  });

  it('aceita aliases (peso, comprimento) e vírgula decimal', () => {
    const { rows } = parseWorkbook(workbookFrom([{ sku: 'PLA-1', peso: '1,3', comprimento: '22,5' }]));
    expect(rows[0].errors).toEqual([]);
    expect(rows[0].data).toMatchObject({ weight: 1.3, depth: 22.5 });
  });

  it('recusa zero, negativo, texto e peso fora do limite (ex.: gramas)', () => {
    const { rows } = parseWorkbook(
      workbookFrom([
        { sku: 'A', peso_kg: 0 },
        { sku: 'B', altura_cm: -5 },
        { sku: 'C', largura_cm: 'grande' },
        { sku: 'D', peso_kg: 1250 },
      ]),
    );
    expect(rows.map((r) => r.errors.length)).toEqual([1, 1, 1, 1]);
    expect(rows.every((r) => r.data.weight === undefined && r.data.width === undefined && r.data.height === undefined)).toBe(true);
  });
});
