import { readFile, stat } from 'node:fs/promises';
import { Reader, type CountryResponse } from 'mmdb-lib';
import type { Logger } from '../logger.js';

const reloadCheckMilliseconds = 3_600_000;

export class GeoIp {
  private reader: Reader<CountryResponse> | null = null;
  private loadedModifiedAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly databasePath: string | null,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    await this.reloadIfChanged();
    this.timer = setInterval(() => void this.reloadIfChanged(), reloadCheckMilliseconds);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
    }
  }

  country(ip: string): string | null {
    if (this.reader === null) {
      return null;
    }
    try {
      const code = this.reader.get(ip)?.country?.iso_code;
      return code === undefined ? null : code.toUpperCase();
    } catch {
      return null;
    }
  }

  private async reloadIfChanged(): Promise<void> {
    if (this.databasePath === null) {
      return;
    }
    try {
      const info = await stat(this.databasePath);
      if (info.mtimeMs === this.loadedModifiedAt) {
        return;
      }
      this.reader = new Reader<CountryResponse>(await readFile(this.databasePath));
      this.loadedModifiedAt = info.mtimeMs;
      this.logger.info({ path: this.databasePath }, 'GeoIP database loaded');
    } catch (error) {
      this.logger.warn({ error, path: this.databasePath }, 'GeoIP database unavailable');
    }
  }
}
