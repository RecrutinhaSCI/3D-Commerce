import { createApp } from './app';
import { env, productionConfigWarnings } from './config/env';

const app = createApp();

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[3D Commerce API] http://localhost:${env.PORT} · env=${env.NODE_ENV}`);
  for (const w of productionConfigWarnings()) {
    // eslint-disable-next-line no-console
    console.warn(`[config] ${w}`);
  }
});

/** Graceful shutdown: encerra conexões abertas antes de sair. */
function shutdown(signal: NodeJS.Signals) {
  // eslint-disable-next-line no-console
  console.log(`\n[server] Recebido ${signal}, encerrando...`);
  server.close((err) => {
    if (err) {
      // eslint-disable-next-line no-console
      console.error('[server] Erro ao encerrar:', err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Hard-stop após 10s se algo travar.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
