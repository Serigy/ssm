# 0010 — Redis como coordenação, não como cache de leitura; sem Elasticsearch e sem IndexedDB

- **Estado:** Aceita (Redis implantado; `pg_trgm` pendente)
- **Data:** 2026-08-18

## Contexto

Levantou-se a questão de trazer cache para o SSM, com duas combinações
sugeridas: Redis + Elasticsearch, ou Redis + IndexedDB.

As duas combinações partem de uma premissa que não se sustenta: que esses três
componentes são alternativas entre si. Não são. Redis é estado compartilhado
entre réplicas, Elasticsearch é um motor de busca, IndexedDB é persistência no
disco do usuário. Escolher "um par" mistura três decisões independentes.

Então a pergunta útil não é qual par adotar, e sim: **que problema medido existe
hoje?**

### O que foi verificado no código, não suposto

**Nada no SSM está lento.** Não há medição de latência, não há endpoint
reclamando, e o volume é de dezenas de registros. Adicionar Elasticsearch a um
sistema sem problema de desempenho medido é o erro clássico: paga-se um cluster,
um pipeline de sincronização e uma segunda cópia de dado sensível para resolver
algo que ninguém observou.

Mas a verificação encontrou **três problemas reais** — e nenhum deles é de
desempenho:

1. **O rate limit conta por réplica.** `ThrottlerModule.forRoot` sem `storage`
   usa memória do processo, e `values.yaml` declara `replicas: 3` para o
   gateway. O limite efetivo é 3× o configurado, e qual pod atende cada
   requisição é indeterminado. O controle documentado em
   `docs/security/modelo-de-ameacas.md` não faz o que diz fazer.

2. **`Idempotency-Key` é anunciado e não implementado.** O cabeçalho está na
   lista de `allowedHeaders` do CORS desde o início; nenhum código o lê. Um
   cliente que reenvie `POST /invoices/:id/payments` após um timeout registra o
   pagamento duas vezes. Em um módulo financeiro isso não é um detalhe.

3. **A busca faz varredura sequencial.** Financeiro e Pessoas usam
   `ILIKE '%termo%'`. O curinga à esquerda impede o uso de qualquer índice
   B-tree, então cada tecla digitada (a cada 300ms de debounce) é um seq scan.
   Hoje sobre 3 linhas; o comportamento não muda de forma, só de custo.

Também está registrado em `docs/security/README.md` que não há denylist de
token, então uma mudança de papel leva até 15 minutos para valer.

## Decisão

### Adotar Redis — para coordenação, explicitamente **não** para cache de leitura

Redis entra por três razões de **correção**, nenhuma de velocidade:

| Uso | Por que precisa de estado compartilhado |
|---|---|
| Contadores de rate limit | 3 réplicas de gateway precisam de um contador só |
| Chaves de idempotência | O retry pode chegar em outro pod que não viu o original |
| Denylist de token (`jti`) | A revogação precisa valer em todos os serviços, já |

O que essas três coisas têm em comum, e que as separa de "cachear a listagem de
faturas": **elas nascem no Redis e não têm fonte da verdade em outro lugar.** Um
contador de rate limit não é cópia de nada. Uma chave de idempotência não é
cópia de nada. Perdê-las num restart degrada o sistema por alguns segundos e
nada mais.

Cachear o resultado de `GET /invoices` é o oposto: duplica uma verdade que vive
no Postgres e cria o problema de invalidação — que, num sistema onde três
serviços publicam eventos que afetam os dados uns dos outros, é uma nova
superfície de bug em troca de um ganho que ninguém mediu.

**Regra:** um dado só entra no Redis se o Redis for a fonte da verdade dele.
Cachear leitura de domínio é uma decisão separada, a ser tomada com uma medição
na mão.

### Não adotar Elasticsearch

O problema real de busca é o curinga à esquerda, e o Postgres resolve isso
sozinho:

```sql
CREATE EXTENSION pg_trgm;
CREATE INDEX invoices_search_idx ON invoices
  USING gin ((number || ' ' || counterparty_name) gin_trgm_ops);
```

Isso torna `ILIKE '%termo%'` indexado, aceita erro de digitação por similaridade,
e custa uma migração. O Jurídico já usa o índice de texto ponderado do MongoDB,
que serve bem um corpus jurídico onde a busca é por termo inteiro.

O que pesa contra o Elasticsearch aqui não é principalmente o custo operacional
— é que **ele é uma segunda cópia dos dados**. O SSM guarda CPF cifrado, salário
e cláusula contratual confidencial. Uma segunda cópia significa um segundo lugar
para garantir isolamento entre clientes, um segundo backup para proteger, e um
segundo sistema onde um erro de mapeamento vaza o campo que a projeção por
permissão do hr-svc existe para esconder. Ver
`docs/security/classificacao-de-dados.md`.

E o pipeline de sincronização vira mais uma superfície de consistência eventual
em um sistema que já tem uma.

### Não adotar IndexedDB

Esta é a mais direta das três: **IndexedDB contradiz o modelo de ameaças do
projeto.**

O access token fica só em memória, deliberadamente, para que um XSS não consiga
lê-lo — está em `docs/adr/0005` e no modelo de ameaças. Persistir no disco do
usuário a listagem de faturas, os salários e as cláusulas contratuais entrega ao
mesmo atacante exatamente o que a decisão do token protege. Pior: sobrevive ao
logout, a menos que alguém lembre de limpar, em toda saída, inclusive nas que
não passam pelo botão "Sair".

