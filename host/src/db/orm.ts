import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migrator } from '@mikro-orm/migrations';
import { MikroORM, defineConfig, type EntityManager, type Options } from '@mikro-orm/sqlite';
import { entities } from './entities.js';

export type { EntityManager };

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const runningFromSource = import.meta.url.endsWith('.ts');

export function ormOptions(databasePath: string, debug = false): Options {
  return defineConfig({
    dbName: databasePath,
    entities,
    extensions: [Migrator],
    debug,
    forceUtcTimezone: true,
    migrations: {
      path: path.join(currentDirectory, 'migrations'),
      pathTs: path.join(currentDirectory, 'migrations'),
      snapshot: true,
      snapshotName: 'schema',
      transactional: true,
      emit: 'ts',
    },
    preferTs: runningFromSource,
    driverOptions: { pragma: { journal_mode: 'WAL', synchronous: 'NORMAL', foreign_keys: 'ON' } },
  });
}

export async function openDatabase(databasePath: string, debug = false): Promise<MikroORM> {
  const orm = await MikroORM.init(ormOptions(databasePath, debug));
  await orm.migrator.up();
  return orm;
}
