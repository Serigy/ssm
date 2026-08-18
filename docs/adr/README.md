# Registros de decisão de arquitetura

Cada arquivo registra uma decisão: o contexto em que foi tomada, o que se
decidiu, o que isso passou a custar, e o que foi rejeitado.

A seção de alternativas é a que se paga. Um ADR que não diz o que foi descartado
e por quê é um changelog, não um registro de decisão — e daqui a um ano ninguém
vai lembrar se a opção óbvia foi considerada.

| # | Decisão | Estado |
|---|---|---|
| [0001](0001-monorepo-nx.md) | Monorepo com Nx e pnpm | Aceita |
| [0002](0002-microsservicos-por-modulo.md) | Um microsserviço por módulo de negócio | Aceita |
| [0003](0003-module-federation.md) | Micro-frontends com Module Federation | Aceita |
| [0004](0004-postgres-e-mongodb.md) | Postgres para três módulos, MongoDB para o Jurídico | Aceita |
| [0005](0005-segredos-em-arquivo.md) | Segredos em arquivo, não em `.env` | Aceita |
| [0006](0006-rabbitmq-e-outbox.md) | RabbitMQ com outbox transacional | Aceita |
| [0007](0007-gateway-como-proxy.md) | Gateway é proxy reverso, não BFF | Aceita |
| [0008](0008-zod-como-contrato.md) | Zod como fonte única de esquema | Aceita |
| [0009](0009-aikido-zen.md) | Aikido Zen como firewall em aplicação | Aceita |
| [0010](0010-cache-e-busca.md) | Redis como coordenação; sem Elasticsearch e sem IndexedDB | Aceita |
| [0011](0011-passport-na-fronteira-de-login.md) | Passport na fronteira de login, não no acesso a recurso | **Proposta** |

## Formato

```markdown
# NNNN — Título

- **Estado:** Proposta | Aceita | Substituída por NNNN | Obsoleta
- **Data:** AAAA-MM-DD

## Contexto
O que era verdade quando a decisão foi tomada.

## Decisão
O que foi decidido, na voz ativa.

## Consequências
O que isso passou a custar. Inclua as consequências ruins — são as que importam.

## Alternativas consideradas
O que foi rejeitado e por quê.
```
