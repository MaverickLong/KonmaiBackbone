import { Migration } from '@mikro-orm/migrations';

export class Migration20261030040823_check_interval extends Migration {
  override name = 'Migration20261030040823_check_interval';

  override up(): void | Promise<void> {
    this.addSql(
      `alter table \`variant\` add column \`check_interval_minutes\` integer not null default 1440;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table \`variant\` drop column \`check_interval_minutes\`;`);
  }
}
