import { Alert, Button, Center, Paper, PasswordInput, Stack, Title } from '@mantine/core';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { ApiError, session } from '../api/client';
import { useLogin } from '../api/hooks';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const login = useLogin();
  const navigate = useNavigate();
  if (session.token() !== null) {
    return <Navigate to="/" replace />;
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    login.mutate(password, {
      onSuccess: (view) => {
        session.store(view.token);
        void navigate('/');
      },
    });
  };
  return (
    <Center h="100vh">
      <Paper withBorder p="xl" w={360} component="form" onSubmit={submit}>
        <Stack>
          <Title order={3}>Konmai Backbone</Title>
          <PasswordInput
            label="Admin password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoFocus
            required
          />
          {login.error ? (
            <Alert color="red">
              {login.error instanceof ApiError ? login.error.message : 'login failed'}
            </Alert>
          ) : null}
          <Button type="submit" loading={login.isPending}>
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
}
