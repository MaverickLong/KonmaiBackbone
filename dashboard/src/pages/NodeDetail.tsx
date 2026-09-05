import {
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { AreaChart } from '@mantine/charts';
import type { NodeCreatedView } from 'konmai-shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { notifications } from '@mantine/notifications';
import {
  useDeleteNode,
  useNode,
  useProbeNode,
  useResyncNode,
  useRotateToken,
  useTrafficStats,
  useUpdateNode,
} from '../api/hooks';
import { EventsTable } from '../components/EventsTable';
import { NodeForm, valuesFromNode } from '../components/NodeForm';
import { TokenReveal } from '../components/TokenReveal';
import {
  ConfirmButton,
  Loading,
  QuotaBar,
  StatTile,
  StatusBadge,
  StorageBar,
} from '../components/common';
import { formatBytes, formatDate, formatRelative } from '../format';

export function NodeDetailPage() {
  const id = Number(useParams().id);
  const node = useNode(id);
  const traffic = useTrafficStats({ nodeId: id, resolution: 'day' });
  const update = useUpdateNode(id);
  const remove = useDeleteNode();
  const rotate = useRotateToken(id);
  const probe = useProbeNode();
  const resync = useResyncNode();
  const navigate = useNavigate();
  const [rotated, setRotated] = useState<NodeCreatedView | null>(null);
  if (node.isPending || !node.data) {
    return <Loading />;
  }
  const data = node.data;
  const nodeNames = new Map([[data.id, data.name]]);
  return (
    <Stack>
      <Group justify="space-between">
        <div>
          <Group gap="xs">
            <Title order={2}>{data.name}</Title>
            <StatusBadge node={data} />
            <Badge variant="outline" color={data.agentConnected ? 'blue' : 'gray'}>
              agent {data.agentConnected ? `v${data.agentVersion ?? '?'}` : 'disconnected'}
            </Badge>
          </Group>
          <Text c="dimmed">{data.domain}</Text>
        </div>
        <Group>
          <Button variant="light" loading={probe.isPending} onClick={() => probe.mutate(id)}>
            Probe now
          </Button>
          <Button
            variant="light"
            loading={resync.isPending}
            onClick={() =>
              resync.mutate(id, {
                onSuccess: (result) =>
                  notifications.show({
                    message: result.delivered ? 'Resync requested' : 'Agent is not connected',
                    color: result.delivered ? 'green' : 'orange',
                  }),
              })
            }
          >
            Resync
          </Button>
          <ConfirmButton
            loading={rotate.isPending}
            onConfirm={() => rotate.mutate(undefined, { onSuccess: setRotated })}
          >
            Rotate token
          </ConfirmButton>
          <ConfirmButton
            color="red"
            loading={remove.isPending}
            onConfirm={() => remove.mutate(id, { onSuccess: () => void navigate('/nodes') })}
          >
            Delete node
          </ConfirmButton>
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <Paper withBorder p="md">
          <Text size="xs" c="dimmed" tt="uppercase">
            Bandwidth this period
          </Text>
          <QuotaBar node={data} />
          <Text size="xs" c="dimmed" mt="xs">
            egress {formatBytes(data.quota.egressBytes)} · ingress{' '}
            {formatBytes(data.quota.ingressBytes)} · adjustment{' '}
            {formatBytes(data.quota.adjustmentBytes)} · projected{' '}
            {formatBytes(data.quota.projectedPeriodBytes)}
          </Text>
        </Paper>
        <Paper withBorder p="md">
          <Text size="xs" c="dimmed" tt="uppercase">
            Storage
          </Text>
          <StorageBar node={data} />
          <Text size="xs" c="dimmed" mt="xs">
            {data.heldFiles} files held
          </Text>
        </Paper>
        <StatTile
          label="Health"
          value={data.status}
          hint={`healthy ${formatRelative(data.lastHealthyAt)}${data.lastFailureReason ? ` · last failure: ${data.lastFailureReason}` : ''}`}
        />
      </SimpleGrid>
      <Tabs defaultValue="traffic">
        <Tabs.List>
          <Tabs.Tab value="traffic">Traffic</Tabs.Tab>
          <Tabs.Tab value="inventory">Inventory ({data.holdings.length})</Tabs.Tab>
          <Tabs.Tab value="events">Events</Tabs.Tab>
          <Tabs.Tab value="settings">Settings</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="traffic" pt="md">
          <AreaChart
            h={260}
            data={(traffic.data ?? []).map((row) => ({
              day: row.start.slice(0, 10),
              egress: row.egressBytes,
              ingress: row.ingressBytes,
            }))}
            dataKey="day"
            series={[
              { name: 'egress', color: 'blue.6' },
              { name: 'ingress', color: 'teal.6' },
            ]}
            valueFormatter={(value) => formatBytes(value)}
            withDots={false}
          />
        </Tabs.Panel>
        <Tabs.Panel value="inventory" pt="md">
          <Table striped>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>App</Table.Th>
                <Table.Th>Variant</Table.Th>
                <Table.Th>Version</Table.Th>
                <Table.Th>File</Table.Th>
                <Table.Th>Size</Table.Th>
                <Table.Th>State</Table.Th>
                <Table.Th>Reported</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.holdings.map((holding) => (
                <Table.Tr key={holding.fileId}>
                  <Table.Td>{holding.packageName}</Table.Td>
                  <Table.Td>{holding.variant}</Table.Td>
                  <Table.Td>{holding.version}</Table.Td>
                  <Table.Td>{holding.fileName}</Table.Td>
                  <Table.Td>{formatBytes(holding.sizeBytes)}</Table.Td>
                  <Table.Td>
                    <Badge color={holding.state === 'present' ? 'green' : 'red'} variant="light">
                      {holding.state}
                    </Badge>
                  </Table.Td>
                  <Table.Td>{formatDate(holding.reportedAt)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Tabs.Panel>
        <Tabs.Panel value="events" pt="md">
          <EventsTable health={data.healthEvents} sync={data.syncEvents} nodeNames={nodeNames} />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="md">
          <Paper withBorder p="md" maw={640}>
            <NodeForm
              initial={valuesFromNode(data)}
              creating={false}
              submitting={update.isPending}
              onSubmit={(payload) =>
                update.mutate(payload, {
                  onSuccess: () => notifications.show({ message: 'Node saved', color: 'green' }),
                })
              }
            />
          </Paper>
        </Tabs.Panel>
      </Tabs>
      <Modal
        opened={rotated !== null}
        onClose={() => setRotated(null)}
        title="Token rotated"
        size="lg"
      >
        {rotated ? <TokenReveal created={rotated} /> : null}
      </Modal>
    </Stack>
  );
}
