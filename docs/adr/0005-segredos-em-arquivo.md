# 0005 — Segredos em arquivo, não em `.env`

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

O padrão do ecossistema Node é um `.env` na raiz, carregado por `dotenv` em
variáveis de ambiente. É conveniente e é o que quase todo tutorial ensina.

Também tem quatro problemas concretos, e nenhum deles é teórico:

1. **Um arquivo, todos os segredos.** Um `git add -A` distraído vaza tudo de uma
   vez. Um `cat .env` em uma sessão compartilhada, idem.
2. **Variáveis de ambiente não são privadas.** Ficam em `docker inspect`, em
   `/proc/<pid>/environ`, em dumps de crash, em relatórios de erro que capturam o
   ambiente, e em qualquer log que despeje `process.env`.
3. **O caminho de produção é outro.** No Kubernetes, o padrão é montar um Secret
   como volume. Se o desenvolvimento usa `.env` e a produção usa arquivo, existem
   dois caminhos de código, e o de produção é o menos exercitado.
4. **Rotacionar exige reiniciar.** Uma variável de ambiente é fixada no `exec()`
   do processo.

## Decisão

Um segredo é **um arquivo cujo conteúdo inteiro é o valor**, nomeado em
`lower_snake_case`, dentro de um diretório apontado por `SSM_SECRETS_DIR`
(padrão `/run/secrets`).

```
secrets/local/postgres_password       →  desenvolvimento
/run/secrets/postgres_password        →  contêiner (tmpfs) e Kubernetes (volume)
```

O ponto que decide a questão: `secrets/local/` e um Secret do Kubernetes montado
em `/run/secrets` são **a mesma interface, byte a byte**. A aplicação lê
`${SSM_SECRETS_DIR}/postgres_password` nos dois casos e não sabe onde está. Não
existe caminho de código só-de-desenvolvimento para errar.

`SecretsService` resolve nesta ordem:

1. `SSM_SECRET_<NOME>` — escotilha para CI, deliberadamente feia de usar;
2. `<NOME>_FILE` — convenção do Docker Swarm;
3. `${SSM_SECRETS_DIR}/<nome>` — o caminho normal.

## Consequências

**Bom.** `secrets/*` é ignorado pelo git duas vezes (raiz e `secrets/.gitignore`),
e o CI falha se algo ali for rastreado. Cada serviço recebe só os segredos que
usa — o `hr-svc` nunca vê a chave privada de JWT; só o `identity-svc` vê. Cache
com TTL curto no `SecretsService` faz uma rotação valer sem reinício. O raio de
um vazamento é um segredo, não todos.

**Ruim:**

- **Mais arquivos.** Dez segredos são dez arquivos, não dez linhas. Mitigado por
  `make secrets`, que os gera com valores aleatórios e um par de chaves RS256.
- **Mais cerimônia em ferramentas de terceiros.** Postgres e RabbitMQ precisam
  das variantes `*_FILE` no compose. Todas as imagens sérias as suportam.
- **É diferente do que a maioria espera.** Daí `secrets/README.md` explicar o
  porquê logo na primeira tela, e não apenas o como.

## Alternativas consideradas

**`.env` com `dotenv`** — rejeitado pelos quatro motivos acima.

**Segredos criptografados no repositório (SOPS + age)** — versionados junto ao
código, auditáveis por diff. Ainda é uma boa ideia para configuração sensível não
crítica e pode ser adotado depois; foi deixado de fora agora porque exige que
toda máquina de desenvolvimento tenha uma chave provisionada, o que é atrito na
primeira hora de um projeto novo. O formato de arquivo aqui é compatível: SOPS
pode passar a produzir `secrets/local/`.

**Vault direto da aplicação** — é o destino em produção, via External Secrets
Operator, que sincroniza para um Secret do Kubernetes. Rejeitado como acoplamento
direto porque tornaria o Vault uma dependência de boot de todo serviço, inclusive
em desenvolvimento.
