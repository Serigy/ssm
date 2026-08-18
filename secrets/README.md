# `secrets/` — file-based secrets

SSM does **not** use `.env` files. Every secret is a *single file whose entire
contents are the secret value*, named after the secret in `lower_snake_case`
with no extension.

```
secrets/local/postgres_password        ->  "s3cr3t"        (no trailing newline)
secrets/local/jwt_private_key.pem      ->  "-----BEGIN ..."
```

## Why files and not `.env`

| | `.env` | `secrets/` files |
|---|---|---|
| Accidental `git add -A` | one file leaks everything | `secrets/*` is ignored twice over |
| Docker | `env_file:` bakes values into `docker inspect` and `/proc/<pid>/environ` | `secrets:` mounts a tmpfs file, invisible to `env` |
| Kubernetes | needs a ConfigMap→env dance | a `Secret` volume mount **is** this layout, byte for byte |
| Rotation | restart with a new file, re-read the whole env | overwrite one file; `SecretsService` re-reads on next access |
| Leak radius | one grep dumps every credential | each file is opened only by the code that needs it |

The decisive point is the third row: `secrets/local/` and a Kubernetes
`Secret` mounted at `/run/secrets` are **the same interface**. The application
reads `${SSM_SECRETS_DIR}/postgres_password` in both cases and has no idea
which environment it is in. There is no dev-only code path to get wrong.

## Layout

```
secrets/
├── README.md            committed
├── .gitignore           committed
├── example/             committed — templates, placeholder values only
│   ├── postgres_password.example
│   └── ...
└── local/               GENERATED, never committed
    ├── postgres_password
    ├── mongo_password
    ├── rabbitmq_password
    ├── jwt_private_key.pem
    ├── jwt_public_key.pem
    ├── r2_access_key_id
    ├── r2_secret_access_key
    ├── r2_account_id
    └── aikido_token
```

## Getting started

```bash
make secrets          # or: ./scripts/gen-secrets.sh
```

That generates `secrets/local/` with cryptographically random values and a
fresh RS256 keypair for JWT signing. It never overwrites an existing file —
run `./scripts/gen-secrets.sh --force` if you actually want to rotate.

Values that must be real (Cloudflare R2 credentials, the Aikido token) are
written as empty placeholder files; fill them in by hand. Services that need
them fail loudly at boot rather than silently degrading.

## How code reads them

```ts
import { SecretsService } from '@ssm/nest-common';

const password = secrets.require('postgres_password');   // throws if absent
const token    = secrets.get('aikido_token');            // string | undefined
```

Resolution order for a secret named `foo`:

1. `SSM_SECRET_FOO` environment variable (escape hatch for CI)
2. `FOO_FILE` environment variable → read that path (Docker Swarm convention)
3. `${SSM_SECRETS_DIR}/foo` — the normal path

`SSM_SECRETS_DIR` defaults to `/run/secrets` in containers and is set to
`./secrets/local` by the local `Makefile` targets.

## Per-environment secrets

| Environment | Source of truth | Mounted at |
|---|---|---|
| local (compose) | `secrets/local/` on the host | `/run/secrets` (tmpfs, read-only) |
| local (kind) | `kubectl create secret generic ssm-secrets --from-file=secrets/local` | `/run/secrets` |
| staging / prod | External Secrets Operator ← Vault / 1Password / AWS SM | `/run/secrets` |

Production **never** uses files that live in this repository. See
[docs/security/secrets-management.md](../docs/security/secrets-management.md).

## Rules

1. Never commit anything under `secrets/` other than `example/` and these docs.
2. Never log a secret value. `SecretsService` marks values non-enumerable and
   the logger redacts anything that matches a known secret.
3. Never pass a secret as a container `ENV` or a `docker run -e` flag.
4. Rotate by writing a new file — do not edit in place while services run.
