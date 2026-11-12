import {
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  TagsInput,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  maximumCheckIntervalMinutes,
  minimumCheckIntervalMinutes,
  sourceTypes,
  variantCreate,
  variantUpdate,
  type Source,
  type VariantView,
} from 'konmai-shared';
import { useDownloader } from '../api/hooks';
import { formatAccount, formatDevice, formatInterval, zodErrors } from '../format';

interface VariantFormValues {
  slug: string;
  name: string;
  enabled: boolean;
  checkIntervalMinutes: number;
  type: Source['type'];
  packageName: string;
  devices: string[];
  device: string | null;
  account: string | null;
  locale: string;
  timezone: string;
  repository: string;
  assetPattern: string;
  includePrereleases: boolean;
}

function valuesFrom(variant?: VariantView): VariantFormValues {
  const source: Record<string, unknown> = variant?.source ?? { type: 'googleplay' };
  return {
    slug: variant?.slug ?? '',
    name: variant?.name ?? '',
    enabled: variant?.enabled ?? true,
    checkIntervalMinutes: variant?.checkIntervalMinutes ?? maximumCheckIntervalMinutes,
    type: (source['type'] as Source['type']) ?? 'googleplay',
    packageName: String(source['packageName'] ?? ''),
    devices: Array.isArray(source['devices']) ? (source['devices'] as string[]) : [],
    device: typeof source['device'] === 'string' ? source['device'] : null,
    account: typeof source['account'] === 'string' ? source['account'] : null,
    locale: String(source['locale'] ?? ''),
    timezone: String(source['timezone'] ?? ''),
    repository: String(source['repository'] ?? ''),
    assetPattern: String(source['assetPattern'] ?? '\\.apk$'),
    includePrereleases: Boolean(source['includePrereleases'] ?? false),
  };
}

// Only the fields of the chosen type are sent; unknown keys the downloader may have introduced
// are preserved from the original source object.
function toSource(
  values: VariantFormValues,
  original: Record<string, unknown>,
): Record<string, unknown> {
  const extras = Object.fromEntries(
    Object.entries(original).filter(
      ([key]) =>
        ![
          'type',
          'packageName',
          'devices',
          'device',
          'account',
          'locale',
          'timezone',
          'expansionFiles',
          'repository',
          'assetPattern',
          'includePrereleases',
        ].includes(key),
    ),
  );
  switch (values.type) {
    case 'googleplay':
      return {
        ...extras,
        type: 'googleplay',
        ...(values.packageName ? { packageName: values.packageName } : {}),
        ...(values.devices.length > 0 ? { devices: values.devices } : {}),
        ...(values.device ? { device: values.device } : {}),
        ...(values.account ? { account: values.account } : {}),
        ...(values.locale ? { locale: values.locale } : {}),
        ...(values.timezone ? { timezone: values.timezone } : {}),
      };
    case 'github':
      return {
        ...extras,
        type: 'github',
        repository: values.repository,
        assetPattern: values.assetPattern,
        ...(values.includePrereleases ? { includePrereleases: true } : {}),
      };
    default:
      return { ...extras, type: values.type };
  }
}

// A saved value the downloader no longer reports must stay selectable, or the select would show it
// as empty and saving would silently clear it.
function withCurrent(
  options: { value: string; label: string }[],
  current: string | null,
  suffix = '',
): { value: string; label: string }[] {
  if (current === null || options.some((option) => option.value === current)) {
    return options;
  }
  return [...options, { value: current, label: `${current}${suffix}` }];
}

