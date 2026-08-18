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
make web     # sobe shell + 3 remotes com hot reload
```

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
| 15672 | RabbitMQ (gestão) |
| 9001 | MinIO (console) |

Postgres e Mongo saem em portas não-padrão de propósito: quase toda máquina de
desenvolvimento já tem um dos dois rodando, e a colisão custa meia hora de
confusão.

## O laço de trabalho

**Front-end.** `make web` roda os quatro apps com HMR. Os serviços ficam nos
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
O remote não está no ar. Confira que `make web` subiu os quatro e que a porta do
módulo responde. O painel dos outros módulos continua funcionando — é o error
boundary fazendo o trabalho dele.

**Erro 401 em tudo, logo após entrar.** O relógio da máquina está fora de
sincronia, ou o par de chaves foi regenerado enquanto havia sessão aberta.
`make secrets --force` invalida todo token já emitido.

**`ECONNREFUSED` no RabbitMQ.** Ele demora mais que os outros a ficar pronto. Os
serviços reconectam sozinhos a cada 5 segundos; espere meio minuto antes de
investigar.

## Recomeçar do zero

```bash
make nuke        # apaga os volumes — pede confirmação
make dev && make seed
```
