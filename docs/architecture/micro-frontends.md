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

## Três armadilhas que custam uma tarde cada

Todas as três já morderam este repositório. Nenhuma é pega por typecheck, teste
unitário ou `curl` — só por um teste no navegador que verifica se o conteúdo
está **visível**. É o que `e2e/shell.spec.ts` faz.

### 1. Biblioteca de workspace não é singleton federado

`@ssm/mfe-runtime` está ligada por symlink ao próprio código-fonte. O host serve
a cópia dele pelo próprio dev server e o remote serve outra pelo dele, então
`createContext()` roda duas vezes e produz dois objetos distintos. O
`<HostProvider>` do shell escreve em um; o `useHost()` do remote lê do outro e
não acha nada.

Declarar `singleton: true` numa dependência assim **não** resolve — só faz a
falha parecer um bug de federação.

A saída é não depender de identidade de módulo: os serviços do host atravessam
a fronteira **como props**, e o remote os re-provê pela sua própria cópia do
contexto. Ver `RemoteRootProps` em `libs/mfe-runtime`.

### 2. A fronteira assíncrona precisa ser explícita

O escopo de módulos compartilhados é inicializado de forma assíncrona, então o
entry point só pode fazer uma coisa: importar dinamicamente o entry real. Por
isso todo app tem um `main.tsx` de uma linha e um `bootstrap.tsx` com o resto.

Se você não declarar, o plugin infere onde a fronteira fica e reescreve *aquele*
módulo num bootstrap assíncrono. Quando ele escolhe um módulo com exports
nomeados, os exports somem e você recebe
`does not provide an export named 'App'` em tempo de execução.

### 3. `React.lazy()` fora do render, sempre

`lazy()` devolve um **tipo de componente novo** a cada chamada, e o React
identifica um Suspense pela identidade do componente. Chamar `lazy()` durante o
render cria um tipo novo a cada passagem: o React desmonta a árvore já
resolvida e suspende de novo, imediatamente.

O sintoma é traiçoeiro. O módulo *realmente* monta, roda os efeitos, atualiza o
título da topbar e busca os dados — e a tela fica em branco, porque o React
marca a subárvore já renderizada com `display: none !important` enquanto espera
o componente "novo".

E vira laço no instante em que o módulo chama `setPageTitle()` num efeito, já
que isso re-renderiza o shell, que cria outro `lazy()`.

Os `lazy()` são criados uma única vez, no escopo do módulo, em
`apps/shell/src/remotes.ts`.

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
