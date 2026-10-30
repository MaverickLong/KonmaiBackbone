import {
  ActionIcon,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Select,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { BarChart } from '@mantine/charts';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import type { AddressStatsRow, NodeView } from 'konmai-shared';
import { Fragment, useState } from 'react';
import { useAddressStats } from '../api/hooks';
import { formatBytes } from '../format';

const chartRows = 15;

function share(bytes: number, total: number): string {
  return total > 0 ? `${((bytes / total) * 100).toFixed(1)}%` : '–';
}

function averagePerRequest(row: AddressStatsRow): string {
  return formatBytes(row.requests > 0 ? row.egressBytes / row.requests : 0);
}

// The addresses inside one network row, loaded only once the row is opened.
function NetworkAddresses({
  from,
  nodeId,
  network,
  total,
  columns,
}: {
  from: string;
  nodeId: number | undefined;
  network: string;
  total: number;
  columns: number;
}) {
  const stats = useAddressStats({
    from,
    groupBy: 'address',
    network,
    limit: 200,
    ...(nodeId === undefined ? {} : { nodeId }),
  });
  if (stats.isPending) {
    return (
      <Table.Tr>
        <Table.Td colSpan={columns}>
          <Loader size="xs" />
        </Table.Td>
      </Table.Tr>
    );
  }
  return (stats.data?.rows ?? []).map((row) => (
    <Table.Tr key={row.key} bg="var(--mantine-color-default-hover)">
      <Table.Td />
      <Table.Td ff="monospace" pl="lg">
        {row.key}
      </Table.Td>
      <Table.Td ta="right">{formatBytes(row.egressBytes)}</Table.Td>
      <Table.Td ta="right">{share(row.egressBytes, total)}</Table.Td>
      <Table.Td ta="right">{row.requests.toLocaleString()}</Table.Td>
      <Table.Td ta="right">{averagePerRequest(row)}</Table.Td>
      <Table.Td />
      <Table.Td ta="right">{row.nodes}</Table.Td>
    </Table.Tr>
  ));
}

export function AddressTraffic({ from, nodes }: { from: string; nodes: NodeView[] }) {
  const [groupBy, setGroupBy] = useState<'address' | 'network'>('network');
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const nodeId = selectedNode === null ? undefined : Number(selectedNode);
  const stats = useAddressStats({
    from,
    groupBy,
    limit: 50,
    ...(nodeId === undefined ? {} : { nodeId }),
  });
  const data = stats.data;
  const byNetwork = groupBy === 'network';
  const columns = byNetwork ? 8 : 6;
  const toggle = (network: string) =>
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(network)) {
        next.add(network);
      }
      return next;
    });

  return (
    <Paper withBorder p="md">
      <Group justify="space-between" mb="xs">
        <Title order={5}>Traffic by IP</Title>
        <Group>
          <Select
            placeholder="All nodes"
            clearable
            w={180}
            value={selectedNode}
            onChange={setSelectedNode}
            data={nodes.map((node) => ({ value: String(node.id), label: node.name }))}
          />
          <SegmentedControl
            value={groupBy}
            onChange={(value) => {
              setGroupBy(value as typeof groupBy);
              setOpened(new Set());
            }}
            data={[
              { value: 'network', label: 'By network (/24, /48)' },
              { value: 'address', label: 'By address' },
            ]}
          />
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mb="sm">
        Bytes served by nodes per client, from their nginx logs (kept 90 days). Open a network to
        see its addresses. Many small requests suggest scraping; many full-size requests from one
        network suggest bulk downloading.
      </Text>
      {data ? (
        <Text size="sm" mb="sm">
          {data.distinctKeys.toLocaleString()} {byNetwork ? 'networks' : 'addresses'} ·{' '}
          {formatBytes(data.egressBytes)} · {data.requests.toLocaleString()} requests
        </Text>
      ) : null}
      <BarChart
        h={Math.max(160, Math.min(data?.rows.length ?? 0, chartRows) * 28)}
        orientation="vertical"
        data={(data?.rows ?? [])
          .slice(0, chartRows)
          .map((row) => ({ key: row.key, egress: row.egressBytes }))}
        dataKey="key"
        series={[{ name: 'egress', color: 'blue.6' }]}
        valueFormatter={(value) => formatBytes(value)}
        yAxisProps={{ width: 170 }}
      />
      <Table mt="md">
        <Table.Thead>
          <Table.Tr>
            {byNetwork ? <Table.Th w={36} /> : null}
            <Table.Th>{byNetwork ? 'Network' : 'Address'}</Table.Th>
            <Table.Th ta="right">Bytes</Table.Th>
            <Table.Th ta="right">Share</Table.Th>
            <Table.Th ta="right">Requests</Table.Th>
            <Table.Th ta="right">Avg / request</Table.Th>
            {byNetwork ? <Table.Th ta="right">Addresses</Table.Th> : null}
            <Table.Th ta="right">Nodes</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(data?.rows ?? []).map((row) => (
            <Fragment key={row.key}>
              <Table.Tr>
                {byNetwork ? (
                  <Table.Td>
                    <ActionIcon
                      variant="subtle"
                      size="sm"
                      aria-label={`Show addresses in ${row.key}`}
                      aria-expanded={opened.has(row.key)}
                      onClick={() => toggle(row.key)}
                    >
                      {opened.has(row.key) ? (
                        <IconChevronDown size={16} />
                      ) : (
                        <IconChevronRight size={16} />
                      )}
                    </ActionIcon>
                  </Table.Td>
                ) : null}
                <Table.Td ff="monospace">{row.key}</Table.Td>
                <Table.Td ta="right">{formatBytes(row.egressBytes)}</Table.Td>
                <Table.Td ta="right">{share(row.egressBytes, data?.egressBytes ?? 0)}</Table.Td>
                <Table.Td ta="right">{row.requests.toLocaleString()}</Table.Td>
                <Table.Td ta="right">{averagePerRequest(row)}</Table.Td>
                {byNetwork ? (
                  <Table.Td ta="right">{row.addresses.toLocaleString()}</Table.Td>
                ) : null}
                <Table.Td ta="right">{row.nodes}</Table.Td>
              </Table.Tr>
              {byNetwork && opened.has(row.key) ? (
                <NetworkAddresses
                  from={from}
                  nodeId={nodeId}
                  network={row.key}
                  total={data?.egressBytes ?? 0}
                  columns={columns}
                />
              ) : null}
            </Fragment>
          ))}
        </Table.Tbody>
      </Table>
      {data && data.rows.length === 0 ? (
        <Text c="dimmed" size="sm" mt="sm">
          No address data in this range yet. Nodes report it once their nginx log format includes
          the client address.
        </Text>
      ) : null}
    </Paper>
  );
}
