import { Stack, UnstyledButton } from '@mantine/core';
import { letters } from '../catalogue';

// Fixed jump list on the right edge, as on the old site; letters without apps are dimmed.
export function AlphabetBar({ available }: { available: Set<string> }) {
  return (
    <Stack
      gap={0}
      visibleFrom="md"
      style={{
        position: 'fixed',
        right: 8,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex: 10,
      }}
    >
      {letters.map((letter) => (
        <UnstyledButton
          key={letter}
          disabled={!available.has(letter)}
          onClick={() =>
            document.getElementById(`letter-${letter}`)?.scrollIntoView({ behavior: 'smooth' })
          }
          style={{
            fontSize: 11,
            lineHeight: '16px',
            textAlign: 'center',
            width: 20,
            opacity: available.has(letter) ? 0.8 : 0.25,
            color: 'var(--mantine-color-brand-6)',
          }}
        >
          {letter}
        </UnstyledButton>
      ))}
    </Stack>
  );
}
