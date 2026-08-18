# 0002 — Um microsserviço por módulo de negócio

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

O SSM tem três domínios — Financeiro, Pessoas e Jurídico — mais identidade. Os
três mudam por razões diferentes e em ritmos diferentes: legislação fiscal,
política de RH, modelo contratual. Nenhum tem motivo para esperar os outros para
ir ao ar.

Microsserviços custam caro. Consistência deixa de ser transacional, depuração
passa por várias origens de log, e a operação ganha quatro processos onde havia
um. Esse custo só se paga quando as unidades realmente têm ciclos de vida
independentes.

Aqui têm, e existe um segundo motivo que um monólito não resolveria bem: os três
módulos têm perfis de acesso a dado sensível muito diferentes. Pessoas guarda CPF
e salário; Jurídico guarda cláusulas confidenciais; Financeiro guarda valores. Em
um processo único, qualquer falha de autorização expõe os três de uma vez.

## Decisão

Um serviço NestJS por módulo, cada um com seu próprio banco. Serviços de módulo
**não se chamam por HTTP** — comunicam-se publicando eventos no RabbitMQ.

A regra é imposta pela NetworkPolicy do chart: um serviço de módulo só aceita
tráfego do gateway. Uma chamada direta entre módulos é recusada pelo cluster, e
não apenas desaconselhada pela documentação.

## Consequências

**Bom.** Uma implantação por módulo. Uma migração no Financeiro não pode quebrar
Pessoas, porque não existe join entre eles. Uma falha no Jurídico não derruba o
Financeiro. Os segredos são entregues por serviço — só o hr-svc recebe a chave
de criptografia de PII.

**Ruim, e é preciso conviver com isso:**

- **Consistência é eventual.** Quando um colaborador é desligado, o Financeiro
  fica sabendo em segundos, não no mesmo commit. Todo fluxo entre módulos precisa
  ser desenhado para tolerar essa janela.
- **Não existe transação distribuída.** Nada de commit atômico atravessando
  módulos. Onde isso seria necessário, o desenho está errado ou o passo pertence
  a um único módulo.
- **Depurar exige correlação.** Daí o `correlationId` obrigatório em toda
  requisição e em todo evento.
- **Dados duplicados.** O Jurídico guarda o nome da contraparte; o Financeiro
  também. São cópias, e vão divergir. Aceitamos, porque a alternativa é uma
  chamada síncrona que acopla a disponibilidade dos dois.

## Alternativas consideradas

**Monólito modular** — um processo, módulos com fronteiras internas. Mais
simples de operar e transacionalmente consistente. Rejeitado porque a fronteira
interna é sempre atravessável: basta um `import` para que dois módulos passem a
compartilhar estado, e a erosão é gradual e invisível até virar irreversível. E
não resolve o isolamento de dado sensível.

**Microsserviços mais granulares** (um por agregado: faturas, pagamentos,
colaboradores, folha…) — rejeitado por não haver nada que os separe. Faturas e
pagamentos mudam juntos, têm o mesmo dono e a mesma cadência; separá-los criaria
uma transação distribuída onde hoje há um `BEGIN`.

**Serviços chamando-se diretamente por HTTP** — mais simples de escrever e de
depurar. Rejeitado porque acopla disponibilidade: emitir uma fatura passaria a
falhar sempre que o hr-svc estivesse fora, sem que houvesse qualquer razão de
negócio para isso.
