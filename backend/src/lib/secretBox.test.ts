import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, SecretBoxError } from './secretBox';

const key = randomBytes(32);

describe('secretBox (AES-256-GCM)', () => {
  it('cifra e decifra; texto cifrado não contém o original e muda a cada vez (IV aleatório)', () => {
    const a = sealSecret('token-123', key, 'melhor_envio:sandbox');
    const b = sealSecret('token-123', key, 'melhor_envio:sandbox');
    expect(a).not.toContain('token-123');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(openSecret(a, key, 'melhor_envio:sandbox')).toBe('token-123');
  });

  it('chave errada, AAD diferente ou dado adulterado: falha sem detalhes', () => {
    const sealed = sealSecret('token-123', key, 'melhor_envio:sandbox');
    expect(() => openSecret(sealed, randomBytes(32), 'melhor_envio:sandbox')).toThrow(SecretBoxError);
    expect(() => openSecret(sealed, key, 'melhor_envio:production')).toThrow(SecretBoxError);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('x' + parts[3]).toString('base64url');
    expect(() => openSecret(parts.join('.'), key, 'melhor_envio:sandbox')).toThrow(SecretBoxError);
    expect(() => openSecret('lixo', key, 'x')).toThrow(SecretBoxError);
  });

  it('exige chave de 32 bytes', () => {
    expect(() => sealSecret('x', randomBytes(16), 'a')).toThrow(SecretBoxError);
  });
});
