import { Avatar, Badge, Card, Group, Text } from '@mantine/core';
import type { PublicAppView } from 'konmai-shared';

export function AppCard({
  app,
  onOpen,
}: {
  app: PublicAppView;
  onOpen: (app: PublicAppView) => void;
}) {
  return (
    <Card
      withBorder
      padding="sm"
      radius="md"
      component="button"
      type="button"
      onClick={() => onOpen(app)}
      style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
    >
      <Group gap="sm" wrap="nowrap">
        <Avatar src={app.iconUrl} radius="sm" size="lg">
          {app.displayName.slice(0, 1)}
        </Avatar>
        <div style={{ minWidth: 0 }}>
          <Text fw={500} lineClamp={2}>
            {app.displayName}
          </Text>
          {app.variants.length > 1 ? (
            <Badge size="xs" variant="light" mt={4}>
              {app.variants.length} 个版本
            </Badge>
          ) : (
            <Text size="xs" c="dimmed">
              {app.variants[0]?.release.version ?? ''}
            </Text>
          )}
        </div>
      </Group>
    </Card>
  );
}
