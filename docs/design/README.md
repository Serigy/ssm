# Design no SSM

A fonte da verdade é o **Design System da Serigy**, em
`/home/edgar/Projects/SERIGY/design`. Este documento cobre apenas como o SSM o
aplica; as regras em si estão no `readme.md` de lá e não são repetidas aqui.

## Como o sistema chega ao código

```
design/tokens/*.css   ──cópia literal──>   libs/ui-kit/src/tokens/*.css
design/components/    ──porte──────────>   libs/ui-kit/src/components/*.tsx
design/ui_kits/painel ──promoção────────>  Metric, Panel, Table
```

Os tokens são **cópia literal**. Nunca edite um valor em `libs/ui-kit/src/tokens/`;
quando o design system mudar, copie os arquivos de novo. Editar à mão é como as
duas coisas divergem em silêncio.

## O que mudou no porte, e por quê

Os componentes do design system são protótipos: rastreiam hover, press e focus
em estado React e re-renderizam a cada evento de ponteiro. A versão de produção
usa classes CSS.

Não é preferência de estilo. São duas capacidades concretas:

1. **`:focus-visible`.** O protótipo não consegue expressar "anel de foco para
   quem usa teclado, não para quem usa mouse" — em React só existe `onFocus`.
2. **Nenhum re-render.** `:hover` em CSS é trabalho do navegador. Em uma tabela
   com 200 linhas, o protótipo re-renderizaria a cada movimento do mouse.

O contrato visual é idêntico: mesmos tokens, mesmas cores, mesmos tempos, mesmos
raios.

## Adições declaradas

O sistema pede que qualquer desvio seja explícito. Estes são os do SSM:

| Adição | Por quê |
|---|---|
| `Button` variante `danger` | O SSM cancela faturas e registra desligamentos. Não havia variante para ação irreversível. Todos os tons derivam de `--state-danger`. |
| `--state-danger-hover` e `--state-danger-active` | O sistema traz `--state-danger` mas nenhum passo mais escuro. Derivados com `color-mix` a partir dele, para que sigam a cor de estado se ela mudar. Ver a nota sobre o coral abaixo. |
| `Metric`, `Panel`, `Table` promovidos ao ui-kit | O próprio `ui_kits/painel/README.md` previa: "Se o painel virar produto, promova-os a `components/data/`". O SSM é esse produto. |
| `EmptyState`, `LoadingBar`, `Skeleton` | Toda tela precisa de estado vazio, de carregamento e de erro. A barra de 2px é a única animação em laço que o sistema permite. |
| `AppShell` no ui-kit, não no shell | Para que um remote rodando isolado mostre a mesma moldura. Um módulo desenvolvido sozinho que não se parece com o produto montado é um problema encontrado tarde. |
| `@media (prefers-reduced-motion)` | O sistema define durações mas não trata a preferência do sistema operacional. Qualquer coisa que anime precisa respeitá-la. |
| Cor de foco de erro | `--shadow-focus` é verde; em um campo inválido o anel verde contradiz a borda vermelha. Usamos a mesma opacidade com o vermelho de estado. |

## Regras que valem em toda tela do SSM

**Três estados, sempre.** Vazio, carregando, erro. Uma tela sem os três não está
pronta — o agente `qa` trata isso como defeito, não como sugestão.

**O coral não entra no produto.** É a regra do sistema, literalmente: *"usado só
em contextos de marketing — um CTA por página, números de destaque, um badge de
campanha. Nunca em UI de produto."*

O SSM é UI de produto do começo ao fim, então nenhuma tela usa coral. Os tokens
estão presentes — cópia literal, como todo o resto — mas ficam sem uso. Isso é
deliberado, não esquecimento: o ui-kit pode um dia servir uma superfície de
marketing, e aí `Badge tone="accent"` é o único lugar por onde o coral entra.

Isso já foi violado uma vez e vale registrar como se descobre: o hover do botão
destrutivo usava `--coral-700`, porque o sistema não traz um passo mais escuro
de `--state-danger` e o coral era o vermelho-alaranjado mais próximo à mão.

Visualmente passava. Estruturalmente não: coral é cor **de marca** e
`--state-danger` é cor **semântica**. Acoplá-las significa que uma decisão de
marketing sobre a paleta coral mudaria, em silêncio, a aparência de "Cancelar
fatura". As duas precisam poder mudar sozinhas. A correção foi derivar os tons
escuros do próprio `--state-danger` com `color-mix`.

A pergunta a se fazer diante de qualquer cor nova: *isto é marca ou é
significado?* Se for significado, tem que vir de `--state-*` ou dos neutros.

**Números em mono e tabulares.** Valores, quantidades e identificadores usam
`.ssm-num`: `font-family: var(--font-mono)` com `font-variant-numeric:
tabular-nums`, alinhados à direita. Em uma coluna de dinheiro, alinhamento é
legibilidade, não decoração.

**Sem emoji.** Em nenhuma superfície — tela, e-mail transacional, mensagem de
erro, log voltado ao usuário. É regra do sistema, sem exceção.

**Copy de erro diz o próximo passo.** "Não foi possível conectar ao ambiente.
Verifique a chave de acesso e tente novamente." Nunca culpa o usuário, nunca faz
piada.

**Sem logotipo.** A marca é a palavra `SERIGY` em Archivo 800, caixa alta,
`--tracking-wide`. Quando houver um SVG, ele entra em `libs/ui-kit/src/assets/`.

**Ícones não estão embutidos.** O design system prescreve Lucide mas não entrega
os arquivos. O ui-kit atual usa rótulo em texto onde entraria um glifo. Ao
adicionar Lucide: 1.5–2px de traço, `currentColor`, 16px inline, 20px em botão,
24px em cabeçalho, nunca colorido, nunca com fundo circular.

## Antes de criar um componente

1. Dá para compor com o que já existe? Quase sempre dá.
2. Vai ser usado em mais de um módulo? Se não, mora no módulo.
3. Duas a três variantes, dois a três tamanhos. O sistema pede "poucas
   variações"; a quarta variante é onde a erosão começa.

Consulte o agente `design` (`.claude/agents/design.md`) — ele carrega essas
regras e as do design system.
