import { Anchor, Badge, Button, Group, Modal, Stack, Table, Text, Title } from '@mantine/core';
import type { NodeCreatedView } from 'konmai-shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { useCreateNode, useNodes, useProbeNode } from '../api/hooks';
import { NodeForm, valuesFromNode } from '../components/NodeForm';
import { TokenReveal } from '../components/TokenReveal';
import { Loading, QuotaBar, StatusBadge, StorageBar } from '../components/common';
import { formatRelative } from '../format';

export function NodesPage() {
  const nodes = useNodes();
  const create = useCreateNode();
  const probe = useProbeNode();
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState<NodeCreatedView | null>(null);
  if (nodes.isPending || !nodes.data) {
    return <Loading />;
  }
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Nodes</Title>
        <Button onClick={() => setAdding(true)}>Add node</Button>
      </Group>
      {nodes.data.length === 0 ? (
        <Text c="dimmed">No nodes yet. Add one to start distributing files.</Text>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Node</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Countries</Table.Th>
              <Table.Th>Bandwidth</Table.Th>
              <Table.Th>Storage</Table.Th>
              <Table.Th>Files</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {nodes.data.map((node) => (
              <Table.Tr key={node.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/nodes/${node.id}`} fw={600}>
                    {node.name}
                  </Anchor>
                  <Text size="xs" c="dimmed">
                    {node.domain}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    <Group gap={4}>
                      <StatusBadge node={node} />
                      <Badge variant="outline" color={node.agentConnected ? 'blue' : 'gray'}>
                        agent {node.agentConnected ? 'on' : 'off'}
                      </Badge>
                    </Group>
                    <Text size="xs" c="dimmed">
                      healthy {formatRelative(node.lastHealthyAt)}
                      {node.status === 'faulty' && node.lastFailureReason
                        ? ` · ${node.lastFailureReason}`
                        : ''}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    {node.countries.map((country) => (
                      <Badge key={country} variant="light">
                        {country}
                      </Badge>
                    ))}
                    {node.catchAll ? (
                      <Badge color="grape" variant="light">
                        catch-all
                      </Badge>
                    ) : null}
                  </Group>
                </Table.Td>
                <Table.Td>
                  <QuotaBar node={node} />
                </Table.Td>
                <Table.Td>
                  <StorageBar node={node} />
                </Table.Td>
                <Table.Td>{node.heldFiles}</Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="subtle"
                    loading={probe.isPending}
                    onClick={() => probe.mutate(node.id)}
                  >
                    Probe
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={adding} onClose={() => setAdding(false)} title="Add node" size="lg">
        <NodeForm
          initial={valuesFromNode()}
          creating
          submitting={create.isPending}
          onSubmit={(payload) =>
            create.mutate(payload, {
              onSuccess: (view) => {
                setAdding(false);
                setCreated(view);
              },
            })
          }
        />
      </Modal>
      <Modal
        opened={created !== null}
        onClose={() => setCreated(null)}
        title="Node created"
        size="lg"
      >
        {created ? <TokenReveal created={created} /> : null}
      </Modal>
    </Stack>
  );
}
