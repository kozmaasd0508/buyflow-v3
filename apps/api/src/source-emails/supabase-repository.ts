import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  SaveSourceEmailInput,
  SaveSourceEmailResult,
  SourceEmailRepository,
} from './repository.js';

export class SupabaseSourceEmailRepository implements SourceEmailRepository {
  constructor(private readonly client: SupabaseClient) {}

  async insertIfNew(
    input: SaveSourceEmailInput,
  ): Promise<SaveSourceEmailResult> {
    const fromAddress = input.email.from[0]?.email ?? null;

    const { data, error } = await this.client
      .from('source_emails')
      .insert({
        user_id: input.userId,
        email_connection_id: input.emailConnectionId,
        provider_message_id: input.email.providerMessageId,
        provider_thread_id: input.email.providerThreadId ?? null,
        from_address: fromAddress,
        subject: input.email.subject ?? null,
        received_at: input.email.receivedAt,
        source_query: input.sourceQuery,
        processing_status: 'pending',
      })
      .select('id')
      .single();

    if (error?.code === '23505') {
      return { created: false };
    }

    if (error) {
      throw new Error(`Failed to save source email: ${error.message}`);
    }

    return {
      created: true,
      id: data.id as string,
    };
  }
}
