# Segurança

| Documento | O quê |
|---|---|
| [modelo-de-ameacas.md](modelo-de-ameacas.md) | Quem ataca o quê, e o que defende |
| [classificacao-de-dados.md](classificacao-de-dados.md) | Que dado é sensível e como é tratado |
| [gestao-de-segredos.md](gestao-de-segredos.md) | De onde vem cada segredo em cada ambiente |
| [ADR 0009](../adr/0009-aikido-zen.md) | Por que existe firewall em aplicação |

## As defesas, em uma tela

| Camada | O que faz |
|---|---|
| Ingress | TLS, cabeçalhos, limite de corpo |
| Gateway | rate limit, CORS, **remoção de cabeçalhos forjados de identidade** |
| Zen (Aikido) | firewall em aplicação, bloqueio por ator autenticado |
| `JwtAuthGuard` | verificação RS256 offline; global, opt-out por escrito |
| `PermissionsGuard` | `módulo:recurso:ação`, avaliado a partir do token |
| Camada de dados | `tenantId` como primeiro predicado; constraints CHECK |
| NetworkPolicy | serviços de módulo só aceitam tráfego do gateway |
| Contêiner | não-root, raiz somente leitura, todas as capabilities descartadas |
| Segredos | arquivos por serviço; só o identity-svc tem a chave privada |

## Dívida conhecida

Registrada aqui porque dívida de segurança não documentada é dívida esquecida.

| Item | Impacto | Plano |
|---|---|---|
| `JwtService` carrega uma única chave pública | Rotação do par de chaves exige janela de manutenção | Suportar duas chaves simultâneas |
| Sem denylist de token para revogação imediata | Uma mudança de papel leva até 15 min (TTL do access token) para valer | Denylist por `jti` no identity-svc, consultada só em operações críticas |
| Expurgo do `outbox` não implementado | A tabela cresce indefinidamente | CronJob de expurgo das linhas publicadas há mais de 30 dias |
| Job de recifragem de PII não escrito | Rotação da chave de PII não é executável | Escrever antes da primeira rotação programada |
| Sem trilha de auditoria dedicada | Quem leu o quê não é reconstruível além dos logs | Tabela de auditoria em append-only por serviço |

## Como reportar

Vulnerabilidade encontrada no código: abra um issue **privado** e marque a
equipe de plataforma. Não descreva o vetor em um issue público antes da correção.
