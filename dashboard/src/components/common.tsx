import {
  Badge,
  Button,
  Group,
  Loader,
  Paper,
  Progress,
  Stack,
  Text,
  type ButtonProps,
} from '@mantine/core';
import type { NodeStatus, NodeView } from 'konmai-shared';
import { useState, type ReactNode } from 'react';
import { formatBytes, formatDate } from '../format';

export function Loading() {
  return (
    <Group justify="center" p="xl">
      <Loader />
    </Group>
  );
}

export function StatusBadge({ node }: { node: Pick<NodeView, 'status' | 'enabled'> }) {
  if (!node.enabled) {
    return <Badge color="gray">disabled</Badge>;
  }
  const colors: Record<NodeStatus, string> = { online: 'green', faulty: 'red', unknown: 'yellow' };
  return <Badge color={colors[node.status]}>{node.status}</Badge>;
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase">
        {label}
      </Text>
      <Text size="xl" fw={600}>
        {value}
      </Text>
      {hint ? (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      ) : null}
    </Paper>
  );
}

export function QuotaBar({ node }: { node: NodeView }) {
  const { quota } = node;
  const fraction = quota.quotaBytes === 0 ? 0 : Math.min(1, quota.usedBytes / quota.quotaBytes);
  const color = quota.exhausted ? 'red' : fraction > 0.8 ? 'orange' : 'blue';
  return (
    <Stack gap={2} miw={160}>
      <Progress value={fraction * 100} color={color} size="sm" />
      <Text size="xs" c="dimmed">
        {formatBytes(quota.usedBytes)} / {formatBytes(quota.quotaBytes)} · resets{' '}
        {formatDate(quota.periodEnd)}
        {quota.projectedExhaustionAt && !quota.exhausted
          ? ` · runs out ${formatDate(quota.projectedExhaustionAt)}`
          : ''}
      </Text>
    </Stack>
  );
}

export function StorageBar({ node }: { node: NodeView }) {
  if (node.storageTotalBytes === null || node.storageFreeBytes === null) {
    return (
      <Text size="xs" c="dimmed">
        no storage report yet
      </Text>
    );
  }
  const used = node.storageTotalBytes - node.storageFreeBytes;
  return (
    <Stack gap={2} miw={160}>
      <Progress value={(used / node.storageTotalBytes) * 100} size="sm" color="teal" />
      <Text size="xs" c="dimmed">
        {formatBytes(node.heldBytes)} held · {formatBytes(node.storageFreeBytes)} free of{' '}
        {formatBytes(node.storageTotalBytes)}
      </Text>
    </Stack>
  );
}

// A destructive action that asks for a second click instead of a modal.
export function ConfirmButton({
  onConfirm,
  children,
  ...props
}: ButtonProps & { onConfirm: () => void; children: ReactNode }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      {...props}
      color={armed ? 'red' : props.color}
      variant={armed ? 'filled' : (props.variant ?? 'light')}
      onClick={() => {
        if (armed) {
          onConfirm();
          setArmed(false);
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 4_000);
        }
      }}
    >
      {armed ? 'Click again to confirm' : children}
    </Button>
  );
}
