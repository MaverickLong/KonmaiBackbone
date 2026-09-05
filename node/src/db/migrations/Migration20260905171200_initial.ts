import { Migration } from '@mikro-orm/migrations';

export class Migration20260905171200_initial extends Migration {
  override name = 'Migration20260905171200_initial';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`local_file\` (\`package_name\` text not null, \`variant\` text not null, \`version\` text not null, \`file_name\` text not null, \`size_bytes\` integer not null, \`sha256\` text not null, \`downloaded_at\` datetime not null, \`verified_at\` datetime not null, primary key (\`package_name\`, \`variant\`, \`version\`, \`file_name\`));`,
    );

    this.addSql(
      `create table \`local_release\` (\`package_name\` text not null, \`variant\` text not null, \`version\` text not null, \`completed_at\` datetime not null, primary key (\`package_name\`, \`variant\`, \`version\`));`,
    );

    this.addSql(
      `create table \`traffic_bucket\` (\`hour_start\` datetime not null primary key, \`egress_bytes\` integer not null, \`ingress_bytes\` integer not null, \`requests\` integer not null, \`acknowledged\` integer not null default false);`,
    );
  }
}
