# 0001 — Monorepo com Nx e pnpm

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

Nove projetos publicáveis — cinco serviços, quatro front-ends — mais quatro
bibliotecas compartilhadas. As bibliotecas mudam com frequência: `contracts`
muda toda vez que um endpoint muda; `ui-kit` muda toda vez que uma tela nova
precisa de um componente.

Em repositórios separados, cada mudança dessas vira um ciclo de publicar,
esperar, bumpar versão e abrir mais três PRs. É onde equipes pequenas gastam
tempo que não têm.

## Decisão

Um monorepo com `pnpm workspaces` para as dependências e **Nx** para orquestrar
as tarefas.

Nx é usado de forma deliberadamente rasa: os `project.json` usam
`nx:run-commands` chamando as ferramentas nativas de cada projeto (`nest build`,
`vite build`, `docker build`). Não usamos executores nem geradores do Nx.

O que se quer do Nx são duas coisas concretas: o grafo de afetados
(`nx affected`) e o cache de tarefas. O resto seria acoplamento com a
ferramenta em troca de nada.

## Consequências

**Bom.** Uma mudança em `contracts` e nos serviços que a consomem é um único PR,
revisado junto. `nx affected` faz o CI rodar só o que a mudança tocou. Os
aliases de caminho apontam para o *fonte* das libs, então não há passo de build
intermediário durante o desenvolvimento.

**Ruim:**

- **Fronteiras precisam ser impostas.** Nada impede que um serviço importe outro
  a não ser disciplina e as tags nos `project.json`.
- **O CI precisa do histórico.** `fetch-depth: 0`, senão o grafo de afetados não
  tem contra o que comparar.
- **Uma mudança em `nest-common` afeta tudo.** É o preço correto: se o efeito é
  amplo, a revisão deve ser ampla.

## Alternativas consideradas

**Repositórios separados** — isolamento real e implantação independente por
construção. Rejeitado pelo atrito de publicar `contracts` a cada mudança de
endpoint, que é a operação mais frequente do projeto.

**pnpm workspaces sem orquestrador** — mais simples e transparente. Rejeitado
por não ter cache nem detecção de afetados, o que deixa de ser tolerável
passando de meia dúzia de projetos.

**Turborepo** — mais leve que o Nx e resolveria as duas necessidades. Foi uma
escolha próxima; Nx ganhou pelo grafo de dependências entre projetos, que
`turbo` deriva de forma mais frouxa a partir das dependências do `package.json`.
