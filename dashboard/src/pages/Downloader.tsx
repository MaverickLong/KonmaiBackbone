import { Alert, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import dayjs from 'dayjs';
import { useApps, useDownloader } from '../api/hooks';
import { Loading, StatTile } from '../components/common';
import { formatDate, formatRelative } from '../format';

export function DownloaderPage() {
  const downloader = useDownloader();
  const apps = useApps();
  if (downloader.isPending || !downloader.data) {
    return <Loading />;
  }
  const data = downloader.data;
  const stale = data.lastSeenAt === null || dayjs().diff(dayjs(data.lastSeenAt), 'minute') > 10;
  const failures = (apps.data ?? []).flatMap((app) =>
    app.variants
      .filter((variant) => variant.lastCheckStatus === 'failed')
      .map((variant) => ({
        id: variant.id,
        label: `${app.displayName} · ${variant.name}`,
        error: variant.lastCheckError,
        at: variant.lastCheckedAt,
      })),
  );
  return (
    <Stack>
      <Title order={2}>Downloader</Title>
      {stale ? (
        <Alert color="orange" title="No recent heartbeat">
          The downloader has not reported since {formatRelative(data.lastSeenAt)}. Check the
          `konmai-downloader` service on the host.
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <StatTile
          label="Phase"
          value={data.phase}
          hint={`seen ${formatRelative(data.lastSeenAt)}`}
        />
        <StatTile
          label="Last pass"
          value={formatDate(data.passFinishedAt)}
          hint={data.passStartedAt ? `started ${formatDate(data.passStartedAt)}` : undefined}
        />
        <StatTile label="Pass summary" value={<Text size="sm">{data.passSummary ?? '–'}</Text>} />
      </SimpleGrid>
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Variants whose last check failed
        </Title>
        {failures.length === 0 ? (
          <Text c="dimmed" size="sm">
            Every variant checked successfully.
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Variant</Table.Th>
                <Table.Th>Error</Table.Th>
                <Table.Th>When</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {failures.map((failure) => (
                <Table.Tr key={failure.id}>
                  <Table.Td>{failure.label}</Table.Td>
                  <Table.Td>
                    <Text size="sm" c="red">
                      {failure.error}
                    </Text>
                  </Table.Td>
                  <Table.Td>{formatDate(failure.at)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}
