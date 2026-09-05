import { createServer } from 'node:http';
import { Alerts } from './alerts/email.js';
import { Store } from './catalogue/store.js';
import { configPathFromArguments, loadConfig } from './config.js';
import { openDatabase } from './db/orm.js';
import { createApp } from './http/app.js';
import type { Context } from './http/context.js';
import { createLogger } from './logger.js';
import { Gateway } from './nodes/gateway.js';
import { Prober } from './nodes/prober.js';

async function main(): Promise<void> {
  const config = loadConfig(configPathFromArguments(process.argv));
  const logger = createLogger(config.logLevel);
  const store = new Store(config.storageDirectory);
  await store.prepare();
  const orm = await openDatabase(config.databasePath, config.logLevel === 'trace');
  const context: Context = { config, orm, store, logger };
  const alerts = new Alerts(config.email, logger);

  const server = createServer();
  const gateway = new Gateway(context, server);
  const prober = new Prober(context, alerts, (nodeId) => gateway.isConnected(nodeId));

  const app = createApp(context, {
    nodeActions: {
      probe: (node) => prober.probe(node.id),
      resync: (node) => gateway.resync(node.id),
      disconnect: (node) => gateway.disconnect(node.id),
    },
  });
  server.on('request', app);

  server.listen(config.listen.port, config.listen.host, () => {
    logger.info({ host: config.listen.host, port: config.listen.port }, 'host listening');
    prober.start();
  });

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    prober.stop();
    gateway.close();
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
