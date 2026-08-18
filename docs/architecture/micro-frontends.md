# Micro-frontends

## Como o shell e os remotes se encaixam

O shell é o host. Ele carrega cada módulo em tempo de execução a partir de um
`remoteEntry.js` publicado separadamente — nada do código de um módulo entra no
bundle do shell.

```
shell (host)
 ├── carrega  /financeiro/remoteEntry.js  →  financial/Module
 ├── carrega  /pessoas/remoteEntry.js     →  hr/Module
 └── carrega  /juridico/remoteEntry.js    →  legal/Module
```

O carregamento é **preguiçoso**: quem só abre o Financeiro nunca baixa um byte
de Pessoas ou Jurídico.

## O contrato

Cada remote expõe exatamente um ponto de entrada, `./Module`, com um
`SsmModuleDefinition` como export default (`libs/mfe-runtime/src/module-contract.ts`):

```ts
{
  id: 'financial',
  label: 'Financeiro',
  basePath: '/financeiro',
  Root: FinancialRoot,        // renderiza as próprias rotas, relativas a basePath
  navigation: [ … ],          // itens de menu, com a permissão que cada um exige
  permissions: [ … ],         // tudo que o módulo pode usar
  contractVersion: 1,
}
```

O shell não sabe mais nada sobre o módulo. É por isso que o interior de um
remote pode ser reescrito inteiro sem que o shell seja reconstruído.

Mudar essa interface quebra os três remotes de uma vez. Trate-a como API
pública: só mudanças aditivas; quando isso não for possível, incremente
`contractVersion` — `defineModule()` recusa um remote fora de versão em vez de
deixá-lo montar e falhar de forma obscura.

## Singletons

React, ReactDOM, o router e as libs da Serigy são **singletons compartilhados**.
Não é uma otimização de tamanho; é correção:

- duas cópias de React produzem "invalid hook call";
- duas cópias do router produzem duas pilhas de histórico, e o botão "voltar"
  passa a pular telas;
- duas cópias do `ui-kit` produzem dois conjuntos de estilos e um tema que muda
  conforme o módulo.

`requiredVersion` faz de uma divergência um erro de build, e não um mistério em
produção.

## Isolamento de falha

Cada remote é montado dentro de um `RemoteSlot` — um error boundary com Suspense.
Isso importa mais aqui do que em um monólito: o bundle é buscado de outra origem
em tempo de execução, então pode falhar de formas que um módulo empacotado junto
não pode — a implantação está no meio do rollout, o CDN devolve 404, o hash do
chunk mudou.

Sem o boundary, qualquer um desses apaga a página inteira, incluindo os dois
módulos que estão perfeitamente saudáveis.

## O detalhe que quebra em produção e não em desenvolvimento

O `base` do Vite de cada remote precisa ser **exatamente** o caminho pelo qual o
Ingress o serve:

| App | `PUBLIC_PATH` no build | Caminho no Ingress |
|---|---|---|
| shell | `/` | `/` |
| mfe-financial | `/financeiro/` | `/financeiro` |
| mfe-hr | `/pessoas/` | `/pessoas` |
| mfe-legal | `/juridico/` | `/juridico` |

O `remoteEntry.js` resolve os chunks irmãos relativos a esse caminho. Em
desenvolvimento cada remote roda na raiz da própria porta, então um `base` errado
não aparece. No cluster, aparece — como 404 nos chunks, logo após a implantação.

Por isso o `make web-images` passa `PUBLIC_PATH` explicitamente e o
`docker/nginx.conf` marca `remoteEntry.js` como `no-store`: um manifesto em
cache aponta para hashes que não existem mais, e essa é a falha clássica de
micro-frontend depois de um deploy.

## Rodando um remote isolado

```bash
pnpm nx serve mfe-financial      # http://localhost:4201
```

Ele se monta em um host de mentira (`libs/mfe-runtime/src/standalone.tsx`) que
finge exatamente duas coisas: a sessão e o destino das notificações. O
`ApiClient` é real e fala com o gateway de verdade — um módulo que só roda contra
mocks encontra a API real pela primeira vez em produção.

A sessão do modo isolado concede todas as permissões que o módulo declara, para
que o desenvolvedor veja a superfície inteira. É a única diferença deliberada em
relação ao shell, porque filtrar por permissão é trabalho do shell e é lá que se
testa.
