import {
  Anchor,
  Avatar,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
} from '@mantine/core';
import { IconDownload, IconExternalLink } from '@tabler/icons-react';
import {
  formatBytes,
  type FileKind,
  type PublicAppView,
  type PublicVariantView,
} from 'konmai-shared';

const kindLabels: Record<FileKind, string> = {
  apk: 'APK',
  apks: 'APKS',
  'obb-main': 'OBB 数据包 (main)',
  'obb-patch': 'OBB 数据包 (patch)',
  other: '文件',
};

function publishedOn(variant: PublicVariantView): string {
  return new Date(variant.release.publishedAt).toLocaleDateString('zh-CN');
}

export function AppModal({ app, onClose }: { app: PublicAppView | null; onClose: () => void }) {
  return (
    <Modal
      opened={app !== null}
      onClose={onClose}
      size="lg"
      title={
        app ? (
          <Group gap="sm">
            <Avatar src={app.iconUrl} radius="sm">
              {app.displayName.slice(0, 1)}
            </Avatar>
            <div>
              <Text fw={600}>下载 {app.displayName}</Text>
              <Code>{app.packageName}</Code>
            </div>
          </Group>
        ) : null
      }
    >
      {app ? (
        <Stack gap="md">
          {app.variants.map((variant, index) => (
            <Stack key={variant.slug} gap="xs">
              {index > 0 ? <Divider /> : null}
              <Group gap="xs">
                <Text fw={600}>{variant.name}</Text>
                <Badge variant="light">{variant.release.version}</Badge>
                <Text size="xs" c="dimmed">
                  更新于 {publishedOn(variant)}
                </Text>
              </Group>
              {variant.release.files.map((file) => (
                <Button
                  key={file.fileName}
                  component="a"
                  href={file.url}
                  rel="nofollow noopener noreferrer"
                  variant="light"
                  justify="space-between"
                  leftSection={<IconDownload size={16} />}
                  rightSection={
                    <Text size="xs" c="dimmed">
                      {formatBytes(file.sizeBytes)}
                    </Text>
                  }
                  fullWidth
                >
                  {kindLabels[file.kind]} · {file.fileName}
                </Button>
              ))}
              {variant.release.files.some((file) => file.kind.startsWith('obb')) ? (
                <Text size="xs" c="dimmed">
                  OBB 数据包需要与 APK 一同安装。
                </Text>
              ) : null}
              {variant.sourceType === 'googleplay' ? (
                <Anchor
                  href={`https://play.google.com/store/apps/details?id=${encodeURIComponent(app.packageName)}`}
                  target="_blank"
                  rel="nofollow noopener noreferrer"
                  size="sm"
                >
                  <Group gap={4} component="span">
                    在 Google Play 查看此版本 <IconExternalLink size={14} />
                  </Group>
                </Anchor>
              ) : null}
            </Stack>
          ))}
          <Button onClick={onClose} fullWidth>
            关闭
          </Button>
        </Stack>
      ) : null}
    </Modal>
  );
}
