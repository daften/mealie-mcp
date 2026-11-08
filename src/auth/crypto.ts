import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const FORMAT = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Derives the AES key, so MCP_TOKEN_KEY can be any sufficiently long string. */
export function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'mealie-mcp token store v1', 32));
}

/** `context` is authenticated but not stored, so a ciphertext copied to another row won't decrypt there. */
export function encrypt(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${FORMAT}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

/** Throws when the key, context or ciphertext don't match. */
export function decrypt(key: Buffer, sealed: string, context: string): string {
  const [format, payload] = sealed.split('.');
  if (format !== FORMAT || !payload) throw new Error('Unrecognized ciphertext format');
  const raw = Buffer.from(payload, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(prefix: string): string {
  return `${prefix}${randomBytes(32).toString('base64url')}`;
}
