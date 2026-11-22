import {
  Alert,
  Button,
  Card,
  Center,
  Loader,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
  Typography,
} from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import type { PublicAppView } from 'konmai-shared';
import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';
import { useCatalogue } from '../api';
import { appForHash, groupByLetter, letters, matchesSearch } from '../catalogue';
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
  // A link in the old site's `/#<game name>` form becomes `?app=` once the catalogue can tell
  // which app it means; setting the parameter also drops the hash.
  const { hash } = useLocation();
  useEffect(() => {
    if (catalogue.data === undefined || openedPackage !== null) {
      return;
    }
    const linked = appForHash(catalogue.data, hash);
    if (linked !== null) {
      setParams({ app: linked.packageName }, { replace: true });
    }
  }, [catalogue.data, hash, openedPackage, setParams]);

  const groups = groupByLetter(apps.filter((app) => matchesSearch(app, search)));
  return (
    <Stack>
      <FirstVisitNotice />
      <Title order={1}>Download w/o the BS.</Title>
      <Card fz="sm" lh="md">
        <Typography>
          问题反馈请前往：
          <a href="https://space.bilibili.com/1227019768">Bilibili - Konmai Academy</a>
        </Typography>
        <Typography pt="xs">
          <b>如您在11月20日至21日期间使用过下载站，请立即卸载所有已安装的软件包体。</b>
          <br />
          11月20日至11月21日期间，由于上游网络服务商对网站所使用服务器进行了脚本注入操作，Konmai的其中一台下载节点发生了信息泄露。
          <br />
          目前已确认泄露的信息如下：
          <br />
          -
          11月11日至11月21日期间，该节点的访问用户的IP地址和UA等特征信息。这些信息并未和您的个人隐私信息关联。
          <br />
          - 该节点域名使用的SSL证书。
          <br />
          我们不认为上游服务商对分发的游戏进行了任何修改，但为了保证您的信息安全，如您在11月20日至11月21日期间使用过下载站，请立刻卸载在此期间从下载站下载的全部游戏并删除其安装包。如果您仅仅是访问网站，并未进行下载操作，您的数据不会受到影响。
          <br />
          目前我们已经对所有该服务商的节点进行了清退，相关域名也已经停止解析，此后不再使用。
          <br />
          此次数据泄露并非针对我们的打击，而是上游服务商违反职业道德，对于其托管的全部服务器进行了扫描和窃取操作。由于虚拟化技术限制，这类扫描在技术层面无法避免，但此次事件应当归因于我们对于选择的上游平台未进行充分的风险分析，我们对此负主要责任。在此，我们向各位表达诚挚的歉意。
          {/* 想支持我们？觉得我们网速很快？
          <a
            style={{ whiteSpace: 'nowrap' }}
            rel="sponsored"
            href="https://www.dmit.io/aff.php?aff=5829"
          >
            欢迎前往 DMIT 选购同款服务器
          </a> */}
        </Typography>
      </Card>

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
