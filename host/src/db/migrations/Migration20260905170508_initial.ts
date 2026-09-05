import { Migration } from '@mikro-orm/migrations';

export class Migration20260905170508_initial extends Migration {
  override name = 'Migration20260905170508_initial';

  override up(): void | Promise<void> {
    this.addSql(
      `create table \`app\` (\`package_name\` text not null primary key, \`display_name\` text not null, \`icon_file_name\` text null, \`created_at\` datetime not null);`,
    );

    this.addSql(
      `create table \`downloader_state\` (\`id\` integer not null primary key autoincrement, \`last_seen_at\` datetime null, \`phase\` text check (\`phase\` in ('idle', 'checking', 'downloading')) not null default 'idle', \`current_variant_id\` integer null, \`pass_started_at\` datetime null, \`pass_finished_at\` datetime null, \`pass_summary\` text null);`,
    );

    this.addSql(
      `create table \`node\` (\`id\` integer not null primary key autoincrement, \`name\` text not null, \`domain\` text not null, \`countries\` json not null, \`catch_all\` integer not null default false, \`weight\` integer not null default 100, \`enabled\` integer not null default true, \`status\` text check (\`status\` in ('online', 'faulty', 'unknown')) not null default 'unknown', \`agent_connected\` integer not null default false, \`agent_version\` text null, \`last_healthy_at\` datetime null, \`last_failure_at\` datetime null, \`last_failure_reason\` text null, \`monthly_quota_bytes\` integer not null, \`quota_reset_day\` integer not null, \`timezone\` text not null default 'UTC', \`usage_adjustment_bytes\` integer not null default 0, \`usage_adjustment_period_start\` datetime null, \`variant_selection\` text check (\`variant_selection\` in ('all', 'allowlist')) not null default 'all', \`allowed_variants\` json not null, \`token_hash\` text not null, \`storage_total_bytes\` integer null, \`storage_free_bytes\` integer null, \`created_at\` datetime not null);`,
    );
    this.addSql(`create unique index \`node_domain_unique\` on \`node\` (\`domain\`);`);

    this.addSql(
      `create table \`health_event\` (\`id\` integer not null primary key autoincrement, \`node_id\` integer not null, \`at\` datetime not null, \`kind\` text check (\`kind\` in ('became_faulty', 'recovered', 'agent_connected', 'agent_disconnected')) not null, \`detail\` text null, \`email_sent\` integer not null default false, constraint \`health_event_node_id_foreign\` foreign key (\`node_id\`) references \`node\` (\`id\`) on delete cascade);`,
    );
    this.addSql(`create index \`health_event_node_id_index\` on \`health_event\` (\`node_id\`);`);
    this.addSql(`create index \`health_event_at_index\` on \`health_event\` (\`at\`);`);

    this.addSql(
      `create table \`sync_event\` (\`id\` integer not null primary key autoincrement, \`node_id\` integer not null, \`package_name\` text not null, \`variant\` text not null, \`version\` text not null, \`at\` datetime not null, \`outcome\` text check (\`outcome\` in ('fetched', 'skipped_no_space', 'failed_hash', 'failed_network', 'deleted')) not null, \`attempts\` integer not null, \`detail\` text null, constraint \`sync_event_node_id_foreign\` foreign key (\`node_id\`) references \`node\` (\`id\`) on delete cascade);`,
    );
    this.addSql(`create index \`sync_event_node_id_index\` on \`sync_event\` (\`node_id\`);`);
    this.addSql(`create index \`sync_event_at_index\` on \`sync_event\` (\`at\`);`);

    this.addSql(
      `create table \`traffic\` (\`node_id\` integer not null, \`hour_start\` datetime not null, \`egress_bytes\` integer not null, \`ingress_bytes\` integer not null, \`requests\` integer not null, primary key (\`node_id\`, \`hour_start\`), constraint \`traffic_node_id_foreign\` foreign key (\`node_id\`) references \`node\` (\`id\`) on delete cascade);`,
    );
    this.addSql(`create index \`traffic_node_id_index\` on \`traffic\` (\`node_id\`);`);

    this.addSql(
      `create table \`variant\` (\`id\` integer not null primary key autoincrement, \`app_package_name\` text not null, \`slug\` text not null, \`name\` text not null, \`source\` json not null, \`enabled\` integer not null default true, \`check_requested_at\` datetime null, \`last_checked_at\` datetime null, \`last_check_status\` text check (\`last_check_status\` in ('up_to_date', 'updated', 'failed')) null, \`last_check_error\` text null, \`created_at\` datetime not null, constraint \`variant_app_package_name_foreign\` foreign key (\`app_package_name\`) references \`app\` (\`package_name\`) on delete cascade);`,
    );
    this.addSql(
      `create index \`variant_app_package_name_index\` on \`variant\` (\`app_package_name\`);`,
    );
    this.addSql(
      `create unique index \`variant_app_package_name_slug_unique\` on \`variant\` (\`app_package_name\`, \`slug\`);`,
    );

    this.addSql(
      `create table \`release\` (\`id\` integer not null primary key autoincrement, \`variant_id\` integer not null, \`version\` text not null, \`version_code\` integer null, \`state\` text check (\`state\` in ('ingesting', 'active', 'retained', 'deleting')) not null, \`size_bytes\` integer not null, \`created_at\` datetime not null, \`activated_at\` datetime null, constraint \`release_variant_id_foreign\` foreign key (\`variant_id\`) references \`variant\` (\`id\`) on delete cascade);`,
    );
    this.addSql(`create index \`release_variant_id_index\` on \`release\` (\`variant_id\`);`);
    this.addSql(
      `create unique index \`release_variant_id_version_unique\` on \`release\` (\`variant_id\`, \`version\`);`,
    );

    this.addSql(
      `create table \`release_file\` (\`id\` integer not null primary key autoincrement, \`release_id\` integer not null, \`file_name\` text not null, \`kind\` text check (\`kind\` in ('apk', 'apks', 'obb-main', 'obb-patch', 'other')) not null, \`size_bytes\` integer not null, \`sha256\` text not null, constraint \`release_file_release_id_foreign\` foreign key (\`release_id\`) references \`release\` (\`id\`) on delete cascade);`,
    );
    this.addSql(
      `create index \`release_file_release_id_index\` on \`release_file\` (\`release_id\`);`,
    );
    this.addSql(
      `create unique index \`release_file_release_id_file_name_unique\` on \`release_file\` (\`release_id\`, \`file_name\`);`,
    );

    this.addSql(
      `create table \`holding\` (\`node_id\` integer not null, \`file_id\` integer not null, \`sha256\` text not null, \`size_bytes\` integer not null, \`state\` text check (\`state\` in ('present', 'mismatch')) not null, \`reported_at\` datetime not null, primary key (\`node_id\`, \`file_id\`), constraint \`holding_node_id_foreign\` foreign key (\`node_id\`) references \`node\` (\`id\`) on update cascade on delete cascade, constraint \`holding_file_id_foreign\` foreign key (\`file_id\`) references \`release_file\` (\`id\`) on update cascade on delete cascade);`,
    );
    this.addSql(`create index \`holding_node_id_index\` on \`holding\` (\`node_id\`);`);
    this.addSql(`create index \`holding_file_id_index\` on \`holding\` (\`file_id\`);`);

    this.addSql(
      `create table \`download\` (\`id\` integer not null primary key autoincrement, \`file_id\` integer not null, \`node_id\` integer null, \`country\` text null, \`at\` datetime not null, constraint \`download_file_id_foreign\` foreign key (\`file_id\`) references \`release_file\` (\`id\`) on delete cascade, constraint \`download_node_id_foreign\` foreign key (\`node_id\`) references \`node\` (\`id\`) on delete set null);`,
    );
    this.addSql(`create index \`download_file_id_index\` on \`download\` (\`file_id\`);`);
    this.addSql(`create index \`download_node_id_index\` on \`download\` (\`node_id\`);`);
    this.addSql(`create index \`download_at_index\` on \`download\` (\`at\`);`);

    this.addSql(
      `create table \`download_summary\` (\`day\` text not null, \`variant_id\` integer not null, \`node_id\` integer not null, \`country\` text not null, \`count\` integer not null, primary key (\`day\`, \`variant_id\`, \`node_id\`, \`country\`), constraint \`download_summary_variant_id_foreign\` foreign key (\`variant_id\`) references \`variant\` (\`id\`) on delete cascade);`,
    );
    this.addSql(
      `create index \`download_summary_variant_id_index\` on \`download_summary\` (\`variant_id\`);`,
    );
  }
}
