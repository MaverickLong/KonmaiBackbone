import { Migration } from '@mikro-orm/migrations';

export class Migration20261108161508_settings extends Migration {
  override name = 'Migration20261108161508_settings';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`settings\` (\`id\` integer not null primary key autoincrement, \`retained_grace_minutes\` integer not null);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists \`settings\`;`);
  }
}
