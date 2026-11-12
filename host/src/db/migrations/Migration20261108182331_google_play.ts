import { Migration } from '@mikro-orm/migrations';

export class Migration20261108182331_google_play extends Migration {
  override name = 'Migration20261108182331_google_play';

  override up(): void | Promise<void> {
    this.addSql(`alter table \`downloader_state\` add column \`google_play\` json null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table \`downloader_state\` drop column \`google_play\`;`);
  }
}
