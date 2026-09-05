import { randomBytes } from 'node:crypto';
import { MikroORM } from '@mikro-orm/sqlite';
import { configPathFromArguments, loadConfig } from './config.js';
import { ormOptions } from './db/orm.js';
import { hashPassword } from './http/auth.js';

const usage = `usage:
  cli hash-password <password>     print a password hash for config.json
  cli secret                       print a random secret for jwtSecret / ingestToken
  cli migration:create [name]      generate a migration from entity changes (dev only)
  cli migration:up [--config path] apply pending migrations`;

async function main(argv: string[]): Promise<void> {
  const [command, argument] = argv;
  switch (command) {
    case 'hash-password': {
      if (argument === undefined) {
        throw new Error('missing password');
      }
      console.log(hashPassword(argument));
      return;
    }
    case 'secret': {
      console.log(randomBytes(32).toString('base64url'));
      return;
    }
    case 'migration:create': {
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
      return;
    }
    case 'migration:up': {
      const config = loadConfig(configPathFromArguments(argv));
      const orm = await MikroORM.init(ormOptions(config.databasePath));
      try {
        const applied = await orm.migrator.up();
        console.log(`applied ${applied.length} migration(s)`);
      } finally {
        await orm.close();
      }
      return;
    }
    default:
      console.log(usage);
      process.exitCode = command === undefined ? 0 : 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
