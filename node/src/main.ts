import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configPathFromArguments, loadConfig } from './config.js';
import { openDatabase } from './db/orm.js';
import { Link } from './link.js';
import { createLogger } from './logger.js';
import { Reconciler } from './reconcile.js';
import { Storage } from './storage.js';
import { TrafficMeter } from './traffic.js';
import { DeepVerifier } from './verify.js';

function agentVersion(): string {
  const packagePath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string };
  return manifest.version;
}

async function main(): Promise<void> {
  const config = loadConfig(configPathFromArguments(process.argv));
  const logger = createLogger(config.logLevel);
  const version = agentVersion();
  const storage = new Storage(config);
  await storage.prepare(config.nodeId, version);
  const orm = await openDatabase(config.databasePath, config.logLevel === 'trace');

  const link = new Link(config, logger);
  const traffic = new TrafficMeter(config, orm, link, logger);
  const reconciler = new Reconciler(config, orm, storage, link, traffic, logger);
  const verifier = new DeepVerifier(orm, storage, reconciler, logger);

  link.on('connected', () => {
    void (async () => {
      link.send({
        type: 'hello',
        payload: { agentVersion: version, storage: await storage.report() },
      });
      await reconciler.sendInventory();
    })();
  });
  link.on('message', (message) => {
    switch (message.type) {
      case 'manifest':
        verifier.schedule(message.payload.settings.deepVerifyCron);
        reconciler.receive(message.payload);
        break;
      case 'resync':
        void reconciler.sendInventory().then(() => reconciler.run());
        break;
      case 'ack':
        void traffic.acknowledge(message.payload.hourStarts);
        break;
      case 'error':
        logger.warn(message.payload, 'host reported an error');
        break;
    }
  });

  traffic.start();
  link.start();
  const daily = setInterval(() => void reconciler.run(), config.reconcileIntervalHours * 3_600_000);
  logger.info({ nodeId: config.nodeId, version }, 'node agent started');

  const shutdown = async (): Promise<void> => {
    logger.info('shutting down');
    clearInterval(daily);
    verifier.stop();
    link.stop();
    await traffic.stop();
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
