import { Alert, Code, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useApps, useDownloader } from '../api/hooks';
import { Loading, StatTile } from '../components/common';
import { formatDate, formatDevice, formatRelative } from '../format';

export function DownloaderPage() {
  const downloader = useDownloader();
  const apps = useApps();
  if (downloader.isPending || !downloader.data) {
    return <Loading />;
  }
  const data = downloader.data;
  const stale = data.phase === 'offline';
  const googlePlay = data.googlePlay;
  const pinnedAccounts = (apps.data ?? []).flatMap((app) =>
    app.variants.flatMap((variant) =>
      variant.source.type === 'googleplay' && variant.source.account !== undefined
        ? [variant.source.account]
        : [],
    ),
  );
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
        <Title order={5} mb="xs">
          Google accounts
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          Managed on the host with <Code>konmai-downloader account add ALIAS EMAIL</Code>,{' '}
          <Code>login ALIAS</Code>, <Code>rename ALIAS NEW_ALIAS</Code> and{' '}
          <Code>remove ALIAS</Code>. Variants with no account set try every account in this order.
          {googlePlay ? ` Reported ${formatRelative(googlePlay.reportedAt)}.` : ''}
        </Text>
        {!googlePlay || googlePlay.accounts.length === 0 ? (
          <Text c="dimmed" size="sm">
            {googlePlay
              ? 'No account added yet.'
              : 'The downloader has not reported its accounts yet.'}
          </Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Alias</Table.Th>
                <Table.Th>Email</Table.Th>
                <Table.Th>Checked-in devices</Table.Th>
                <Table.Th>Variants using it</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {googlePlay.accounts.map((account) => (
                <Table.Tr key={account.email}>
                  <Table.Td>{account.alias}</Table.Td>
                  <Table.Td>{account.email}</Table.Td>
                  <Table.Td>
                    <Text size="sm">
                      {account.devices
                        .map((device) => formatDevice(googlePlay, device))
                        .join(', ') || '–'}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    {pinnedAccounts.filter((email) => email === account.email).length}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>
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
