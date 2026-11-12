import { Migration } from '@mikro-orm/migrations';

export class Migration20261112073410_soft_delete_nodes extends Migration {
  override name = 'Migration20261112073410_soft_delete_nodes';

  override up(): void | Promise<void> {
    this.addSql(`alter table \`node\` add column \`deleted_at\` datetime null;`);
    // The generator does not compare index definitions, so the swap is written by hand.
    this.addSql(`drop index \`node_domain_unique\`;`);
    this.addSql(
      `create unique index \`node_domain_unique\` on \`node\` (\`domain\`) where \`deleted_at\` is null;`,
    );
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index \`node_domain_unique\`;`);
    this.addSql(`create unique index \`node_domain_unique\` on \`node\` (\`domain\`);`);
    this.addSql(`alter table \`node\` drop column \`deleted_at\`;`);
  }
}
