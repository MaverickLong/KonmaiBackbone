import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  nodeId: z.number().int().positive(),
  token: z.string().min(16),
  hostUrl: z.url().transform((value) => value.replace(/\/+$/, '')),
  storageDirectory: z.string().min(1),
  databasePath: z.string().min(1),
  maxStorageBytes: z.number().int().positive().nullable().default(null),
  minFreeBytes: z.number().int().nonnegative().default(2_147_483_648),
  fetchConcurrency: z.number().int().min(1).max(8).default(1),
  syslog: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(5140),
    })
    .nullable()
    .default({ host: '127.0.0.1', port: 5140 }),
  reconcileIntervalHours: z.number().positive().default(24),
  trafficReportMinutes: z.number().positive().default(5),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(configPath: string): Config {
  const absolutePath = path.resolve(configPath);
  const raw: unknown = JSON.parse(readFileSync(absolutePath, 'utf8'));
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`invalid configuration in ${absolutePath}:\n${problems}`);
  }
  const configDirectory = path.dirname(absolutePath);
  return {
    ...parsed.data,
    storageDirectory: path.resolve(configDirectory, parsed.data.storageDirectory),
    databasePath: path.resolve(configDirectory, parsed.data.databasePath),
  };
}

export function configPathFromArguments(argv: string[]): string {
  const index = argv.indexOf('--config');
  const value = index === -1 ? undefined : argv[index + 1];
  return value ?? 'config.json';
}
