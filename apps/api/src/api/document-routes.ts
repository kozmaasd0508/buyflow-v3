import type { FastifyInstance } from 'fastify';
import { getSupabaseAdmin } from '../db/supabase-admin.js';
import { resolveAuthenticatedApiUser } from './auth.js';
import {
  DOCUMENT_SIGNED_URL_TTL_SECONDS,
  isDocumentId,
  isPrivateStoredPdf,
} from './document-access.js';

export async function registerDocumentRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/documents/:id/open', async (request, reply) => {
    const user = await resolveAuthenticatedApiUser(request.headers.authorization);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });

    const documentId = request.params.id;
    if (!isDocumentId(documentId)) {
      return reply.code(400).send({ error: 'invalid_document_id' });
    }

    const supabase = getSupabaseAdmin() as any;
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('id,purchase_id,source_type,filename,mime_type,storage_bucket,storage_path')
      .eq('id', documentId)
      .maybeSingle();

    if (documentError) {
      request.log.error({ errorType: 'DocumentReadError' }, 'Failed to load document for signed access');
      return reply.code(500).send({ error: 'document_unavailable' });
    }
    if (!document) return reply.code(404).send({ error: 'document_not_found' });

    const { data: purchase, error: purchaseError } = await supabase
      .from('purchases')
      .select('id,user_id')
      .eq('id', document.purchase_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (purchaseError) {
      request.log.error({ errorType: 'DocumentOwnerReadError' }, 'Failed to verify document ownership');
      return reply.code(500).send({ error: 'document_unavailable' });
    }
    if (!purchase) return reply.code(404).send({ error: 'document_not_found' });

    const access = {
      sourceType: document.source_type as string | null,
      mimeType: document.mime_type as string | null,
      storageBucket: document.storage_bucket as string | null,
      storagePath: document.storage_path as string | null,
    };
    if (!isPrivateStoredPdf(access)) {
      return reply.code(409).send({ error: 'document_not_openable' });
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(access.storageBucket!)
      .createSignedUrl(access.storagePath!, DOCUMENT_SIGNED_URL_TTL_SECONDS);

    if (signedError || !signed?.signedUrl) {
      request.log.error({ errorType: 'DocumentSignedUrlError' }, 'Failed to create private document signed URL');
      return reply.code(500).send({ error: 'document_open_unavailable' });
    }

    reply.header('Cache-Control', 'no-store');
    return {
      url: signed.signedUrl,
      expiresIn: DOCUMENT_SIGNED_URL_TTL_SECONDS,
      filename: document.filename ?? null,
      mimeType: document.mime_type ?? null,
    };
  });
}
