import Fastify from 'fastify';
import { env } from './config.js';

const app = Fastify({
  logger: true,
});

app.get('/health', async () => ({
  ok: true,
  service: 'buyflow-api',
  version: '0.1.0',
}));

async function start() {
  try {
    await app.listen({
      port: env.PORT,
      host: env.HOST,
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
