# 0013 — Sentry para erros e desempenho

- **Estado:** Aceita
- **Data:** 2026-11-01

## Contexto

Em `hmg` e `prd` o SSM roda em seis Workers e cinco front-ends, e até aqui um
erro inesperado só existia como linha de log. A varredura de CI da Aikido saiu do
pipeline no mesmo movimento (ver ADR [0009](0009-aikido-zen.md)).

O Sentry não substitui essa varredura: ele vê o que falha em execução, não o que
está vulnerável no código. SAST e IaC deixaram de existir no CI.

## Decisão

Adotar o Sentry nos Workers (`ssm-workers`) e no navegador (`ssm-web`). Os
serviços NestJS ficam de fora, porque estão sendo substituídos.

**Nenhum dado de pessoa vai para o Sentry.** O padrão do SDK coleta cookies,
cabeçalhos, query e corpo HTTP; aqui tudo isso está desligado, e não há session
replay, porque as telas mostram CPF, folha e contrato. O evento leva a exceção, o
stack, a rota e o `traceId` que o liga ao log.

Só o erro inesperado é reportado. `HttpProblem` é o sistema funcionando.

## Consequências

**Bom.** Erro de produção chega com stack, versão e rota, e o `traceId` da
resposta localiza o evento.

**Ruim:**

- **Mais um fornecedor recebendo dados de execução.** Mensagens de exceção vão
  junto, então nenhuma deve interpolar dado pessoal.
- **Depuração com menos contexto.** Sem corpo da requisição, reproduzir um erro
  depende do log e do `traceId`.
- **O IP precisa de ajuste no painel.** Veja o runbook de desenvolvimento local.
