import {
  ActionIcon,
  AppShell,
  Box,
  Burger,
  Divider,
  Group,
  Image,
  NavLink,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconExternalLink, IconMoon, IconSun } from '@tabler/icons-react';
import { useEffect } from 'react';
import { Link, Outlet, useLocation, useMatches } from 'react-router';
import type { PageMetadata } from '../routes';

const links = [
  { to: '/', label: '游戏下载' },
  { to: '/bms/download', label: 'BMS 相关工具' },
  { to: '/license', label: '开源与许可证' },
];

const friendlyLinks = [
  { label: 'Penguin Statistics', hint: 'penguin-stats.cn', href: 'https://penguin-stats.cn' },
];

export function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const { setColorScheme } = useMantineColorScheme();
  const colorScheme = useComputedColorScheme('light');
  // A prerendered page arrives with its title; this follows the visitor from page to page after
  // that. The redirects have no title of their own.
  const metadata = useMatches().at(-1)?.handle as PageMetadata | undefined;
  useEffect(() => {
    if (metadata !== undefined) {
      document.title = metadata.title;
    }
  }, [metadata]);
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="lg"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            {/*<Image src="/logo.svg" alt="" h={28} w="auto" />*/}
            <Title order={4}>Konmai音游下载站</Title>
          </Group>
          <ActionIcon
            variant="subtle"
            size="lg"
            aria-label="切换深色模式"
            onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
          >
            {/* Both are in the markup and the stylesheet hides one: a prerendered page cannot
                know which scheme its visitor uses. */}
            <Box component={IconSun} size={20} lightHidden />
            <Box component={IconMoon} size={20} darkHidden />
          </ActionIcon>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {links.map((link) => (
          <NavLink
            key={link.to}
            component={Link}
            to={link.to}
            label={link.label}
            active={
              link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to)
            }
            onClick={close}
          />
        ))}
        <Divider my="sm" />
        <Text size="xs" c="dimmed" px="sm" pb={4}>
          Friendly Links
        </Text>
        {friendlyLinks.map((link) => (
          <NavLink
            key={link.href}
            component="a"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            label={link.label}
            description={link.hint}
            rightSection={<IconExternalLink size={14} />}
          />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
