import { Migration } from '@mikro-orm/migrations';

export class Migration20261108105000_agent_connected extends Migration {
  override name = 'Migration20261108105000_agent_connected';

  override up(): void | Promise<void> {
    this.addSql(`alter table \`node\` drop column \`agent_connected\`;`);
  }

  override down(): void | Promise<void> {
    this.addSql(
      `alter table \`node\` add column \`agent_connected\` integer not null default false;`,
    );
  }
}
