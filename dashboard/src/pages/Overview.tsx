import { Alert, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import { useDownloadStats, useEvents, useNodes, useOverview } from '../api/hooks';
import { EventsTable } from '../components/EventsTable';
import { Loading, StatTile } from '../components/common';
import { formatBytes, formatCountry, formatRelative } from '../format';

export function OverviewPage() {
  const overview = useOverview();
  const nodes = useNodes();
  const events = useEvents({ limit: 15 });
  const perDay = useDownloadStats({ groupBy: 'day' });
  if (overview.isPending || !overview.data) {
    return <Loading />;
  }
  const data = overview.data;
  const nodeNames = new Map((nodes.data ?? []).map((node) => [node.id, node.name]));
  return (
    <Stack>
      <Title order={2}>Overview</Title>
      {data.nodes.faulty > 0 ? (
        <Alert color="red" title={`${data.nodes.faulty} node(s) faulty`}>
          Users are routed around them; check the events below.
        </Alert>
      ) : null}
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <StatTile
          label="Nodes online"
          value={`${data.nodes.online} / ${data.nodes.online + data.nodes.faulty + data.nodes.unknown}`}
          hint={`${data.nodes.agentsConnected} agents connected · ${data.nodes.disabled} disabled`}
        />
        <StatTile
          label="Downloads today"
          value={data.downloads.today}
          hint={`${data.downloads.last7Days} in 7 days · ${data.downloads.last30Days} in 30 days`}
        />
        <StatTile
          label="Catalogue"
          value={`${data.apps} apps`}
          hint={`${data.variants} variants · ${data.activeReleases} active releases · ${formatBytes(data.storeBytes)} stored`}
        />
        <StatTile
          label="Downloader"
          value={data.downloader.phase}
          hint={`seen ${formatRelative(data.downloader.lastSeenAt)} · ${data.downloader.passSummary ?? 'no pass yet'}`}
        />
      </SimpleGrid>
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Downloads per day (30 days)
        </Title>
        <AreaChart
          h={220}
          data={(perDay.data ?? []).map((row) => ({ day: row.key, downloads: row.count }))}
          dataKey="day"
          series={[{ name: 'downloads', color: 'blue.6' }]}
          curveType="monotone"
          withDots={false}
        />
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Paper withBorder p="md">
          <Title order={5} mb="sm">
            Countries without a dedicated node (7 days)
          </Title>
          <Text size="xs" c="dimmed" mb="sm">
            Requests served by a catch-all node, any holder, or the host (
            {data.servedByHostLast7Days} by the host).
          </Text>
          {data.unservedCountries.length === 0 ? (
            <Text c="dimmed" size="sm">
              Every download hit a node assigned to its country.
            </Text>
          ) : (
            <Table>
              <Table.Tbody>
                {data.unservedCountries.map((row) => (
                  <Table.Tr key={row.country}>
                    <Table.Td>{formatCountry(row.country)}</Table.Td>
                    <Table.Td ta="right">{row.downloads}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Paper>
        <Paper withBorder p="md">
          <Title order={5} mb="sm">
            Recent events
          </Title>
          <EventsTable
            health={events.data?.health ?? []}
            sync={events.data?.sync ?? []}
            nodeNames={nodeNames}
            limit={15}
          />
        </Paper>
      </SimpleGrid>
    </Stack>
  );
}
