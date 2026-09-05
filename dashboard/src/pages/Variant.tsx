import {
  Anchor,
  Badge,
  Button,
  Code,
  Group,
  Paper,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { Link, useNavigate, useParams } from 'react-router';
import { notifications } from '@mantine/notifications';
import {
  useCheckVariant,
  useDeleteRelease,
  useDeleteVariant,
  useDownloadStats,
  useNodes,
  useUpdateVariant,
  useVariant,
} from '../api/hooks';
import { VariantForm } from '../components/VariantForm';
import { ConfirmButton, Loading } from '../components/common';
import { formatBytes, formatDate, formatRelative } from '../format';

export function VariantPage() {
  const id = Number(useParams().id);
  const variant = useVariant(id);
  const nodes = useNodes();
  const packageName = variant.data?.packageName ?? '';
  const update = useUpdateVariant(id, packageName);
  const remove = useDeleteVariant(packageName);
  const deleteRelease = useDeleteRelease(id);
  const check = useCheckVariant();
  const perCountry = useDownloadStats({ groupBy: 'country' });
  const navigate = useNavigate();
  if (variant.isPending || !variant.data) {
    return <Loading />;
  }
  const data = variant.data;
  const nodeNames = new Map((nodes.data ?? []).map((node) => [node.id, node.name]));
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Title order={2}>{data.name}</Title>
            <Badge variant="light">{data.source.type}</Badge>
            {data.enabled ? null : <Badge color="gray">disabled</Badge>}
          </Group>
          <Text c="dimmed">
            <Anchor component={Link} to={`/apps/${encodeURIComponent(data.packageName)}`}>
              {data.packageName}
            </Anchor>{' '}
            / {data.slug}
          </Text>
        </div>
        <Group>
          <Button variant="light" loading={check.isPending} onClick={() => check.mutate(id)}>
            Check now
          </Button>
          <ConfirmButton
            color="red"
            disabled={data.releases.length > 0}
            loading={remove.isPending}
            onConfirm={() =>
              remove.mutate(id, {
                onSuccess: () => void navigate(`/apps/${encodeURIComponent(data.packageName)}`),
              })
            }
          >
            Delete variant
          </ConfirmButton>
        </Group>
      </Group>
      <Text size="sm">
        Last check: {data.lastCheckStatus ?? 'never'} · {formatRelative(data.lastCheckedAt)}
        {data.checkRequestedAt ? ' · check pending' : ''}
        {data.lastCheckError ? (
          <Text span c="red">
            {' '}
            — {data.lastCheckError}
          </Text>
        ) : null}
      </Text>
      <Tabs defaultValue="releases">
        <Tabs.List>
          <Tabs.Tab value="releases">Releases</Tabs.Tab>
          <Tabs.Tab value="downloads">Downloads</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="releases" pt="md">
          <Stack>
            {data.releases.length === 0 ? (
              <Text c="dimmed">
                No release yet; the downloader publishes the first one on its next pass.
              </Text>
            ) : null}
            {data.releases.map((release) => (
              <Paper withBorder p="md" key={release.id}>
                <Group justify="space-between" mb="sm">
                  <Group gap="xs">
                    <Text fw={600}>{release.version}</Text>
                    {release.versionCode !== null ? (
                      <Text c="dimmed">({release.versionCode})</Text>
                    ) : null}
                    <Badge
                      color={
                        release.state === 'active'
                          ? 'green'
                          : release.state === 'retained'
                            ? 'yellow'
                            : 'gray'
                      }
                    >
                      {release.state}
                    </Badge>
                    <Text size="sm" c="dimmed">
                      {formatBytes(release.sizeBytes)} · published{' '}
                      {formatDate(release.activatedAt ?? release.createdAt)}
                    </Text>
                  </Group>
                  <ConfirmButton
                    size="xs"
                    color="red"
                    loading={deleteRelease.isPending}
                    onConfirm={() => deleteRelease.mutate(release.version)}
                  >
                    Delete release
                  </ConfirmButton>
                </Group>
                <Table>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>File</Table.Th>
                      <Table.Th>Kind</Table.Th>
                      <Table.Th>Size</Table.Th>
                      <Table.Th>SHA-256</Table.Th>
                      <Table.Th>Held by</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {release.files.map((file) => (
                      <Table.Tr key={file.id}>
                        <Table.Td>
                          <Anchor href={file.url} size="sm">
                            {file.fileName}
                          </Anchor>
                        </Table.Td>
                        <Table.Td>{file.kind}</Table.Td>
                        <Table.Td>{formatBytes(file.sizeBytes)}</Table.Td>
                        <Table.Td>
                          <Code>{file.sha256.slice(0, 16)}…</Code>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={4}>
                            {file.holders.map((nodeId) => (
                              <Badge
                                key={nodeId}
                                variant="light"
                                component={Link}
                                to={`/nodes/${nodeId}`}
                                style={{ cursor: 'pointer' }}
                              >
                                {nodeNames.get(nodeId) ?? `#${nodeId}`}
                              </Badge>
                            ))}
                            {file.holders.length === 0 ? (
                              <Text size="xs" c="dimmed">
                                host only
                              </Text>
                            ) : null}
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Paper>
            ))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="downloads" pt="md">
          <Text size="sm" c="dimmed" mb="sm">
            Downloads by country across the catalogue in the last 30 days (per-variant breakdown is
            on the Downloads page).
          </Text>
          <BarChart
            h={260}
            data={(perCountry.data ?? [])
              .slice(0, 20)
              .map((row) => ({ country: row.key, downloads: row.count }))}
            dataKey="country"
            series={[{ name: 'downloads', color: 'blue.6' }]}
          />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="md">
          <Paper withBorder p="md" maw={640}>
            <VariantForm
              variant={data}
              submitting={update.isPending}
              onSubmit={(payload) =>
                update.mutate(payload, {
                  onSuccess: () => notifications.show({ message: 'Variant saved', color: 'green' }),
                })
              }
            />
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
