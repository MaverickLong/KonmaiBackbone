import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const configSchema = z.object({
  listen: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(3000),
    })
    .default({ host: '127.0.0.1', port: 3000 }),
  publicUrl: z.url().transform((value) => value.replace(/\/+$/, '')),
  storageDirectory: z.string().min(1),
  databasePath: z.string().min(1),
  admin: z.object({
    passwordHash: z.string().startsWith('scrypt$'),
    jwtSecret: z.string().min(32),
    tokenLifetimeHours: z
      .number()
      .positive()
      .default(24 * 7),
  }),
  ingestToken: z.string().min(16),
  geoip: z
    .object({ databasePath: z.string().min(1).nullable().default(null) })
    .default({ databasePath: null }),
  email: z
    .object({
      smtpUrl: z.string().min(1),
      from: z.string().min(1),
      to: z.array(z.string().min(1)).min(1),
    })
    .nullable()
    .default(null),
  quotaSafetyFraction: z.number().min(0.5).max(1).default(0.97),
  probeIntervalMinutes: z.number().positive().default(5),
  deepVerifyCron: z.string().default('0 4 * * 0'),
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
  const config = parsed.data;
  const configDirectory = path.dirname(absolutePath);
  return {
    ...config,
    storageDirectory: path.resolve(configDirectory, config.storageDirectory),
    databasePath: path.resolve(configDirectory, config.databasePath),
    geoip: {
      databasePath:
        config.geoip.databasePath === null
          ? null
          : path.resolve(configDirectory, config.geoip.databasePath),
    },
  };
}

export function configPathFromArguments(argv: string[]): string {
  const index = argv.indexOf('--config');
  const value = index === -1 ? undefined : argv[index + 1];
  return value ?? 'config.json';
}
