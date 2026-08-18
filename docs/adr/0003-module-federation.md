# 0003 — Micro-frontends com Module Federation

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

O requisito de front-end espelha o de back-end: cada módulo deve poder ir ao ar
sozinho. Uma correção na tela de faturas não deve exigir reconstruir e
republicar as telas de Pessoas e Jurídico.

Ao mesmo tempo, o usuário precisa ver **um** produto: uma navegação, uma sessão,
um botão "voltar" que funciona, um tema.

## Decisão

Module Federation com Vite (`@module-federation/vite`). Um host (`shell`) e três
remotes, cada um expondo `./Module` com um `SsmModuleDefinition`.

React, ReactDOM, `react-router-dom` e as bibliotecas da Serigy são singletons
compartilhados, com `requiredVersion` — uma divergência vira erro de build em vez
de comportamento estranho em produção.

Cada remote é montado dentro de um error boundary com Suspense.

## Consequências

**Bom.** Publicar um módulo é publicar um bundle; o shell não é reconstruído.
Quem só usa o Financeiro nunca baixa o código dos outros dois. Um remote que
falha ao carregar derruba só o próprio painel. E um remote pode rodar sozinho em
desenvolvimento, contra o gateway real.

**Ruim:**

- **Falha em tempo de execução, não de build.** Um remote publicado com um
  `base` errado compila, sobe e só quebra quando alguém navega até ele. É a
  classe de erro mais cara desta decisão. Mitigado por `PUBLIC_PATH` explícito
  nas imagens e por `remoteEntry.js` marcado `no-store` no nginx.
- **Singletons são frágeis.** Duas versões de React em páginas diferentes
  produzem "invalid hook call" sem qualquer pista útil.
- **Coordenação de versão do contrato.** Mudar `SsmModuleDefinition` quebra os
  três remotes de uma vez. Daí o `contractVersion` e a recusa explícita em
  `defineModule()`.

## Alternativas consideradas

**Multi-zone do Next.js** — mais simples de raciocinar, com SSR de graça.
Rejeitado porque navegar entre zonas é um carregamento de página completo: o
usuário veria o shell piscar ao trocar de módulo, e o estado de sessão em memória
seria perdido a cada troca.

**Web Components** — isolamento máximo e liberdade de framework por módulo.
Rejeitado por duplicar bundles, complicar os tokens de design compartilhados e
piorar bastante a experiência de desenvolvimento, sem que houvesse qualquer
intenção de usar frameworks diferentes.

**SPA única** — mais simples em tudo, e teria sido a escolha certa se a
implantação independente não fosse um requisito. É.
