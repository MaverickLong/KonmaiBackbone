import { Alert, Button, Code, CopyButton, Group, Stack, Text } from '@mantine/core';
import type { NodeCreatedView } from 'konmai-shared';

export function TokenReveal({ created }: { created: NodeCreatedView }) {
  const config = JSON.stringify(created.config, null, 2);
  return (
    <Stack>
      <Alert color="yellow" title="Shown once">
        Copy this token now; the host only stores a hash of it. Rotate it from the node page if it
        is lost.
      </Alert>
      <Text size="sm">Enrollment token</Text>
      <Group>
        <Code style={{ wordBreak: 'break-all' }}>{created.token}</Code>
        <CopyButton value={created.token}>
          {({ copied, copy }) => (
            <Button size="xs" variant="light" onClick={copy}>
              {copied ? 'Copied' : 'Copy token'}
            </Button>
          )}
        </CopyButton>
      </Group>
      <Text size="sm">
        <code>node/config.json</code> for {created.node.domain}
      </Text>
      <Code block>{config}</Code>
      <CopyButton value={config}>
        {({ copied, copy }) => (
          <Button size="xs" variant="light" onClick={copy}>
            {copied ? 'Copied' : 'Copy config.json'}
          </Button>
        )}
      </CopyButton>
    </Stack>
  );
}
