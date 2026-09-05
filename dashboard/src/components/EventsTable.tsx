import { Badge, Table, Text } from '@mantine/core';
import type { HealthEventView, SyncEventView } from 'konmai-shared';
import { Link } from 'react-router';
import { formatDate } from '../format';

interface Row {
  id: string;
  at: string;
  nodeId: number;
  kind: string;
  color: string;
  detail: string;
}

const healthColors: Record<HealthEventView['kind'], string> = {
  became_faulty: 'red',
  recovered: 'green',
  agent_connected: 'blue',
  agent_disconnected: 'gray',
};

const syncColors: Record<SyncEventView['outcome'], string> = {
  fetched: 'green',
  deleted: 'gray',
  skipped_no_space: 'orange',
  failed_hash: 'red',
  failed_network: 'red',
};

export function EventsTable({
  health,
  sync,
  nodeNames,
  limit,
}: {
  health: HealthEventView[];
  sync: SyncEventView[];
  nodeNames: Map<number, string>;
  limit?: number;
}) {
  const rows: Row[] = [
    ...health.map((event) => ({
      id: `h${event.id}`,
      at: event.at,
      nodeId: event.nodeId,
      kind: event.kind.replace('_', ' '),
      color: healthColors[event.kind],
      detail: event.detail ?? '',
    })),
    ...sync.map((event) => ({
      id: `s${event.id}`,
      at: event.at,
      nodeId: event.nodeId,
      kind: event.outcome.replace(/_/g, ' '),
      color: syncColors[event.outcome],
      detail: `${event.packageName}/${event.variant} ${event.version}${event.detail ? ` — ${event.detail}` : ''}`,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
  if (rows.length === 0) {
    return (
      <Text c="dimmed" size="sm">
        No events yet.
      </Text>
    );
  }
  return (
    <Table striped highlightOnHover>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>When</Table.Th>
          <Table.Th>Node</Table.Th>
          <Table.Th>Event</Table.Th>
          <Table.Th>Detail</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((row) => (
          <Table.Tr key={row.id}>
            <Table.Td>{formatDate(row.at)}</Table.Td>
            <Table.Td>
              <Link to={`/nodes/${row.nodeId}`}>
                {nodeNames.get(row.nodeId) ?? `#${row.nodeId}`}
              </Link>
            </Table.Td>
            <Table.Td>
              <Badge color={row.color} variant="light">
                {row.kind}
              </Badge>
            </Table.Td>
            <Table.Td>
              <Text size="sm">{row.detail}</Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
