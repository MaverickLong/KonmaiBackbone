import { AppShell, Burger, Button, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconApps,
  IconChartBar,
  IconCloudDownload,
  IconLayoutDashboard,
  IconServer,
} from '@tabler/icons-react';
import { Link, Navigate, Outlet, useLocation, useNavigate } from 'react-router';
import { session } from '../api/client';

const links = [
  { to: '/', label: 'Overview', icon: IconLayoutDashboard },
  { to: '/nodes', label: 'Nodes', icon: IconServer },
  { to: '/apps', label: 'Apps', icon: IconApps },
  { to: '/downloads', label: 'Downloads', icon: IconChartBar },
  { to: '/downloader', label: 'Downloader', icon: IconCloudDownload },
];

export function Shell() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const navigate = useNavigate();
  if (session.token() === null) {
    return <Navigate to="/login" replace />;
  }
  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group>
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Title order={4}>Konmai Backbone</Title>
          </Group>
          <Button
            variant="subtle"
            size="xs"
            onClick={() => {
              session.clear();
              void navigate('/login');
            }}
          >
            Sign out
          </Button>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        {links.map((link) => (
          <NavLink
            key={link.to}
            component={Link}
            to={link.to}
            label={link.label}
            leftSection={<link.icon size={18} />}
            active={
              link.to === '/' ? location.pathname === '/' : location.pathname.startsWith(link.to)
            }
            onClick={close}
          />
        ))}
        <Text size="xs" c="dimmed" mt="auto" p="xs">
          Admin panel
        </Text>
      </AppShell.Navbar>
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
