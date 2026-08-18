# 0011 — Passport na fronteira de login, e não no acesso a recurso

- **Estado:** Proposta
- **Data:** 2026-08-18

## Contexto

A autenticação do SSM é própria: JWT RS256 assinado pelo `identity-svc`,
verificado offline pelos demais serviços, com senha em Argon2id, rotação de
refresh com detecção de reuso e denylist no Redis. Funciona, está testada e é o
que os ADRs [0002](0002-microsservicos-por-modulo.md) e
[0010](0010-cache-e-busca.md) assumem.

Levantou-se a adoção do Passport, com o argumento de que ele tem integração de
primeira linha via `@nestjs/passport`. O argumento é verdadeiro, e por si só não
decide nada: integração boa é razão para *como* adotar, não para *se* adotar.

A pergunta que decide é outra: **o que o Passport faz que o código atual não
faz?**

### O que ele não traz

Para o que existe hoje, quase nada.

`passport-jwt` extrai o token do cabeçalho e valida assinatura e expiração. O
`JwtAuthGuard` já faz isso em cerca de sessenta linhas — e faz mais quatro
coisas que o `passport-jwt` não faz e que precisariam ser reescritas dentro de
uma estratégia customizada de qualquer forma:

1. consulta a denylist do Redis, seletivamente, conforme o método e o decorator
   `@CheckRevocation()`;
2. extrai o `tenantId` do token para o `@TenantId()`;
3. informa o ator ao Zen, para que o bloqueio seja por usuário e não por IP;
4. popula o contexto de correlação com o ator.

Ou seja: trocar por Passport não apagaria código, moveria-o para dentro de uma
`PassportStrategy`. E traria uma segunda biblioteca de JWT — `passport-jwt` usa
`jsonwebtoken`, enquanto o projeto usa `jose`. Duas bibliotecas fazendo
verificação criptográfica no mesmo processo é superfície duplicada para auditar
e para atualizar quando sair um CVE.

`passport-local` traria menos ainda. Ele é um invólucro sobre "chame esta função
de verificação" — e a função de verificação é o `AuthService.login`, que já
existe, com bloqueio após tentativas e com o hash calculado mesmo para e-mail
inexistente, para não vazar quais endereços estão cadastrados por diferença de
tempo.

### O que ele traz, e que muda a decisão

O valor do Passport não está nas duas estratégias que replicariam o que temos.
Está nas outras: **OIDC, SAML e LDAP.**

Isso deixou de ser hipotético. O SSM é vendido para empresas, e a base de
demonstração já tem uma prefeitura. Setor público e empresas de médio porte
exigem entrada por Entra ID, Google Workspace ou um provedor SAML próprio — e
`docs/security/README.md` registra SSO como ausente.

Escrever OIDC à mão é uma má ideia com nome: `state` contra CSRF, `nonce` contra
replay, PKCE, validação de `iss`/`aud`/`azp`, descoberta e rotação de JWKS,
tratamento de `id_token` versus `access_token`. Cada um desses é uma falha de
segurança conhecida quando feito errado, e nenhum deles é interessante de
implementar. SAML é pior: canonicalização de XML e verificação de assinatura,
onde os erros históricos são de contornar a assinatura inteira.

Essa é uma classe de trabalho em que escrever o próprio é negligência, não
independência.

## Decisão

Adotar `@nestjs/passport` **exclusivamente na fronteira de login do
`identity-svc`**, e apenas para os protocolos federados que não devemos
implementar: OIDC e SAML, e LDAP se aparecer.

Não adotar Passport para:

- **acesso a recurso.** O `JwtAuthGuard` global continua como está. É onde passa
  cada requisição do sistema, já carrega quatro responsabilidades que o
  `passport-jwt` não tem, e trocá-lo introduziria uma segunda biblioteca de JWT
  sem apagar código.
- **login local por senha.** O `AuthService.login` fica. `passport-local` é
  indireção sobre uma verificação de vinte linhas que já trata bloqueio e
  tempo constante. Foi a parte mais discutível desta decisão: fazer tudo passar
  pelo mesmo pipeline tem valor de consistência. Pesou mais não mexer em um
  caminho de autenticação testado para ganhar uniformidade.

### A fronteira, explicitamente

