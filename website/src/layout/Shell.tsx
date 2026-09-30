import {
  ActionIcon,
  AppShell,
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
import { Link, Outlet, useLocation } from 'react-router';

const links = [
  { to: '/', label: 'Konmai Academy' },
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
            <Title order={4}>Konmai Academy</Title>
          </Group>
          <ActionIcon
            variant="subtle"
            size="lg"
            aria-label="切换深色模式"
            onClick={() => setColorScheme(colorScheme === 'dark' ? 'light' : 'dark')}
          >
            {colorScheme === 'dark' ? <IconSun size={20} /> : <IconMoon size={20} />}
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
