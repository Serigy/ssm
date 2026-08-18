# 0006 — RabbitMQ com outbox transacional

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

Decidido em [0002](0002-microsservicos-por-modulo.md) que os módulos se
comunicam por eventos, restam duas perguntas: qual broker, e como garantir que
um evento não se perca entre o commit no banco e a publicação.

O segundo problema é o que importa. Um handler que faz:

```ts
await db.save(invoice);      // commit 1
await bus.publish(event);    // commit 2
```

tem dois commits e nenhuma transação entre eles. Uma queda no meio deixa o banco
afirmando que a fatura foi emitida enquanto nenhum consumidor jamais soube. Isso
não é uma condição rara em produção — é o que acontece em todo deploy que reinicia
um pod no instante errado.

## Decisão

**RabbitMQ**, um exchange `topic` chamado `ssm.events`, uma fila durável por
serviço, anel de repetição com TTL e DLQ.

**Outbox transacional** para publicar. O evento é gravado na tabela `outbox`
dentro da mesma transação da mudança de domínio. Um relay em processo lê as
linhas não publicadas com `FOR UPDATE SKIP LOCKED`, publica com *publisher
confirm* e marca como publicada.

O commit do banco vira o único ponto da verdade. O pior caso passa a ser uma
publicação duplicada — que os consumidores já toleram, porque a entrega é
at-least-once de qualquer forma.

## Consequências

**Bom.** Nenhum evento se perde num crash. `SKIP LOCKED` permite rodar o relay em
todas as réplicas sem duplicar nem competir. O anel de repetição dá backoff sem
plugin de broker. A DLQ torna visível o que falhou definitivamente.

**Ruim:**

- **Latência de até 1 segundo** entre o commit e a publicação, pelo intervalo de
  polling. Aceitável para tudo que atravessa módulos aqui.
- **A tabela `outbox` cresce.** Precisa de expurgo periódico das linhas
  publicadas; o índice parcial mantém a consulta do relay barata enquanto isso
  não acontece.
- **Consumidores precisam ser idempotentes**, sempre. É uma disciplina que não
  se pode relaxar em nenhum handler.
- **Mais um componente com estado para operar.**

## Alternativas consideradas

**Publicar direto, sem outbox** — bem mais simples. Rejeitado por perder eventos
exatamente na janela em que mais se precisa deles.

**LISTEN/NOTIFY do Postgres em vez de polling** — sem latência. Rejeitado porque
o `NOTIFY` é perdido se nenhuma conexão estiver escutando naquele instante, que é
precisamente a janela de crash que o outbox existe para sobreviver.

**Kafka** — ordenação por partição, retenção longa, replay. Rejeitado por
desproporção: o volume é de dezenas de eventos por minuto, e o custo operacional
de um cluster Kafka não se paga. O roteamento por tópico do RabbitMQ é mais
expressivo para o padrão de assinatura usado aqui.

**`@nestjs/microservices` com transporte RMQ** — rejeitado por não modelar
exchange `topic` com DLX e contagem de tentativas por mensagem; ele assume uma
fila por padrão.