```
Entra ID / Google / SAML  ──(passport)──▶  identity-svc  ──▶  JWT RS256 do SSM
                                                                    │
                                          verificação offline ◀─────┤
                                          nos 4 demais serviços     │
```

O Passport termina no momento em que o `identity-svc` decide quem é a pessoa.
A partir daí o sistema emite **o mesmo token RS256 de sempre** e nada a jusante
muda: verificação offline, permissões dentro do token, denylist no Redis,
`@TenantId()`, tudo idêntico.

Isso é o ponto principal da decisão. O provedor externo autentica; ele **não**
autoriza e não passa a ser dependência de caminho quente. Se o Entra ID cair,
ninguém entra — e todo mundo que já está dentro continua trabalhando até o
refresh.

## Consequências

**Bom.** SSO vira uma estratégia por provedor em vez de um projeto. O mapeamento
de identidade externa para usuário do SSM fica em um lugar só. O resto do
sistema não sabe que o Passport existe, então esta decisão pode ser revertida
sem tocar em nenhum dos outros quatro serviços.

**Ruim, e é preciso assumir:**

- **Duas formas de entrar.** Login local e SSO coexistem, e coexistência é onde
  moram os bugs: um usuário com senha *e* com identidade federada, um e-mail que
  muda no provedor, um usuário desprovisionado lá que continua ativo aqui. Cada
  um precisa de regra escrita antes do primeiro cliente com SSO.
- **O Passport é legado por dentro.** A API é de callback (`done(err, user)`), e
  o `@nestjs/passport` embrulha isso sem esconder as costuras. Aceitável em um
  ponto do sistema; seria irritante em todos.
- **Confiança no provedor.** Quem controla o IdP controla quem entra. O
  provisionamento de papéis fica no SSM, deliberadamente: o IdP diz *quem é a
  pessoa*, nunca *o que ela pode fazer*.
- **Vínculo de conta é uma decisão de segurança, não de UX.** Casar identidade
  federada com usuário existente por e-mail só é seguro se o provedor garantir
  o e-mail verificado. Se não garantir, o vínculo tem que ser explícito, feito
  por um administrador. Isso precisa estar decidido antes de escrever a
  estratégia, não depois.

## Alternativas consideradas

**Adotar Passport em toda a autenticação**, substituindo o `JwtAuthGuard` e o
login local. Rejeitado por trocar código testado por código equivalente, trazer
uma segunda biblioteca de JWT e forçar a reescrita da denylist, do tenant e da
marcação do Zen dentro de uma estratégia — mesma quantidade de código, mais
dependências, nenhum recurso novo.

**Não adotar Passport e implementar OIDC à mão** quando SSO for pedido.
Rejeitado sem hesitação: são os erros mais caros e mais conhecidos de
segurança web, e não há nada de específico do SSM neles.

**Terceirizar identidade inteira** para Keycloak, Auth0 ou Entra External ID.
É a alternativa séria — resolve SSO, MFA e provisionamento de uma vez, e apagaria
o `identity-svc`. Rejeitada por três motivos: destrói a verificação offline que
o [ADR 0002](0002-microsservicos-por-modulo.md) estabelece, colocando um
terceiro no caminho de cada login; move dado de identidade de cliente para fora
do perímetro, o que interage mal com a
[classificação de dados](../security/classificacao-de-dados.md); e transforma
uma decisão reversível em uma migração. Vale reabrir se o SSM passar a precisar
de MFA, provisionamento SCIM e diretório — aí o próprio já não se paga.

**`openid-client` direto, sem Passport.** É uma boa biblioteca e evita a API de
callback. Rejeitada por margem estreita: resolve OIDC, mas não SAML nem LDAP, e
teríamos duas integrações com formatos diferentes. Se SAML nunca for pedido,
esta decisão merece ser revisitada.

## Quando revisitar

- Se **SSO nunca for pedido** por nenhum cliente em um ano: esta decisão não foi
  executada e deve ser fechada como obsoleta, não ficar de pé indefinidamente.
- Se surgir necessidade de **MFA e provisionamento SCIM** junto com SSO: a
  conversa passa a ser sobre terceirizar identidade inteira, não sobre qual
  biblioteca usar.
