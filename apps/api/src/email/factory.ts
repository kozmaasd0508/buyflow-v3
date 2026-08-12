import { requireNylasConfig } from '../config.js';
import type { EmailProvider } from './provider.js';
import { NylasEmailProvider } from './nylas-provider.js';

export function createEmailProvider(): EmailProvider {
  const config = requireNylasConfig();
  return new NylasEmailProvider(config);
}
