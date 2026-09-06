import { Accordion, Anchor, Stack, Text, Title } from '@mantine/core';
import { dependencyLicenses } from '../licenses';

export function LicensesPage() {
  return (
    <Stack className="document" maw={900}>
      <Title order={1}>Open Source Licenses and Declarations</Title>
      <Title order={2}>Declarations</Title>
      <Text>
        The game resources (including but not limited to game icons, software packages, etc.) used
        on this website are intended solely to facilitate users' access to games. Their copyrights
        belong to their respective rights holders. This site does not own these contents and has not
        modified them.
      </Text>
      <Text>This website is not affiliated in any form with Google LLC or Lowiro Limited.</Text>
      <Title order={2}>Open Source Licenses</Title>
      <Text size="sm" c="dimmed">
        The site is built with the packages below; each entry reproduces the license text shipped
        with the installed version.
      </Text>
      <Accordion variant="separated">
        {dependencyLicenses.map((dependency) => (
          <Accordion.Item key={dependency.name} value={dependency.name}>
            <Accordion.Control>{dependency.name}</Accordion.Control>
            <Accordion.Panel>
              {dependency.source ? (
                <Text size="sm">
                  Source:{' '}
                  <Anchor href={dependency.source} target="_blank" rel="noopener noreferrer">
                    {dependency.source}
                  </Anchor>
                </Text>
              ) : null}
              <pre>{dependency.text}</pre>
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
    </Stack>
  );
}
