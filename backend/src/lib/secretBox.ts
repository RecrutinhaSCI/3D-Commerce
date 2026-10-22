import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifragem simétrica de segredos guardados no banco (tokens OAuth).
 *
 * AES-256-GCM: IV aleatório de 12 bytes por valor + tag de autenticação.
 * `aad` (dado autenticado, ex.: "melhor_envio:production") amarra o texto
 * cifrado ao registro — um token copiado para outro provedor/ambiente não
 * decifra. Formato: "v1.<iv>.<tag>.<cifra>" em base64url.
 */
const VERSION = 'v1';

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}

export function sealSecret(plaintext: string, key: Buffer, aad: string): string {
  if (key.length !== 32) throw new SecretBoxError('Chave de cifragem precisa ter 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
}

export function openSecret(sealed: string, key: Buffer, aad: string): string {
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new SecretBoxError('Formato de segredo inválido.');
  try {
    const [, iv, tag, enc] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    // Chave trocada, dado adulterado ou AAD diferente — sem detalhes.
    throw new SecretBoxError('Não foi possível decifrar o segredo.');
  }
}
