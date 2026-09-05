import type { MikroORM } from '@mikro-orm/sqlite';
import type { Config } from '../config.js';
import type { Store } from '../catalogue/store.js';
import type { Logger } from '../logger.js';

// Everything a request handler needs, assembled once at startup and passed to each router.
export interface Context {
  config: Config;
  orm: MikroORM;
  store: Store;
  logger: Logger;
}
