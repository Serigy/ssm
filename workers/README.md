# workers/ — a reescrita para Cloudflare

Esta pasta cresce ao lado de `apps/`, não no lugar dela. Um módulo por vez muda
de casa; `apps/` só é apagado quando o último sair. Reescrever tudo de uma vez
significaria semanas sem sistema funcionando, e sem nada com que comparar o
comportamento novo.

## Mapa

| Hoje | Cloudflare | Observação |
|---|---|---|
| NestJS em contêiner | Worker (Hono) | Isolates V8, não Node — é reescrita, não porte |
| PostgreSQL | **D1** | SQLite. Mantém CHECK e chave estrangeira |
| MongoDB | **D1** | Árvore de cláusulas vira JSON em coluna (JSON1) |
| RabbitMQ | **Queues** | Sem exchange de tópico — leque no publicador |
| Redis: denylist | **KV** | Consistência eventual é aceitável aqui |
| Redis: rate limit | **Durable Object** | KV não tem incremento atômico |
| Redis: idempotência | **Durable Object** | KV não garante ler o que acabou de escrever |
| `pg_advisory_xact_lock` | **Durable Object** | Numeração sem buracos precisa de serialização |
| MinIO / R2 | **R2** | Já era R2; some o MinIO local |
| nginx + Ingress | **Pages + Routes** | Front-ends estáticos, roteamento por rota |
| Gateway (proxy) | **Routes + Rate Limiting** | Sobra só o `/api/v1/status` |
| E-mail transacional | **Email Workers** | Novo — não existia |
| Segredos em arquivo | **`wrangler secret` via `op`** | Ver `scripts/cf-secrets.sh` |

## Ambientes

`dev` roda local no Wrangler (Miniflare: D1 em SQLite no disco, KV e Queues
simulados). `hmg` e `prd` são contas de verdade, com bindings separados.

```bash
./scripts/cf-devvars.sh          # gera os .dev.vars a partir de secrets/local/
./scripts/cf-dev.sh              # sobe os seis Workers no Miniflare
./scripts/cf-dev.sh status
./scripts/cf-dev.sh stop legal   # ou restart, ou um subconjunto
pnpm --filter @ssm/worker-seed seed identity   # com o Worker parado
```

| Worker | Porta | Atende |
|---|---|---|
| gateway | 8800 | `/api/v1/status` e a posse do Durable Object |
| identity | 8801 | login, refresh, sessão |
| financial | 8802 | faturas, emissão, pagamentos |
| hr | 8803 | colaboradores, admissão, desligamento |
| legal | 8804 | contratos, aditivos, vencimentos, documentos |
| operations | 8805 | chamados, ambientes, apuração de SLA |

O estado do Miniflare é **compartilhado** entre os seis (`workers/.wrangler-state`),
porque em produção o KV também é: a lista de revogação de sessão é um namespace
único. Com um estado por Worker, sair do sistema não encerraria a sessão nos
outros módulos no ambiente local — passaria no teste aqui e falharia na nuvem.
Cada banco D1 de desenvolvimento tem id próprio; sem isso os cinco colidiriam
num arquivo só.

O gateway é o primeiro a subir num ambiente novo: ele declara a classe do
Durable Object que os outros cinco acessam por binding entre scripts.

**Semear exige o Worker parado.** O estado é um SQLite compartilhado; abri-lo
por fora enquanto o `workerd` o segura devolve `SQLITE_BUSY` e derruba o
runtime inteiro. A ferramenta de semente confere a porta e recusa, mas a ordem
é: parar, semear, subir.

## Banco: Neon

O ADR 0014 trocou o D1 pelo Neon. **Os cinco módulos estão no Neon**; o gateway
não guarda nada. Nenhum Worker declara `d1_databases` nem lê `env.DB`.

- `workers/shared/src/database.ts` dá ao código o subconjunto do D1 que ele usava
  (`prepare/bind/first/all/run` e `batch`) sobre Postgres, via Hyperdrive, mais
  `transaction()` para ler-decidir-escrever na mesma conexão. O módulo liga isso
  com `createApp(base, { postgres: true })` e lê `c.get('db')`; cron e fila abrem
  a própria conexão com `openFromBinding` e a fecham no `finally`.