E o benefício não se aplica: o SSM é sistema interno, em máquina gerenciada, com
rede confiável. Ninguém pediu operação offline.

Para a sensação de rapidez, que é o ganho real que se buscava, o caminho barato
é HTTP: `ETag` + `Cache-Control` nas listagens e um cache em memória no
`useQuery`. Some ao voltar de uma tela, não sobrevive ao reload — que é
exatamente o comportamento que se quer para dado sensível.

## Consequências

**Bom.** Três controles passam a funcionar como documentado. Nenhum datastore
novo com dado sensível. A busca fica indexada com uma migração. O front ganha
navegação instantânea sem escrever nada em disco.

**Ruim, e é preciso assumir:**

- **Mais um componente com estado para operar.** Redis precisa de HA em
  produção, senão vira ponto único de falha para o rate limit. Mitigação: os
  três usos degradam com segurança — se o Redis cair, o rate limit passa a
  contar por pod (o comportamento de hoje), a idempotência deixa de deduplicar e
  a denylist deixa de revogar antes do TTL. Nenhum deles derruba o sistema, e
  todos falham *abertos*, com alarme.

  Isso obrigou uma correção que só apareceu ao testar: a sonda de readiness
  precisou distinguir dependência **crítica** de **degradada**. Na primeira
  versão, o Redis fora do ar fazia `/health/ready` devolver 503 — e como todas
  as réplicas compartilham o mesmo Redis, o Kubernetes tiraria *todas* do
  Service ao mesmo tempo. A implementação falhava aberta na aplicação e fechada
  na infraestrutura, o que anula o desenho inteiro. RabbitMQ e Redis são agora
  não-críticos: respondem 200 com `status: degraded` e nomeiam o que caiu. Só o
  banco primário derruba a readiness.
- **A denylist coloca uma consulta ao Redis no caminho quente**, o que contraria
  a decisão de autorização offline do ADR 0002. Por isso ela é consultada apenas
  em operações críticas — emitir, cancelar, desligar, ativar contrato — e não em
  toda leitura.
- **`pg_trgm` não resolve tudo.** Não faz ranking de relevância nem busca
  unificada entre os três módulos. Quando isso for pedido, a decisão volta à mesa.

## O que a implantação exigiu além do previsto

Duas coisas só apareceram ao rodar:

**A readiness precisou distinguir crítico de degradado.** Está descrito acima.

**O cliente precisou passar a enviar a chave.** Marcar os endpoints com
`@Idempotent()` tornou `Idempotency-Key` obrigatório neles, e o `ApiClient` não
mandava nenhum — "Emitir fatura" passou a responder 400. Uma exigência no
servidor que o cliente não cumpre é a mesma classe de defeito de um botão ligado
a uma rota inexistente: só aparece no navegador.

O cliente agora envia em toda requisição que muda estado, com uma distinção que
importa:

- **Chave derivada** (`issue:<id>`, `activate:<id>`) nas operações que acontecem
  uma vez por recurso. Clicar duas vezes repete a primeira resposta em vez de
  bater no 409 da máquina de estados — que é o que "já foi feito" deveria
  parecer para quem está olhando a tela.
- **Chave aleatória por chamada** no resto, incluindo pagamentos. Dois
  pagamentos na mesma fatura são duas operações legítimas, e uma chave derivada
  engoliria o segundo em silêncio. A chave por chamada ainda protege contra a
  mesma requisição HTTP ser entregue duas vezes por um proxy.

## Quando revisitar

Esta decisão tem prazo de validade. Reabra quando:

- **Elasticsearch:** aparecer a busca unificada ("procure em faturas, pessoas e
  contratos ao mesmo tempo"), ou uma listagem passar de ~1M de linhas por
  cliente, ou o produto pedir ranking por relevância. Mesmo então, avalie antes
  um read model dedicado em Postgres — ele não duplica o dado para fora do
  perímetro.
- **IndexedDB:** existir requisito real de operação offline. Se isso acontecer,
  a conversa começa por criptografia em repouso e limpeza no logout, não pela
  biblioteca.
- **Redis como cache de leitura:** houver uma medição mostrando um endpoint
  específico como gargalo. Com o número na mão, e um plano de invalidação escrito.

## Alternativas consideradas

**Redis + Elasticsearch** — rejeitado por resolver com um cluster novo um
problema que uma migração resolve, e por criar uma segunda cópia de dado
Restrito. O custo é de segurança, não só de operação.

**Redis + IndexedDB** — rejeitado porque IndexedDB anula a proteção que o desenho
do token estabelece. Persistir dado sensível no cliente é a decisão que mais
custa reverter, porque o dado já está espalhado quando alguém percebe.

**Não adotar nada agora** — foi a alternativa mais séria, e quase venceu.
Rejeitada porque os três usos do Redis não são otimização: são controles que a
documentação afirma existir e que hoje não funcionam com mais de uma réplica.
Adiar é manter o modelo de ameaças descrevendo um sistema que não é este.

**Cache em memória no processo, sem Redis** — resolveria a idempotência dentro
de um pod. Rejeitado pelo mesmo motivo que quebra o rate limit hoje: com três
réplicas, o retry chega no pod errado.
