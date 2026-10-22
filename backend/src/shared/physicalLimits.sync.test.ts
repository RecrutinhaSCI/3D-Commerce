/**
 * Guarda do ARQUIVO ESPELHADO de peso/medidas: a cópia do backend e a do
 * frontend precisam ser idênticas (mesmos limites, precisão e estrutura).
 * Se este teste falhar, copie a versão correta para o outro lado.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as backend from './physicalLimits';
import * as frontend from '../../../src/shared/physicalLimits';

const BACKEND_FILE = resolve(__dirname, 'physicalLimits.ts');
const FRONTEND_FILE = resolve(__dirname, '../../../src/shared/physicalLimits.ts');
// Só normaliza a quebra de linha (CRLF no Windows, LF no Git).
const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

describe('physicalLimits — backend e frontend sincronizados', () => {
  it('os dois arquivos têm exatamente o mesmo conteúdo', () => {
    expect(read(FRONTEND_FILE)).toBe(read(BACKEND_FILE));
  });

  it('mesmos campos, limites e precisão', () => {
    expect(frontend.PHYSICAL_FIELDS).toEqual(backend.PHYSICAL_FIELDS);
    expect(frontend.PHYSICAL_LIMITS).toEqual(backend.PHYSICAL_LIMITS);
  });

  it('mesmo comportamento de arredondamento e validação', () => {
    const samples = [-1, 0, 0.0004, 0.001, 0.004, 0.01, 1.23456, 20.456, 100, 100.0004, 100.01, 300, 300.01, NaN];
    for (const field of backend.PHYSICAL_FIELDS) {
      for (const v of samples) {
        expect(frontend.physicalError(field, v)).toBe(backend.physicalError(field, v));
        if (Number.isFinite(v)) expect(frontend.roundPhysical(field, v)).toBe(backend.roundPhysical(field, v));
      }
    }
    const product = { weight: 1, width: 2, height: 3, depth: null };
    expect(frontend.hasAllPhysical(product)).toBe(backend.hasAllPhysical(product));
  });
});
