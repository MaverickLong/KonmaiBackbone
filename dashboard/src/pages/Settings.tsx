import { Button, Group, NumberInput, Paper, Stack, Title } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { settingsUpdate, type SettingsView } from 'konmai-shared';
import { useSettings, useUpdateSettings } from '../api/hooks';
import { Loading } from '../components/common';
import { zodErrors } from '../format';

export function SettingsPage() {
  const settings = useSettings();
  if (settings.isPending || !settings.data) {
    return <Loading />;
  }
  return (
    <Stack>
      <Title order={2}>Settings</Title>
      <SettingsForm initial={settings.data} />
    </Stack>
  );
}

function SettingsForm({ initial }: { initial: SettingsView }) {
  const update = useUpdateSettings();
  const form = useForm<SettingsView>({
    initialValues: initial,
    validate: (values) => {
      const result = settingsUpdate.safeParse(values);
      return result.success ? {} : zodErrors(result.error.issues);
    },
  });
  return (
    <Paper withBorder p="md" maw={640}>
      <form
        onSubmit={form.onSubmit((values) =>
          update.mutate(values, {
            onSuccess: () => notifications.show({ message: 'Settings saved', color: 'green' }),
          }),
        )}
      >
        <Stack>
          <NumberInput
            label="Keep the previous release for (minutes)"
            description="After a new version goes live, the release it replaced stays on the host and on the nodes this long so that downloads in progress can finish; then it is deleted everywhere. 0 deletes it within a minute."
            min={0}
            max={10080}
            {...form.getInputProps('retainedGraceMinutes')}
          />
          <Group justify="flex-end">
            <Button type="submit" loading={update.isPending}>
              Save
            </Button>
          </Group>
        </Stack>
      </form>
    </Paper>
  );
}
