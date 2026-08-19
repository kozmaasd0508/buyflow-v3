import type { FastifyInstance, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerCuratedMailboxAuditV2 } from './api/curated-mailbox-audit-v2.js';
import { registerRawEmailAuditRoutes } from './api/raw-email-audit-routes.js';

const mobileDistDir = fileURLToPath(new URL('../../mobile/dist/', import.meta.url));

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendPreviewHeaders(reply: FastifyReply, filePath: string) {
  const extension = extname(filePath).toLowerCase();
  reply
    .header('X-Content-Type-Options', 'nosniff')
    .header('Referrer-Policy', 'same-origin')
    .header('Cache-Control', extension === '.html' ? 'no-cache' : 'public, max-age=3600')
    .type(mimeTypes[extension] ?? 'application/octet-stream');
}

async function sendFile(reply: FastifyReply, filePath: string) {
  const body = await readFile(filePath);
  sendPreviewHeaders(reply, filePath);
  return reply.code(200).send(body);
}

export async function registerWebPreview(app: FastifyInstance) {
  await registerRawEmailAuditRoutes(app);
  await registerCuratedMailboxAuditV2(app);

  app.get('/app', async (_request, reply) => reply.redirect('/app/'));

  app.get('/app/', async (_request, reply) => {
    try {
      return await sendFile(reply, resolve(mobileDistDir, 'index.html'));
    } catch {
      return reply.code(503).type('text/plain; charset=utf-8').send('BuyFlow preview is not built yet.');
    }
  });

  app.get('/app/*', async (request, reply) => {
    const wildcard = String((request.params as { '*': string })['*'] ?? '');
    const safeRelativePath = normalize(wildcard).replace(/^([/\\])+/, '');
    const candidate = resolve(mobileDistDir, safeRelativePath);

    if (!candidate.startsWith(resolve(mobileDistDir))) {
      return reply.code(404).send();
    }

    try {
      return await sendFile(reply, candidate);
    } catch {
      if (extname(safeRelativePath)) {
        return reply.code(404).send();
      }

      try {
        return await sendFile(reply, resolve(mobileDistDir, 'index.html'));
      } catch {
        return reply.code(503).type('text/plain; charset=utf-8').send('BuyFlow preview is not built yet.');
      }
    }
  });
}
