import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export interface EncryptedProviderSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

export interface ProviderSecretContext {
  userId: string;
  emailConnectionId: string;
  provider: 'gmail';
}

function decodeKey(value: string): Buffer {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Email credential encryption key is not configured');
  let key: Buffer;
  try {
    key = Buffer.from(trimmed, 'base64');
  } catch {
    throw new Error('Email credential encryption key is invalid');
  }
  if (key.length !== 32) {
    throw new Error('Email credential encryption key must decode to exactly 32 bytes');
  }
  return key;
}

function aad(context: ProviderSecretContext, keyVersion: number): Buffer {
  return Buffer.from([
    'buyflow-email-provider-secret-v1',
    context.provider,
    context.userId,
    context.emailConnectionId,
    String(keyVersion),
  ].join('\0'), 'utf8');
}

export class ProviderCredentialCrypto {
  private readonly key: Buffer;

  constructor(
    keyBase64: string,
    private readonly keyVersion = 1,
  ) {
    if (!Number.isInteger(keyVersion) || keyVersion <= 0) {
      throw new Error('Email credential key version must be a positive integer');
    }
    this.key = decodeKey(keyBase64);
  }

  encrypt(secret: string, context: ProviderSecretContext): EncryptedProviderSecret {
    if (!secret) throw new Error('Provider secret cannot be empty');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(aad(context, this.keyVersion));
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      keyVersion: this.keyVersion,
    };
  }

  decrypt(value: EncryptedProviderSecret, context: ProviderSecretContext): string {
    if (value.keyVersion !== this.keyVersion) {
      throw new Error('Email credential key version is not available');
    }
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        this.key,
        Buffer.from(value.iv, 'base64'),
      );
      decipher.setAAD(aad(context, value.keyVersion));
      decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(value.ciphertext, 'base64')),
        decipher.final(),
      ]);
      return plaintext.toString('utf8');
    } catch {
      throw new Error('Email provider credential could not be decrypted');
    }
  }
}
