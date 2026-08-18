import { useState, type FormEvent } from 'react';
import { Button, Card, Input } from '@ssm/ui-kit';
import type { LoginRequest } from '@ssm/contracts';

interface Props {
  onSignIn: (credentials: LoginRequest) => Promise<void>;
}

export function LoginScreen({ onSignIn }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSignIn({ email, password });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--space-6)',
        background: 'var(--surface-inverse)',
        // The one place the brand stripe pattern appears in the product.
        backgroundImage: 'var(--pattern-stripes)',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-8)' }}>
          <div className="ssm-shell__wordmark" style={{ fontSize: 28 }}>
            SERIGY
          </div>
          <div className="ssm-shell__product" style={{ fontSize: 11 }}>
            SERVICE MANAGER
          </div>
        </div>

        <Card title="Entrar">
          <form onSubmit={submit} className="ssm-stack" style={{ gap: 'var(--space-4)' }}>
            <Input
              label="E-mail corporativo"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Input
              label="Senha"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error ?? undefined}
            />
            <Button type="submit" fullWidth loading={busy}>
              {busy ? 'Entrando' : 'Entrar'}
            </Button>
          </form>
        </Card>

        <p
          style={{
            marginTop: 'var(--space-5)',
            textAlign: 'center',
            fontSize: 'var(--text-2xs)',
            fontFamily: 'var(--font-mono)',
            color: 'var(--neutral-400)',
          }}
        >
          ACESSO RESTRITO — ATIVIDADE REGISTRADA
        </p>
      </div>
    </div>
  );
}
