# 0014 — Neon como banco e Cloudflare Queues para eventos

- **Estado:** Aceita, com a migração em andamento
- **Data:** 2026-11-01

Substitui o ADR [0004](0004-postgres-e-mongodb.md) e a parte de broker do ADR
[0006](0006-rabbitmq-e-outbox.md). Muda o que o ADR
[0012](0012-perimetro-sem-rede.md) diz sobre o isolamento dos bancos.

## Contexto

Os módulos vivem em duas pilhas. A de contêiner usa Postgres, MongoDB e RabbitMQ.
A de Workers usa D1 e Cloudflare Queues. Três bancos diferentes para o mesmo
domínio é um custo que só se paga enquanto a transição dura.

## Decisão

**Neon é o banco de todos os módulos.** Saem o D1 e o MongoDB. A árvore de
cláusulas do jurídico fica em `jsonb`.

**Cloudflare Queues é o único transporte de eventos.** Sai o RabbitMQ. O outbox
do ADR 0006 continua: o evento é gravado na mesma transação da mudança de domínio.

**Cada módulo tem um schema e um papel próprios no Postgres**, e cada Worker usa
uma configuração de Hyperdrive com o papel do seu módulo. Num D1 por módulo, o
isolamento vinha de existirem bancos separados. Num banco só, ele precisa vir de
permissão, ou um Worker poderia ler a folha de pagamento.

| Ambiente | Conexão no `usql` |
|---|---|
| `dev` | `ssm_development` |
| `hmg` | `ssm_staging` |
| `prd` | `ssm_production` |

## Consequências

**Bom.** Um banco e um dialeto de SQL nas duas pilhas durante a transição, e
Postgres real, com transações interativas e `CHECK`.

**Ruim:**

- **A reescrita é grande.** Há 144 chamadas ao D1, 90 trechos de sintaxe SQLite e
  604 linhas de migrações nos Workers.
- **Dados de `hmg` precisam ser levados** do D1, ou ressemeados.
- **Mais uma dependência no caminho da requisição**, agora fora da Cloudflare.
- **Queues não tem exchange de tópico.** O publicador envia uma cópia a cada fila
  interessada, como os Workers já fazem.
