import { requireNylasApiConfig } from '../config.js';
import type { EmailProvider } from './provider.js';
import { NylasEmailProvider } from './nylas-provider.js';

export interface EmailConnectionDescriptor {
  provider: 'nylas' | 'gmail';
  providerAccountId: string;
}

export function createEmailProvider(
  connection: EmailConnectionDescriptor,
): EmailProvider {
  if (connection.provider === 'nylas') {
    const config = requireNylasApiConfig();
    return new NylasEmailProvider({
      ...config,
      grantId: connection.providerAccountId,
    });
  }

  throw new Error('Direct Gmail provider is not implemented yet.');
}
