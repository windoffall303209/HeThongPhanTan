import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// Derives a fixed-size AES key from the shared secret.
function deriveKey(secret) {
  return crypto.createHash('sha256').update(String(secret)).digest();
}

// Encrypts message text using AES-256-GCM before TCP delivery.
export function encryptText(plainText, secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), 'utf8'),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return {
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  };
}

// Decrypts an AES-256-GCM envelope back to plain text.
export function decryptText(envelope, secret) {
  if (!envelope?.data || !envelope?.iv || !envelope?.tag) {
    throw new Error('Invalid encrypted envelope');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    deriveKey(secret),
    Buffer.from(envelope.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

// Encrypts content only when encryption is enabled in config.
export function maybeEncryptContent(content, options) {
  if (!options.enabled) {
    return { content, encrypted: false, encryption: null };
  }

  return {
    content: null,
    encrypted: true,
    encryption: encryptText(content, options.secret)
  };
}

// Decrypts payload content only when the payload was encrypted.
export function maybeDecryptContent(payload, options) {
  if (!payload.encrypted) return payload.content ?? '';
  return decryptText(payload.encryption, options.secret);
}
