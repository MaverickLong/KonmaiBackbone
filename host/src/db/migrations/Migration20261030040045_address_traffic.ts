import { Migration } from '@mikro-orm/migrations';

export class Migration20261030040045_address_traffic extends Migration {
  override name = 'Migration20261030040045_address_traffic';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`address_traffic\` (\`node_id\` integer not null, \`day\` text not null, \`address\` text not null, \`network\` text not null, \`egress_bytes\` integer not null, \`requests\` integer not null, primary key (\`node_id\`, \`day\`, \`address\`), constraint \`address_traffic_node_id_foreign\` foreign key (\`node_id\`) references \`node\` (\`id\`) on delete cascade);`,
    );
    this.addSql(
      `create index \`address_traffic_node_id_index\` on \`address_traffic\` (\`node_id\`);`,
    );
    this.addSql(`create index \`address_traffic_day_index\` on \`address_traffic\` (\`day\`);`);
    this.addSql(
      `create index \`address_traffic_network_index\` on \`address_traffic\` (\`network\`);`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists \`address_traffic\`;`);
  }
}
