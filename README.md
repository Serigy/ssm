# SSM — Serigy Service Manager

Gestão financeira, de pessoas e jurídica da Serigy Tecnologia e Marketing.
Três módulos independentes sobre uma arquitetura de microsserviços em NestJS,
com micro-frontends federados em React.

```
┌─ Navegador ─────────────────────────────────┐
│  shell  ──carrega em runtime──▶  Financeiro │
│                                  Pessoas    │
│                                  Jurídico   │
│                                  Operações  │
└──────────────────┬──────────────────────────┘
                   │ /api
┌──────────────────▼──────────────────────────┐
│  gateway                                    │
├─────────────────────────────────────────────┤
│ identity  financial   hr      legal    ops  │
│ Postgres  Postgres  Postgres  MongoDB  Postgres│
│         └──── RabbitMQ ────┘                │
│              R2 (documentos)                │
└─────────────────────────────────────────────┘
```

## Começar

```bash
make bootstrap    # confere ferramentas, gera segredos, instala dependências
make dev          # sobe a infraestrutura e os serviços
make seed         # dados de demonstração
make web-docker   # shell + 4 remotes com hot reload, contra o gateway do compose
```

`http://localhost:4200` — entre com `admin@serigy.local` /
`serigy-desenvolvimento-2026`.

Entrar com `financeiro@serigy.local`, `pessoas@serigy.local` ou
`juridico@serigy.local` (mesma senha) é a forma mais rápida de ver a filtragem
de módulos por permissão funcionando.

`make help` lista tudo.

## No Kubernetes

```bash
make install-tools   # kind, helm, terraform em ~/.local/bin
make kind-up         # cluster local com ingress-nginx
make deploy          # imagens + segredos + Helm
```

Depois `http://ssm.localhost` (adicione `127.0.0.1 ssm.localhost` ao `/etc/hosts`).

## Como o repositório está organizado

| Caminho | O quê |
|---|---|
| `apps/` | 6 serviços NestJS, 1 shell, 4 remotes |
| `libs/contracts` | Tipos e eventos compartilhados — fonte da verdade |
| `libs/nest-common` | Plataforma dos serviços: config, segredos, auth, bus, storage |
| `libs/ui-kit` | Design System da Serigy em React |
| `libs/mfe-runtime` | Contrato entre o shell e os remotes |
| `deploy/` | kind, Helm, Terraform, Ansible |
| `docs/` | Arquitetura, ADRs, runbooks, segurança, API |
| `secrets/` | Segredos em arquivo — **nunca `.env`** |
| `.claude/agents/` | design, backend, security-audit, project-manager, qa |

## Cinco coisas que valem saber antes de escrever código

1. **Segredos são arquivos**, não variáveis de ambiente.
   `secrets/local/postgres_password` e um Secret do Kubernetes montado em
   `/run/secrets` são a mesma interface — [por quê](docs/adr/0005-segredos-em-arquivo.md).
2. **Dinheiro é inteiro** na menor unidade da moeda. Toda aritmética passa por
   `apps/financial-svc/src/invoices/money.ts` e por lugar nenhum mais.
3. **Toda consulta filtra por `tenantId`** como primeiro predicado, vindo do
   token verificado — nunca de um cabeçalho.
4. **Serviços de módulo não se chamam.** Publicam eventos. A NetworkPolicy do
   chart recusa a chamada direta, em vez de a documentação desaconselhá-la.
5. **A interface segue o Design System da Serigy**, sem exceção e sem emoji.

## Documentação

Comece por [docs/README.md](docs/README.md). Para entender *por que* algo é como
é, vá direto aos [ADRs](docs/adr/).

## Segurança

Aikido Zen roda como firewall em aplicação nos cinco serviços. Ver [docs/security/](docs/security/) e o
[ADR 0009](docs/adr/0009-aikido-zen.md).

Vulnerabilidade encontrada: relate pela aba **Security** do GitHub, e não em um
issue público.

## Licença

[GPL-3.0-or-later](LICENSE). O firewall Zen é AGPL-3.0, então quem distribuir os
serviços NestJS com ele segue também os termos dessa licença. O nome e a marca
Serigy não fazem parte da licença do código.
