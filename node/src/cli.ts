import { MikroORM } from '@mikro-orm/sqlite';
import { ormOptions } from './db/orm.js';

const usage = `usage:
  cli migration:create [name]      generate a migration from entity changes (dev only)`;

async function main(argv: string[]): Promise<void> {
  const [command, argument] = argv;
  if (command !== 'migration:create') {
    console.log(usage);
    process.exitCode = command === undefined ? 0 : 1;
    return;
  }
  const orm = await MikroORM.init(ormOptions('.migration-scratch.sqlite'));
  try {
    const pending = await orm.migrator.getPending();
    const executed = await orm.migrator.getStorage().getExecutedMigrations();
    if (pending.length > 0) {
      await orm.migrator.up();
    }
    const initial = executed.length + pending.length === 0;
    const result = await orm.migrator.create(undefined, false, initial, argument);
    console.log(result.fileName ? `created ${result.fileName}` : 'no changes');
  } finally {
    await orm.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
