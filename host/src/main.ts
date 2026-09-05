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
import { GeoIp } from './routing/geoip.js';
import { RoutableNodes } from './routing/routable.js';
import { Jobs } from './stats/jobs.js';

async function main(): Promise<void> {
  const config = loadConfig(configPathFromArguments(process.argv));
  const logger = createLogger(config.logLevel);
  const store = new Store(config.storageDirectory);
  await store.prepare();
  const orm = await openDatabase(config.databasePath, config.logLevel === 'trace');
  const context: Context = { config, orm, store, logger };
  const alerts = new Alerts(config.email, logger);
  const geoip = new GeoIp(config.geoip.databasePath, logger);
  await geoip.start();
  const routable = new RoutableNodes(() => orm.em.fork(), config.quotaSafetyFraction);
  const jobs = new Jobs(context);

  const server = createServer();
  const gateway = new Gateway(context, server);
  const prober = new Prober(context, alerts, {
    agentConnected: (nodeId) => gateway.isConnected(nodeId),
    statusChanged: () => routable.invalidate(),
  });

  const app = createApp(context, {
    geoip,
    routable,
    connectedNodeIds: () => gateway.connectedNodeIds(),
    nodeActions: {
      probe: async (node) => {
        await prober.probe(node.id);
        routable.invalidate();
      },
      resync: (node) => gateway.resync(node.id),
      disconnect: (node) => {
        gateway.disconnect(node.id);
        routable.invalidate();
      },
    },
  });
  server.on('request', app);

  server.listen(config.listen.port, config.listen.host, () => {
    logger.info({ host: config.listen.host, port: config.listen.port }, 'host listening');
    prober.start();
    jobs.start();
  });

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    jobs.stop();
    prober.stop();
    geoip.stop();
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
