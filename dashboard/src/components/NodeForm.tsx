import {
  Button,
  Group,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  TagsInput,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { nodeCreate, nodeUpdate, type NodeView } from 'konmai-shared';
import { useApps } from '../api/hooks';
import { gigabyte, zodErrors } from '../format';

export interface NodeFormValues {
  name: string;
  domain: string;
  countries: string[];
  catchAll: boolean;
  weight: number;
  enabled: boolean;
  monthlyQuotaGigabytes: number;
  quotaResetDay: number;
  timezone: string;
  usageAdjustmentGigabytes: number;
  variantSelection: 'all' | 'allowlist';
  allowedVariants: string[];
}

// Browsers list zones like "Etc/UTC" but not the plain "UTC" the host accepts as default.
const timezones = ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')];

export function valuesFromNode(node?: NodeView): NodeFormValues {
  return {
    name: node?.name ?? '',
    domain: node?.domain ?? '',
    countries: node?.countries ?? [],
    catchAll: node?.catchAll ?? false,
    weight: node?.weight ?? 100,
    enabled: node?.enabled ?? true,
    monthlyQuotaGigabytes: node ? node.monthlyQuotaBytes / gigabyte : 1000,
    quotaResetDay: node?.quotaResetDay ?? 1,
    timezone: node?.timezone ?? 'UTC',
    usageAdjustmentGigabytes: node ? node.usageAdjustmentBytes / gigabyte : 0,
    variantSelection: node?.variantSelection ?? 'all',
    allowedVariants: (node?.allowedVariants ?? []).map(String),
  };
}

function toPayload(values: NodeFormValues) {
  return {
    name: values.name,
    domain: values.domain,
    countries: values.countries.map((code) => code.toUpperCase()),
    catchAll: values.catchAll,
    weight: values.weight,
    enabled: values.enabled,
    monthlyQuotaBytes: Math.round(values.monthlyQuotaGigabytes * gigabyte),
    quotaResetDay: values.quotaResetDay,
    timezone: values.timezone,
    usageAdjustmentBytes: Math.round(values.usageAdjustmentGigabytes * gigabyte),
    variantSelection: values.variantSelection,
    allowedVariants: values.allowedVariants.map(Number),
  };
}

export function NodeForm({
  initial,
  creating,
  submitting,
  onSubmit,
}: {
  initial: NodeFormValues;
  creating: boolean;
  submitting: boolean;
  onSubmit: (payload: ReturnType<typeof toPayload>) => void;
}) {
  const apps = useApps();
  const form = useForm<NodeFormValues>({
    initialValues: initial,
    validate: (values) => {
      const result = (creating ? nodeCreate : nodeUpdate).safeParse(toPayload(values));
      return result.success ? {} : zodErrors(result.error.issues);
    },
  });
  const variantOptions = (apps.data ?? []).flatMap((app) =>
    app.variants.map((variant) => ({
      value: String(variant.id),
      label: `${app.displayName} · ${variant.name}`,
    })),
  );
  return (
    <form onSubmit={form.onSubmit((values) => onSubmit(toPayload(values)))}>
      <Stack>
        <TextInput label="Name" required {...form.getInputProps('name')} />
        <TextInput
          label="Domain"
          description="Hostname users are redirected to; served over https"
          placeholder="node1.example.com"
          required
          {...form.getInputProps('domain')}
        />
        <TagsInput
          label="Countries"
          description="ISO 3166-1 alpha-2 codes this node serves first (e.g. JP, KR)"
          {...form.getInputProps('countries')}
        />
        <Group grow>
          <Switch
            label="Catch-all for countries without a node"
            {...form.getInputProps('catchAll', { type: 'checkbox' })}
          />
          <Switch label="Enabled" {...form.getInputProps('enabled', { type: 'checkbox' })} />
        </Group>
        <NumberInput
          label="Weight"
          description="Relative share of traffic among eligible nodes"
          min={1}
          max={10000}
          {...form.getInputProps('weight')}
        />
        <Group grow>
          <NumberInput
            label="Monthly quota (GB)"
            min={1}
            {...form.getInputProps('monthlyQuotaGigabytes')}
          />
          <NumberInput
            label="Quota reset day"
            min={1}
            max={31}
            {...form.getInputProps('quotaResetDay')}
          />
        </Group>
        <Select label="Timezone" searchable data={timezones} {...form.getInputProps('timezone')} />
        <NumberInput
          label="Usage adjustment (GB)"
          description="Added to this period's measured usage to match the provider's counter; cleared at the next reset"
          {...form.getInputProps('usageAdjustmentGigabytes')}
        />
        <SegmentedControl
          data={[
            { value: 'all', label: 'Hold every variant that fits' },
            { value: 'allowlist', label: 'Only selected variants' },
          ]}
          {...form.getInputProps('variantSelection')}
        />
        {form.values.variantSelection === 'allowlist' ? (
          <MultiSelect
            label="Allowed variants"
            searchable
            data={variantOptions}
            {...form.getInputProps('allowedVariants')}
          />
        ) : null}
        <Group justify="flex-end">
          <Button type="submit" loading={submitting}>
            {creating ? 'Create node' : 'Save'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
