import { Migration } from '@mikro-orm/migrations';

export class Migration20261030035903_address_buckets extends Migration {
  override name = 'Migration20261030035903_address_buckets';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`address_bucket\` (\`day\` text not null, \`address\` text not null, \`egress_bytes\` integer not null, \`requests\` integer not null, \`acknowledged\` integer not null default false, primary key (\`day\`, \`address\`));`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists \`address_bucket\`;`);
  }
}
