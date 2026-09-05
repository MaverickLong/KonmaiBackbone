import { Button, Group, Select, Stack, Switch, TagsInput, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import {
  sourceTypes,
  variantCreate,
  variantUpdate,
  type Source,
  type VariantView,
} from 'konmai-shared';
import { zodErrors } from '../format';

interface VariantFormValues {
  slug: string;
  name: string;
  enabled: boolean;
  type: Source['type'];
  packageName: string;
  devices: string[];
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
    type: (source['type'] as Source['type']) ?? 'googleplay',
    packageName: String(source['packageName'] ?? ''),
    devices: Array.isArray(source['devices']) ? (source['devices'] as string[]) : [],
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
  const form = useForm<VariantFormValues>({
    initialValues: valuesFrom(variant),
    validate: (values) => {
      const payload = {
        slug: values.slug,
        name: values.name,
        enabled: values.enabled,
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
            <TagsInput
              label="Devices"
              description="Device codenames tried in order; empty uses the downloader default"
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
