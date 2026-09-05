import { createServer } from 'node:http';
import { Store } from './catalogue/store.js';
import { configPathFromArguments, loadConfig } from './config.js';
import { openDatabase } from './db/orm.js';
import { createApp } from './http/app.js';
import type { Context } from './http/context.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig(configPathFromArguments(process.argv));
  const logger = createLogger(config.logLevel);
  const store = new Store(config.storageDirectory);
  await store.prepare();
  const orm = await openDatabase(config.databasePath, config.logLevel === 'trace');
  const context: Context = { config, orm, store, logger };

  const app = createApp(context, {
    nodeActions: {
      probe: async () => {},
      resync: async () => false,
      disconnect: () => {},
    },
  });
  const server = createServer(app);

  server.listen(config.listen.port, config.listen.host, () => {
    logger.info({ host: config.listen.host, port: config.listen.port }, 'host listening');
  });

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    server.close();
    await orm.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
