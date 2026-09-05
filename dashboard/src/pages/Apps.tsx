import {
  Anchor,
  Avatar,
  Badge,
  Button,
  Group,
  Modal,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { appCreate } from 'konmai-shared';
import { useState } from 'react';
import { Link } from 'react-router';
import { notifications } from '@mantine/notifications';
import { useApps, useCheckAll, useCreateApp } from '../api/hooks';
import { Loading } from '../components/common';
import { formatRelative, zodErrors } from '../format';

export function AppsPage() {
  const apps = useApps();
  const create = useCreateApp();
  const checkAll = useCheckAll();
  const [adding, setAdding] = useState(false);
  const form = useForm({
    initialValues: { packageName: '', displayName: '' },
    validate: (values) => {
      const result = appCreate.safeParse(values);
      return result.success ? {} : zodErrors(result.error.issues);
    },
  });
  if (apps.isPending || !apps.data) {
    return <Loading />;
  }
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={2}>Apps</Title>
        <Group>
          <Button
            variant="light"
            loading={checkAll.isPending}
            onClick={() =>
              checkAll.mutate(undefined, {
                onSuccess: (result) =>
                  notifications.show({
                    message: `Check requested for ${result.requested} variant(s)`,
                    color: 'green',
                  }),
              })
            }
          >
            Check all now
          </Button>
          <Button onClick={() => setAdding(true)}>Add app</Button>
        </Group>
      </Group>
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>App</Table.Th>
            <Table.Th>Variants</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {apps.data.map((app) => (
            <Table.Tr key={app.packageName}>
              <Table.Td>
                <Group>
                  <Avatar src={app.iconUrl} radius="sm">
                    {app.displayName.slice(0, 1)}
                  </Avatar>
                  <div>
                    <Anchor
                      component={Link}
                      to={`/apps/${encodeURIComponent(app.packageName)}`}
                      fw={600}
                    >
                      {app.displayName}
                    </Anchor>
                    <Text size="xs" c="dimmed">
                      {app.packageName}
                    </Text>
                  </div>
                </Group>
              </Table.Td>
              <Table.Td>
                <Stack gap={4}>
                  {app.variants.map((variant) => (
                    <Group key={variant.id} gap="xs">
                      <Anchor component={Link} to={`/variants/${variant.id}`} size="sm">
                        {variant.name}
                      </Anchor>
                      <Badge variant="light" color={variant.enabled ? 'blue' : 'gray'}>
                        {variant.source.type}
                      </Badge>
                      <Text size="sm">{variant.activeRelease?.version ?? 'no release'}</Text>
                      {variant.lastCheckStatus === 'failed' ? (
                        <Badge color="red" variant="light">
                          check failed
                        </Badge>
                      ) : null}
                      <Text size="xs" c="dimmed">
                        checked {formatRelative(variant.lastCheckedAt)}
                      </Text>
                    </Group>
                  ))}
                  {app.variants.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      no variants
                    </Text>
                  ) : null}
                </Stack>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal opened={adding} onClose={() => setAdding(false)} title="Add app">
        <form
          onSubmit={form.onSubmit((values) =>
            create.mutate(values, {
              onSuccess: () => {
                setAdding(false);
                form.reset();
              },
            }),
          )}
        >
          <Stack>
            <TextInput
              label="Package name"
              description="Android application id; primary key"
              placeholder="com.example.game"
              required
              {...form.getInputProps('packageName')}
            />
            <TextInput label="Display name" required {...form.getInputProps('displayName')} />
            <Button type="submit" loading={create.isPending}>
              Create app
            </Button>
          </Stack>
        </form>
      </Modal>
    </Stack>
  );
}
