# Desenvolvimento local

## Primeira vez

```bash
make bootstrap
```

Isso faz três coisas: confere as ferramentas do host, gera `secrets/local/` e
instala as dependências. Se o preflight reclamar de `kind` ou `helm`, rode
`make install-tools` — eles vão para `~/.local/bin`, sem sudo.

Depois:

```bash
make dev     # sobe a infraestrutura e os cinco serviços em contêiner
make seed    # carrega os dados de demonstração
make web-docker   # sobe shell + 4 remotes com hot reload, contra o gateway
```

`make web` sobe os mesmos front-ends, mas o proxy do shell aponta para os
Workers (`8800`–`8805`, `pnpm cf:dev`). Com a pilha em contêiner, use
`make web-docker`, ou `make web-docker-start` para rodar em segundo plano.

Abra `http://localhost:4200` e entre com `admin@serigy.local` /
`serigy-desenvolvimento-2026`.

## Portas

| Porta | O quê |
|---|---|
| 4200 | shell |
| 4201 / 4202 / 4203 | mfe-financial / mfe-hr / mfe-legal |
| 3000 | gateway |
| 3001–3004 | identity / financial / hr / legal |
| 5433 | PostgreSQL |
| 27018 | MongoDB |
| 6380 | Redis |
| 15672 | RabbitMQ (gestão) |
| 9001 | MinIO (console) |

Postgres, Mongo e Redis saem em portas não-padrão de propósito: quase toda
máquina de desenvolvimento já tem um dos três rodando, e a colisão custa meia
hora de confusão.

## O laço de trabalho

**Front-end.** `make web-docker` roda os cinco apps com HMR. Os serviços ficam nos
contêineres; só as telas recarregam.

**Back-end.** Duas opções:

```bash
# a) rebuild do contêiner — mais fiel, mais lento
docker compose up -d --build financial-svc

# b) fora do contêiner, contra a infraestrutura do compose — mais rápido
docker compose stop financial-svc
SSM_SECRETS_DIR=./secrets/local \
POSTGRES_HOST=localhost POSTGRES_PORT=5433 POSTGRES_DB=ssm_financial \
RABBITMQ_HOST=localhost MONGO_HOST=localhost MONGO_PORT=27018 \
LOG_PRETTY=true PORT=3002 \
  pnpm nx serve financial-svc
```

A opção (b) é a que se usa no dia a dia. Note que os segredos apontam para o
mesmo `secrets/local/` — é o mesmo caminho de código do contêiner e do cluster.

**Um remote isolado.** `pnpm nx serve mfe-financial` sobe só o módulo, montado
num host de mentira, mas falando com o gateway real. Se os endpoints exigirem
token:

```bash
export VITE_DEV_TOKEN="$(make -s token)"
```

## Verificações antes de abrir um PR

```bash
make check       # lint + tipos + testes, tudo
make affected    # só o que você mexeu — bem mais rápido
make openapi     # se você mudou um endpoint; faça commit do diff
```

## Quando algo não sobe

**Um serviço reinicia em laço.** `make logs S=financial-svc`. As causas mais
comuns, em ordem: `secrets/local/` vazio (`make secrets`), migração não rodada
(`make migrate`), Postgres ainda subindo (`make ps` mostra o healthcheck).

**"Required secret X is missing".** O arquivo não existe ou está vazio. Os
placeholders de R2 e Aikido nascem vazios de propósito — se um serviço reclamar
deles, ele está tentando usar armazenamento e o MinIO não subiu.

**O shell carrega mas um módulo mostra "Não foi possível carregar este módulo".**
O remote não está no ar. Confira que `make web-docker` subiu os cinco e que a porta do
módulo responde. O painel dos outros módulos continua funcionando — é o error
boundary fazendo o trabalho dele.

**Erro 401 em tudo, logo após entrar.** O relógio da máquina está fora de
sincronia, ou o par de chaves foi regenerado enquanto havia sessão aberta.
`make secrets --force` invalida todo token já emitido.

**`ECONNREFUSED` no RabbitMQ.** Ele demora mais que os outros a ficar pronto. Os
serviços reconectam sozinhos a cada 5 segundos; espere meio minuto antes de
investigar.

## O formato do `dist` de um serviço

Não é `dist/main.js`. É:

```
apps/financial-svc/dist/
├── apps/financial-svc/src/main.js      <- o entrypoint
└── libs/{contracts,nest-common}/src/   <- as libs, compiladas junto
```

O motivo: cada serviço compila as bibliotecas compartilhadas a partir do
código-fonte, e o `tsc` enraíza a saída no ancestral comum dos arquivos de
entrada — que é a raiz do repositório, não a pasta do app.

Duas consequências que mordem se você não souber:

1. **O build tem dois passos.** `nest build` emite `require('@ssm/nest-common')`
   literalmente; os `paths` do tsconfig são resolução em tempo de compilação e
   não reescrevem o especificador emitido. Em execução isso resolveria para o
   *código-fonte* TypeScript da lib, que o Node não roda. Por isso o alvo de
   build é `nest build && tsc-alias`, que reescreve para caminhos relativos
   dentro de `dist/libs/`.

2. **As dependências da lib são dependências do serviço.** Como o arquivo
   compilado da lib mora sob o `dist` do serviço, `require('pino')` resolve a
   partir dali — ou seja, de `apps/<svc>/node_modules`. É por isso que `pino`,
   `amqplib`, `jose` e companhia estão declarados em cada serviço, e não só em
   `libs/nest-common`.

A imagem de contêiner gera dois atalhos, `dist/main.js` e `dist/data-source.js`,
para que o `CMD` e o Job de migração não precisem conhecer nada disso.

## Medir desempenho sem destruir os dados de demonstração

Um índice só se prova com volume: com três linhas o planejador escolhe varredura
sequencial e está certo. A tentação é gerar linhas na tabela existente e depois
apagá-las por algum padrão.

Não faça isso. Escrevendo este runbook, uma varredura de `UPDATE` para variar os
dados pegou também as três faturas semeadas, e a limpeza seguinte as apagou pelo
sufixo que o próprio `UPDATE` tinha acabado de adicionar. Dois testes de
navegador quebraram, e a causa não estava no código.

Use um **tenant sintético**. Todo dado é escopado por `tenant_id`, então a
limpeza vira uma condição que não tem como alcançar dado real:

```sql
-- gerar
INSERT INTO invoices (tenant_id, ...)
SELECT '11111111-1111-4111-8111-111111111111', ...
FROM generate_series(1, 60000) g;
ANALYZE invoices;

-- medir
EXPLAIN (ANALYZE, COSTS OFF) SELECT ... WHERE tenant_id = '11111111-...';

-- limpar, sem chance de pegar outra coisa
DELETE FROM invoices WHERE tenant_id = '11111111-1111-4111-8111-111111111111';
```

Se algo assim já tiver acontecido, `make seed` reconstrói tudo — ele é
idempotente e absorve colisão em qualquer constraint de unicidade.

## Recomeçar do zero

```bash
make nuke        # apaga os volumes — pede confirmação
make dev && make seed
```
