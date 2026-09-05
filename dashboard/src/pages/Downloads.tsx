import { Group, Paper, SegmentedControl, Select, Stack, Table, Title } from '@mantine/core';
import { AreaChart, BarChart } from '@mantine/charts';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useApps, useDownloadStats, useNodes, useTrafficStats } from '../api/hooks';
import { formatBytes, formatCountry } from '../format';

const ranges = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];

export function DownloadsPage() {
  const [days, setDays] = useState('30');
  const [groupBy, setGroupBy] = useState<'variant' | 'node' | 'country'>('variant');
  const from = dayjs().subtract(Number(days), 'day').startOf('day').toISOString();
  const perDay = useDownloadStats({ from, groupBy: 'day' });
  const grouped = useDownloadStats({ from, groupBy });
  const traffic = useTrafficStats({ from, resolution: 'day' });
  const apps = useApps();
  const nodes = useNodes();

  const variantNames = new Map(
    (apps.data ?? []).flatMap((app) =>
      app.variants.map((variant) => [String(variant.id), `${app.displayName} · ${variant.name}`]),
    ),
  );
  const nodeNames = new Map((nodes.data ?? []).map((node) => [String(node.id), node.name]));
  const label = (key: string): string => {
    if (groupBy === 'variant') {
      return variantNames.get(key) ?? key;
    }
    if (groupBy === 'node') {
      return key === 'host' ? 'host (direct)' : (nodeNames.get(key) ?? `#${key}`);
    }
    return key === '??' ? 'unknown' : formatCountry(key);
  };

  const trafficByDay = new Map<string, { day: string; egress: number; ingress: number }>();
  for (const row of traffic.data ?? []) {
    const day = row.start.slice(0, 10);
    const entry = trafficByDay.get(day) ?? { day, egress: 0, ingress: 0 };
    entry.egress += row.egressBytes;
    entry.ingress += row.ingressBytes;
    trafficByDay.set(day, entry);
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Downloads</Title>
        <Select data={ranges} value={days} onChange={(value) => value && setDays(value)} w={140} />
      </Group>
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Downloads per day
        </Title>
        <AreaChart
          h={220}
          data={(perDay.data ?? []).map((row) => ({ day: row.key, downloads: row.count }))}
          dataKey="day"
          series={[{ name: 'downloads', color: 'blue.6' }]}
          withDots={false}
        />
      </Paper>
      <Paper withBorder p="md">
        <Title order={5} mb="sm">
          Bytes served per day (all nodes)
        </Title>
        <AreaChart
          h={220}
          data={[...trafficByDay.values()].sort((a, b) => a.day.localeCompare(b.day))}
          dataKey="day"
          series={[
            { name: 'egress', color: 'blue.6' },
            { name: 'ingress', color: 'teal.6' },
          ]}
          valueFormatter={(value) => formatBytes(value)}
          withDots={false}
        />
      </Paper>
      <Paper withBorder p="md">
        <Group justify="space-between" mb="sm">
          <Title order={5}>Breakdown</Title>
          <SegmentedControl
            value={groupBy}
            onChange={(value) => setGroupBy(value as typeof groupBy)}
            data={[
              { value: 'variant', label: 'By variant' },
              { value: 'node', label: 'By node' },
              { value: 'country', label: 'By country' },
            ]}
          />
        </Group>
        <BarChart
          h={260}
          data={(grouped.data ?? [])
            .slice(0, 15)
            .map((row) => ({ key: label(row.key), downloads: row.count }))}
          dataKey="key"
          series={[{ name: 'downloads', color: 'blue.6' }]}
        />
        <Table mt="md">
          <Table.Tbody>
            {(grouped.data ?? []).map((row) => (
              <Table.Tr key={row.key}>
                <Table.Td>{label(row.key)}</Table.Td>
                <Table.Td ta="right">{row.count}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>
    </Stack>
  );
}
