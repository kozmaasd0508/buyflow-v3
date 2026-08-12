import { env } from '../config.js';
import { createEmailProvider } from '../email/factory.js';

async function main() {
  const provider = createEmailProvider();
  const page = await provider.searchMessages({
    query: env.EMAIL_DISCOVERY_QUERY,
    limit: 5,
  });

  const preview = page.messages.map((message) => ({
    id: message.providerMessageId,
    threadId: message.providerThreadId,
    from: message.from.map((item) => item.email),
    subject: message.subject,
    receivedAt: message.receivedAt,
    attachmentCount: message.attachments.length,
  }));

  console.log(
    JSON.stringify(
      {
        provider: provider.name,
        query: env.EMAIL_DISCOVERY_QUERY,
        count: preview.length,
        hasMore: Boolean(page.nextCursor),
        messages: preview,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('Nylas smoke test failed:', error);
  process.exit(1);
});
