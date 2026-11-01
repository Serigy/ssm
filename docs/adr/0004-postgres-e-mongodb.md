# 0004 — Postgres para três módulos, MongoDB para o Jurídico

- **Estado:** Substituída pelo ADR [0014](0014-neon-e-queues.md)
- **Data:** 2026-08-17

## Contexto

A instrução era escolher o banco conforme a necessidade de integridade
referencial. Ela é diferente em cada módulo.

**Financeiro** é um livro-razão. Uma fatura tem linhas; as linhas somam o total;
o total limita o valor pago. São invariantes que precisam valer contra qualquer
escrita, inclusive um `UPDATE` manual em uma madrugada de incidente.

**Pessoas** é um grafo: colaborador pertence a departamento, reporta a gestor,
departamento tem departamento-pai. Chaves estrangeiras com `ON DELETE SET NULL`
descrevem exatamente o comportamento desejado quando um departamento é extinto.

**Jurídico** é diferente na natureza. Um contrato é uma árvore de cláusulas de
profundidade arbitrária — 4.2.1.a existe — e cada aditivo produz uma nova versão
completa dessa árvore. Nada aponta *para dentro* da árvore de cláusulas a partir
de fora; não há o que proteger com uma chave estrangeira.

Modelar essa árvore no relacional dá duas opções, e as duas são ruins: uma
tabela de adjacência com CTE recursiva a cada leitura, ou uma coluna JSONB — que
abre mão da integridade de qualquer forma, e ainda paga o preço de fingir que não.

## Decisão

- `identity-svc`, `financial-svc`, `hr-svc` → **PostgreSQL**, um banco por
  serviço, com constraints CHECK expressando os invariantes.
- `legal-svc` → **MongoDB**, com o documento inteiro em uma coleção e o
  histórico de versões como snapshots completos embutidos.
- O binário (PDF assinado) → **R2** nos dois casos. O banco guarda a chave.

O que precisa de integridade referencial *e* pertence ao Jurídico — quem é a
contraparte, quanto se cobra — vive no Postgres sob o Financeiro, referenciado
aqui só por id.

## Consequências

**Bom.** Cada domínio usa o modelo que o descreve. As constraints do Postgres
protegem o dinheiro contra escrita direta. A árvore de cláusulas é lida em um
`find` e escrita em um `update`, sem recursão. O histórico é snapshot completo,
não cadeia de diffs — reconstruir "o que dizia a cláusula 7.3 na assinatura" é
uma leitura, não um replay.

**Ruim:**

- **Dois bancos para operar**, com dois modelos de backup, dois de restauração e
  dois conjuntos de conhecimento na equipe. É o custo real da decisão.
- **Sem transação no Jurídico entre coleções.** Mitigado por só existir uma
  coleção: um contrato é um documento, e uma escrita é atômica por documento.
- **Sem integridade referencial no Jurídico.** Um `externalRef` apontando para um
  colaborador que não existe mais é possível. Por isso o legal-svc consome
  `hr.employee.offboarded` e marca esses contratos para revisão humana — a
  consistência é reconciliada, não garantida.
- **Snapshots completos crescem.** Um contrato com 200 cláusulas e 30 aditivos
  guarda 30 cópias. Armazenamento é barato; reconstruir por diffs, não.

## Alternativas consideradas

**Postgres para tudo, cláusulas em JSONB** — um banco a operar. Rejeitado
porque a JSONB abre mão da integridade dentro da árvore exatamente como o Mongo,
sem ganhar nada em troca: continua sem chave estrangeira para dentro do
documento, e ainda perde os índices e a busca textual que o Mongo oferece
nativamente sobre a estrutura.

**MongoDB para tudo** — rejeitado imediatamente. O Financeiro precisa de
`CHECK (amount_paid_minor BETWEEN 0 AND total_minor)` valendo contra qualquer
escrita. Transações multi-documento no Mongo existem, mas exigem que toda a
disciplina esteja na aplicação, e a aplicação é justamente o que se quer proteger.

**Event sourcing no Jurídico** — atraente, já que o histórico é o requisito
central. Rejeitado por desproporção: o volume é de milhares de contratos, não
milhões de eventos, e o custo cognitivo de projeções e replay não se paga nessa
escala.
