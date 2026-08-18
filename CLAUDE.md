# CLAUDE.md

Orientação para o Claude Code trabalhando neste repositório.

## O que é

SSM — Serigy Service Manager. Financeiro, Pessoas e Jurídico, em microsserviços
NestJS com micro-frontends federados. Monorepo Nx + pnpm.

Leia [docs/README.md](docs/README.md) para o mapa e [docs/adr/](docs/adr/) para
as decisões. **Não relitigue um ADR sem dizer qual e por quê.**

## Agentes

Cinco agentes especializados em `.claude/agents/`. Use-os — eles carregam as
regras do domínio que a resposta genérica não tem:

| Agente | Para |
|---|---|
| `design` | Qualquer coisa de interface, componente, cor, tipografia, copy |
| `backend` | Serviços NestJS, endpoints, migrações, eventos |
| `security-audit` | Revisão de segurança, autenticação, autorização, segredos |
| `project-manager` | Planejamento, escopo, dependências, ADRs |
| `qa` | Testes, estratégia de cobertura, reprodução de bug |

## Regras que não se negociam

**Segredos são arquivos.** `SecretsService.require('nome')` lê
`/run/secrets/nome`. Nunca `process.env` para credencial, nunca segredo em log,
nunca segredo como variável de ambiente de contêiner. Ver
[secrets/README.md](secrets/README.md).

**Dinheiro é inteiro** na menor unidade da moeda, com código ISO-4217. Nunca
`float`, nunca `numeric`. Toda aritmética em
`apps/financial-svc/src/invoices/money.ts` — não crie um segundo ponto de
arredondamento.

**`tenantId` é o primeiro predicado de toda consulta**, e vem de `@TenantId()`,
que lê o JWT verificado. Nunca de header, query ou body. É a defesa principal
contra vazamento entre clientes.

**Esquemas Zod em `libs/contracts` são a fonte da verdade.** Servidor, front-end
e consumidor de evento usam a mesma definição. Não escreva a mesma forma duas
vezes.

**Eventos passam pelo outbox**, gravados na mesma transação da mudança de
domínio. Consumidores são idempotentes — a entrega é at-least-once.

**Serviços de módulo não se chamam por HTTP.** Publicam eventos. A NetworkPolicy
recusa a chamada direta.

**Migrações são escritas à mão e revisadas.** `synchronize: false` em todo
lugar. Coloque os invariantes em constraints CHECK, não só no código.

**A interface segue o Design System da Serigy** (`/home/edgar/Projects/SERIGY/design`).
Sem emoji, em nenhuma superfície. Toda tela tem estado vazio, de carregamento e
de erro.

## Comandos

```bash
make help          # tudo
make dev           # sobe o ambiente
make seed          # dados de demonstração
make web           # front-ends com hot reload
make affected      # lint + tipos + testes do que mudou
make check         # o que o CI roda
make openapi       # regenera as specs — faça commit do diff
make secrets-check # nada sensível rastreado pelo git
```

## Ao adicionar um endpoint

1. Esquema Zod em `libs/contracts`.
2. `@RequirePermissions(...)` — toda rota nasce autenticada; `@Public()` precisa
   de justificativa escrita.
3. Método de serviço, com transação e lock onde houver read-modify-write.
4. Anotações do Swagger, incluindo as respostas de falha que importam.
5. `make openapi` e commit do diff.
6. Teste do invariante, não do caminho feliz.

## Ao adicionar uma tela

1. Componha com `@ssm/ui-kit` antes de criar componente novo.
2. Os três estados: vazio, carregando, erro.
3. Copy em português, sentence case, botão com verbo + objeto.
4. Caminho de teclado funciona; diálogo prende e devolve o foco.
5. Números em `.ssm-num` — mono, tabular, alinhado à direita.

## Onde as coisas estão

| Preciso de… | Está em |
|---|---|
| Tipo ou evento compartilhado | `libs/contracts/src/` |
| Auth, segredos, bus, storage, health | `libs/nest-common/src/` |
| Componente de interface | `libs/ui-kit/src/components/` |
| Contrato shell ↔ remote | `libs/mfe-runtime/src/module-contract.ts` |
| Aritmética de dinheiro | `apps/financial-svc/src/invoices/money.ts` |
| Topologia do RabbitMQ | `libs/contracts/src/events/topology.ts` |
| Catálogo de eventos | `libs/contracts/src/events/catalog.ts` |
| Tokens de design | `libs/ui-kit/src/tokens/` (cópia literal — não edite) |
