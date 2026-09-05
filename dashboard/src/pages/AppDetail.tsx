import {
  Anchor,
  Avatar,
  Badge,
  Button,
  FileButton,
  Group,
  Modal,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { notifications } from '@mantine/notifications';
import {
  useApp,
  useCheckVariant,
  useCreateVariant,
  useDeleteApp,
  useDeleteIcon,
  useUpdateApp,
  useUploadIcon,
} from '../api/hooks';
import { VariantForm } from '../components/VariantForm';
import { ConfirmButton, Loading } from '../components/common';
import { formatBytes, formatRelative } from '../format';

export function AppDetailPage() {
  const packageName = decodeURIComponent(useParams().packageName ?? '');
  const app = useApp(packageName);
  const update = useUpdateApp(packageName);
  const remove = useDeleteApp();
  const uploadIcon = useUploadIcon(packageName);
  const deleteIcon = useDeleteIcon(packageName);
  const createVariant = useCreateVariant(packageName);
  const check = useCheckVariant();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (app.isPending || !app.data) {
    return <Loading />;
  }
  const data = app.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Group>
          <Avatar src={data.iconUrl} size="lg" radius="sm">
            {data.displayName.slice(0, 1)}
          </Avatar>
          <div>
            <Title order={2}>{data.displayName}</Title>
            <Text c="dimmed">{data.packageName}</Text>
          </div>
        </Group>
        <Group>
          <FileButton
            onChange={(file) => file && uploadIcon.mutate(file)}
            accept="image/png,image/jpeg,image/webp"
          >
            {(props) => (
              <Button variant="light" loading={uploadIcon.isPending} {...props}>
                Upload icon
              </Button>
            )}
          </FileButton>
          {data.iconUrl ? (
            <Button
              variant="subtle"
              loading={deleteIcon.isPending}
              onClick={() => deleteIcon.mutate(undefined)}
            >
              Remove icon
            </Button>
          ) : null}
          <ConfirmButton
            color="red"
            disabled={data.variants.length > 0}
            loading={remove.isPending}
            onConfirm={() =>
              remove.mutate(packageName, { onSuccess: () => void navigate('/apps') })
            }
          >
            Delete app
          </ConfirmButton>
        </Group>
      </Group>
      <Paper withBorder p="md" maw={480}>
        <Group align="flex-end">
          <TextInput
            label="Display name"
            value={displayName ?? data.displayName}
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Button
            disabled={displayName === null || displayName === data.displayName}
            loading={update.isPending}
            onClick={() =>
              update.mutate(
                { displayName },
                { onSuccess: () => notifications.show({ message: 'Saved', color: 'green' }) },
              )
            }
          >
            Save
          </Button>
        </Group>
      </Paper>
      <Group justify="space-between">
        <Title order={4}>Variants</Title>
        <Button onClick={() => setAdding(true)}>Add variant</Button>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Variant</Table.Th>
            <Table.Th>Source</Table.Th>
            <Table.Th>Active release</Table.Th>
            <Table.Th>Last check</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {data.variants.map((variant) => (
            <Table.Tr key={variant.id}>
              <Table.Td>
                <Anchor component={Link} to={`/variants/${variant.id}`} fw={600}>
                  {variant.name}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {variant.slug}
                  {variant.enabled ? '' : ' · disabled'}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="light">{variant.source.type}</Badge>
              </Table.Td>
              <Table.Td>
                {variant.activeRelease
                  ? `${variant.activeRelease.version} · ${formatBytes(variant.activeRelease.sizeBytes)}`
                  : '–'}
              </Table.Td>
              <Table.Td>
                <Text size="sm">
                  {variant.lastCheckStatus ?? 'never'} · {formatRelative(variant.lastCheckedAt)}
                  {variant.checkRequestedAt ? ' · check pending' : ''}
                </Text>
                {variant.lastCheckError ? (
                  <Text size="xs" c="red">
                    {variant.lastCheckError}
                  </Text>
                ) : null}
              </Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="subtle"
                  loading={check.isPending}
                  onClick={() => check.mutate(variant.id)}
                >
                  Check now
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={adding} onClose={() => setAdding(false)} title="Add variant" size="lg">
        <VariantForm
          submitting={createVariant.isPending}
          onSubmit={(payload) =>
            createVariant.mutate(payload, { onSuccess: () => setAdding(false) })
          }
        />
      </Modal>
    </Stack>
  );
}