export function VariantForm({
  variant,
  submitting,
  onSubmit,
}: {
  variant?: VariantView;
  submitting: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const creating = variant === undefined;
  const original = (variant?.source ?? {}) as Record<string, unknown>;
  const googlePlay = useDownloader().data?.googlePlay;
  const form = useForm<VariantFormValues>({
    initialValues: valuesFrom(variant),
    validate: (values) => {
      const payload = {
        slug: values.slug,
        name: values.name,
        enabled: values.enabled,
        checkIntervalMinutes: values.checkIntervalMinutes,
        source: toSource(values, original),
      };
      const result = (creating ? variantCreate : variantUpdate).safeParse(payload);
      return result.success ? {} : zodErrors(result.error.issues);
    },
  });
  return (
    <form
      onSubmit={form.onSubmit((values) =>
        onSubmit({
          ...(creating ? { slug: values.slug } : {}),
          name: values.name,
          enabled: values.enabled,
          checkIntervalMinutes: values.checkIntervalMinutes,
          source: toSource(values, original),
        }),
      )}
    >
      <Stack>
        {creating ? (
          <TextInput
            label="Slug"
            description="Lowercase letters, digits and dashes; part of every download URL"
            placeholder="google-play"
            required
            {...form.getInputProps('slug')}
          />
        ) : null}
        <TextInput
          label="Name"
          placeholder="Google Play"
          required
          {...form.getInputProps('name')}
        />
        <Switch label="Enabled" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        <NumberInput
          label="Check for updates every (minutes)"
          description={`From ${minimumCheckIntervalMinutes} minutes to ${maximumCheckIntervalMinutes} (one day); currently ${formatInterval(form.values.checkIntervalMinutes)}`}
          min={minimumCheckIntervalMinutes}
          max={maximumCheckIntervalMinutes}
          step={5}
          allowDecimal={false}
          {...form.getInputProps('checkIntervalMinutes')}
        />
        <Select
          label="Source"
          data={sourceTypes.map((type) => ({ value: type, label: type }))}
          {...form.getInputProps('type')}
        />
        {form.values.type === 'googleplay' ? (
          <>
            <TextInput
              label="Package name override"
              description="Only when the Play listing uses a different id than the app"
              {...form.getInputProps('packageName')}
            />
            <Group grow align="flex-start">
              <Select
                label="Device"
                description="Saved after the first successful check; empty tries each device"
                placeholder="any device"
                searchable
                clearable
                data={withCurrent(
                  [...(googlePlay?.devices ?? [])]
                    .sort((first, second) => (first.apiLevel ?? 0) - (second.apiLevel ?? 0))
                    .map((device) => ({
                      value: device.codename,
                      label: formatDevice(googlePlay, device.codename),
                    })),
                  form.values.device,
                )}
                {...form.getInputProps('device')}
              />
              <Select
                label="Account"
                description="Saved after the first successful check; empty tries each account"
                placeholder="any account"
                clearable
                data={withCurrent(
                  (googlePlay?.accounts ?? []).map((account) => ({
                    value: account.email,
                    label: `${account.alias} (${account.email})`,
                  })),
                  form.values.account,
                  ' (not signed in)',
                )}
                {...form.getInputProps('account')}
              />
            </Group>
            {form.values.device && form.values.account ? (
              <Text size="xs" c="dimmed">
                Only {formatDevice(googlePlay, form.values.device)} with{' '}
                {formatAccount(googlePlay, form.values.account)} is used. If it fails, an e-mail is
                sent instead of trying other combinations; clear either field to search again.
              </Text>
            ) : null}
            <TagsInput
              label="Devices to try"
              description={`Used when no device is set, oldest Android version first; empty uses the downloader default (${googlePlay?.defaultDevices.join(', ') || 'unknown'})`}
              data={(googlePlay?.devices ?? []).map((device) => device.codename)}
              {...form.getInputProps('devices')}
            />
            <Group grow>
              <TextInput label="Locale" placeholder="ja_JP" {...form.getInputProps('locale')} />
              <TextInput
                label="Timezone"
                placeholder="Asia/Tokyo"
                {...form.getInputProps('timezone')}
              />
            </Group>
          </>
        ) : null}
        {form.values.type === 'github' ? (
          <>
            <TextInput
              label="Repository"
              placeholder="owner/name"
              required
              {...form.getInputProps('repository')}
            />
            <TextInput
              label="Asset pattern"
              description="Regular expression matched against asset names"
              {...form.getInputProps('assetPattern')}
            />
            <Switch
              label="Include pre-releases"
              {...form.getInputProps('includePrereleases', { type: 'checkbox' })}
            />
          </>
        ) : null}
        <Group justify="flex-end">
          <Button type="submit" loading={submitting}>
            {creating ? 'Create variant' : 'Save'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
