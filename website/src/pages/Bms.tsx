import {
  Anchor,
  Button,
  Center,
  Group,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { useBmsSearch, useBmsTables } from '../api';

export function BmsPage() {
  const [search, setSearch] = useState('');
  const [tableUrl, setTableUrl] = useState('');
  const [debouncedSearch] = useDebouncedValue(search, 500);
  const tables = useBmsTables();
  const results = useBmsSearch(debouncedSearch, tableUrl);
  const sentinel = useRef<HTMLDivElement>(null);

  // Loads the next page when the sentinel below the table scrolls into view.
  useEffect(() => {
    const element = sentinel.current;
    if (element === null) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (
        entries.some((entry) => entry.isIntersecting) &&
        results.hasNextPage &&
        !results.isFetchingNextPage
      ) {
        void results.fetchNextPage();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [results]);

  const charts = results.data?.pages.flatMap((page) => page.data) ?? [];
  const total = results.data?.pages[0]?.total_pages;
  return (
    <Stack className="document">
      <Title order={2}>BMS Package Downloader (Alpha)</Title>
      <Group grow align="flex-start">
        <TextInput
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Select
          label="Difficulty Table"
          searchable
          clearable
          value={tableUrl === '' ? null : tableUrl}
          onChange={(value) => setTableUrl(value ?? '')}
          data={(tables.data ?? []).map((table) => ({
            value: table.diff_table_url,
            label: table.diff_table_name,
          }))}
        />
      </Group>
      {results.isError ? <Text c="red">加载失败：{results.error.message}</Text> : null}
      <Table striped highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Chart Name</Table.Th>
            <Table.Th>Song Name</Table.Th>
            <Table.Th ta="right">Chart Preview</Table.Th>
            <Table.Th ta="right">Download</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {charts.map((chart) => (
            <Table.Tr key={chart.md5}>
              <Table.Td>{chart.chart_name}</Table.Td>
              <Table.Td>{chart.song_name ?? 'Unknown'}</Table.Td>
              <Table.Td ta="right">
                {chart.song_preview_url ? (
                  <Anchor href={chart.song_preview_url} target="_blank" rel="noopener noreferrer">
                    Preview Chart
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    Unavailable
                  </Text>
                )}
              </Table.Td>
              <Table.Td ta="right">
                {chart.song_url ? (
                  <Anchor href={chart.song_url} rel="nofollow noopener noreferrer">
                    Download
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    Unavailable
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {results.isPending || results.isFetchingNextPage ? (
        <Center p="md">
          <Loader size="sm" />
        </Center>
      ) : null}
      {results.hasNextPage ? (
        <Center>
          <Button variant="subtle" onClick={() => void results.fetchNextPage()}>
            加载更多
          </Button>
        </Center>
      ) : null}
      {results.isSuccess && charts.length === 0 ? <Text c="dimmed">没有匹配的谱面。</Text> : null}
      {total !== undefined && !results.hasNextPage && charts.length > 0 ? (
        <Text size="xs" c="dimmed" ta="center">
          已显示全部结果
        </Text>
      ) : null}
      <div ref={sentinel} />
    </Stack>
  );
}
