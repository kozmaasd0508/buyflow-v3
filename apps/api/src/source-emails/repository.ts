import type { NormalizedEmail } from '../email/types.js';

export interface SaveSourceEmailInput {
  userId: string;
  emailConnectionId: string;
  sourceQuery: string;
  email: NormalizedEmail;
}

export interface SaveSourceEmailResult {
  created: boolean;
  id?: string;
}

export interface SourceEmailRepository {
  insertIfNew(input: SaveSourceEmailInput): Promise<SaveSourceEmailResult>;
}