- `workers/shared/src/outbox.ts`: o evento do outbox sai do mesmo comando da
  mudança (`UPDATE … RETURNING` num CTE alimentando o `INSERT`), então quem perde
  a corrida não deixa evento fantasma.
- Migrações: `workers/migrations/postgres/` (ver o README de lá). As SQL antigas do
  D1 em `workers/migrations/<módulo>/` ficam como referência para a carga dos dados.
- Em dev, o `wrangler dev` conecta direto no Neon de desenvolvimento pelo
  `.env` que `scripts/cf-devvars.sh` gera (o `.dev.vars` não serve para isso).
- hmg e prd dependem de Hyperdrives que ainda não foram criados: os cinco
  `wrangler.jsonc` trazem `PENDENTE-CRIAR-HYPERDRIVE-*` e o deploy desses
  ambientes está impedido até os ids existirem.

## Decisões fechadas por medição

- **Argon2id continua, com o custo mínimo da OWASP.** Medido dentro do workerd:

  | configuração | custo de CPU | veredicto |
  |---|---|---|
  | m=64 MiB, t=3 (o do contêiner) | 1637 ms | metade dos 128 MiB do Worker |
  | **m=19 MiB, t=2, p=1** | **394 ms** | mínimo documentado pela OWASP |
  | m=7 MiB, t=5 | 299 ms | abaixo do mínimo recomendado |

  A implementação é em JavaScript puro (`@noble/hashes`), e não WASM: o workerd
  recusa `WebAssembly.compile()` com "Wasm code generation disallowed by
  embedder", então biblioteca que traz o módulo embutido em base64 — como a
  hash-wasm — não roda. Só entra WASM importado estaticamente no bundle.

  **Isto exige o plano Workers Paid, e a descoberta foi cara.** O plano
  gratuito dá 10 ms de CPU por invocação; 394 ms estouram com o erro 1102, e o
  sintoma engana: a sonda de saúde responde 200, o Worker parece vivo, e só o
  login falha. Em homologação ele funcionou nas primeiras vezes e passou a
  falhar sempre, o que faz parecer regressão de código.
  Não há ajuste que resolva: nenhuma função de derivação de senha com força
  defensável cabe em 10 ms — ser cara é o propósito dela. Quem quiser SSM na
  Cloudflare paga os cinco dólares ou tira a senha do Worker.

  A perda é real e está registrada: um atacante com a tabela de hashes trabalha
  menos do que trabalharia com o ajuste anterior. O que a compensa é que o
  bloqueio por tentativas continua igual, existe agora um limite por origem
  antes do hash, e o hash carrega os próprios parâmetros — subir o custo depois
  é mudar duas constantes, e quem entra tem a senha recalculada no login.

- **Numeração fiscal sem lacuna.** O número é *concedido* pelo Durable Object,
  não gasto: quem pediu confirma depois de gravar ou devolve se não gravou. Sem
  isso, uma emissão que perde a corrida de versão queima o número — medido, e
  abriu lacuna na primeira tentativa. Concessão sem resposta volta para a fila
  em 120 s, para um Worker que morre no meio não deixar buraco.

## Limites de plano que a arquitetura assume

| Limite | Gratuito | Paid (US$ 5/mês) | Onde dói |
|---|---|---|---|
| CPU por invocação | 10 ms | 30 s | argon2id no login: 394 ms |
| Bancos D1 | 10 | milhares | 5 por ambiente, mais os outros projetos da conta |

A conta da Serigy já tinha 10 bancos ao provisionar produção — cinco de
homologação, um de produção e quatro de outros projetos —, e os quatro
restantes não puderam ser criados.

## O que ainda não foi decidido

- **Latência do outbox.** Cron Trigger tem granularidade de 1 minuto. Hoje o
  relay roda a cada segundo. Ou aceitamos 60 s entre módulos, ou publicamos na
  fila dentro do mesmo `batch()` do D1 e abrimos mão da atomicidade estrita.
