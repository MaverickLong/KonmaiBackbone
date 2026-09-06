import {
  Alert,
  Button,
  Center,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { PublicAppView } from 'konmai-shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useCatalogue } from '../api';
import { groupByLetter, letters, matchesSearch } from '../catalogue';
import { AlphabetBar } from '../components/AlphabetBar';
import { AppCard } from '../components/AppCard';
import { AppModal } from '../components/AppModal';
import { FirstVisitNotice } from '../components/FirstVisitNotice';

export function HomePage() {
  const catalogue = useCatalogue();
  const [search, setSearch] = useState('');
  // `?app=<package name>` opens an app directly so links to a specific game can be shared.
  const [params, setParams] = useSearchParams();
  const openedPackage = params.get('app');
  const apps = catalogue.data ?? [];
  const opened = apps.find((app) => app.packageName === openedPackage) ?? null;
  const open = (app: PublicAppView | null) => {
    setParams(app ? { app: app.packageName } : {}, { replace: true });
  };

  const groups = groupByLetter(apps.filter((app) => matchesSearch(app, search)));
  return (
    <Stack>
      <FirstVisitNotice />
      <Title order={1}>「Konmai Academy」</Title>
      <TextInput
        placeholder="搜索游戏名或包名"
        leftSection={<IconSearch size={16} />}
        value={search}
        onChange={(event) => setSearch(event.currentTarget.value)}
        maw={480}
      />
      {catalogue.isPending ? (
        <Center p="xl">
          <Loader />
        </Center>
      ) : null}
      {catalogue.isError ? (
        <Alert color="red" title="加载游戏列表失败">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">{catalogue.error.message}</Text>
            <Button size="xs" variant="light" onClick={() => void catalogue.refetch()}>
              重试
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {catalogue.isSuccess && groups.size === 0 ? <Text c="dimmed">没有匹配的游戏。</Text> : null}
      {letters
        .filter((letter) => groups.has(letter))
        .map((letter) => (
          <Stack key={letter} gap="xs" id={`letter-${letter}`} className="letter-section">
            <Text fw={600} c="dimmed">
              {letter}
            </Text>
            <SimpleGrid cols={{ base: 2, sm: 3, md: 4, xl: 5 }}>
              {groups.get(letter)!.map((app) => (
                <AppCard key={app.packageName} app={app} onOpen={open} />
              ))}
            </SimpleGrid>
          </Stack>
        ))}
      <AlphabetBar available={new Set(groups.keys())} />
      <AppModal app={opened} onClose={() => open(null)} />
    </Stack>
  );
}
