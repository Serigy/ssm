# Modelo de ameaças

Escopo: a aplicação SSM e sua infraestrutura. Fora de escopo: segurança física
do datacenter, comprometimento do provedor de nuvem, e coação de um operador com
acesso legítimo de produção.

## O que se protege, em ordem

1. **Isolamento entre tenants.** É a falha de maior severidade possível aqui.
   Um cliente ver a folha de pagamento de outro é um incidente do qual não se
   volta comercialmente.
2. **Dado pessoal de colaborador.** CPF, salário, endereço. Impacto legal (LGPD)
   e humano.
3. **Integridade do registro financeiro.** Uma fatura alterada ou uma sequência
   numérica com buraco é um achado de auditoria.
4. **Confidencialidade contratual.** Cláusulas e valores negociados.
5. **Disponibilidade.** Importante, e deliberadamente o último — um sistema fora
   do ar por uma hora custa menos que um vazamento.

## Atacantes considerados

| Quem | Capacidade | O que quer |
|---|---|---|
| Anônimo na internet | Varredura automatizada, exploits públicos | Qualquer coisa; alvo de oportunidade |
| Usuário autenticado de outro tenant | Credencial válida, conhece a API | Dados do tenant vizinho |
| Usuário autenticado com poucos privilégios | Credencial válida, conhece a interface | Salários, cláusulas — escalar privilégio |
| Ex-funcionário | Conhecimento do sistema, credencial possivelmente ainda válida | Dados, ou sabotagem |
| Comprometimento de dependência | Executa código no processo do serviço | Segredos, exfiltração |

## Ameaças e controles

### Isolamento entre tenants

**Como quebraria:** uma consulta sem `tenantId` no predicado; ou `tenantId`
vindo de um cabeçalho que o cliente controla; ou uma chave de objeto no R2 fora
do prefixo do tenant.

**Controles:**
- `@TenantId()` extrai do JWT verificado — não existe caminho que leia de header
  ou query;
- o gateway **apaga** `x-tenant-id`, `x-actor-id` e `x-user-id` de toda
  requisição encaminhada, então forjá-los não adianta;
- `ObjectStorageService.buildKey()` prefixa com o tenant, e `attachDocument()`
  recusa uma chave fora do prefixo;
- o mesmo 404 para "não existe" e "é de outro tenant" — um 403 confirmaria que o
  id é real.

**Residual:** uma consulta nova escrita sem o predicado. Mitigado por revisão e
pelo agente `security-audit`, que verifica cada `findOne`/`createQueryBuilder`.
Um teste automatizado de isolamento por endpoint fecharia isso melhor — está na
dívida.

### Escalada de privilégio

**Como quebraria:** rota sem `@RequirePermissions`; permissão fraca demais para
a operação; resposta contendo campo que o chamador não pode ver.

**Controles:**
- `JwtAuthGuard` é global — uma rota nova nasce protegida e precisa de
  `@Public()` explícito para não ser;
- permissões vêm do token assinado, não de consulta ao banco;
- força proporcional: emitir fatura exige `approve`, não `update`, porque atribui
  número de documento legal;
- projeção por permissão no HR (`employeeSafeSchema`).

**Residual:** mudança de papel leva até 15 minutos (TTL do access token) para
valer. Aceito conscientemente em troca de autorização offline. Revogação
imediata exigiria denylist — está na dívida.

### Injeção

**Controles:** consultas parametrizadas em toda parte; Zod validando toda
entrada; e o Zen instrumentando o driver para bloquear no ponto de execução o
que passar pelas duas primeiras. O ADR [0009](../adr/0009-aikido-zen.md) explica
por que um WAF de borda não substitui isso.

### Roubo de token

**Como quebraria:** XSS lendo o token; ou roubo do refresh token.

**Controles:**
- access token **só em memória** — nunca em `localStorage`, que qualquer XSS lê;
- refresh token em cookie `HttpOnly`, `SameSite=Strict`, `Secure`, com `path`
  restrito a `/api/identity/v1/auth` — inacessível a JavaScript por completo;
- rotação a cada uso, com **detecção de reuso**: apresentar um token já usado
  revoga a família inteira, porque ou o atacante ou o usuário legítimo está
  reproduzindo, e não há como distinguir;
- CSP restritiva e `helmet` em todos os serviços.

### Força bruta de credencial

**Controles:** Argon2id (19 MiB, 2 passes, p=1 — mínimo OWASP; ver workers/README.md
para a medição que levou a baixar de 64 MiB no Cloudflare) torna cada tentativa
cara; um limite de 20 tentativas por origem em 5 minutos vem antes do hash, para
que uma lista de senhas não vire conta de CPU; bloqueio
após 5 falhas por 15 minutos; rate limit no gateway; e o hash é calculado mesmo
quando o e-mail não existe, para que o tempo de resposta não revele quais
endereços estão cadastrados.

### Comprometimento de dependência

**Controles:** `pnpm audit` e a varredura de dependências da Aikido no CI e
semanalmente; Trivy nas imagens; contêiner não-root com raiz somente leitura e
todas as capabilities descartadas; NetworkPolicy limitando o egresso; e Zen
instrumentando `child_process` e o cliente HTTP, que é por onde um pacote
malicioso tipicamente exfiltra.

**Residual:** um pacote malicioso que rode no processo pode ler os segredos
montados. Mitigado por cada serviço receber só os seus — comprometer o financial-svc
não entrega a chave de PII nem a chave privada de JWT.

### Negação de serviço

**Controles:** rate limit em duas janelas; HPA; PDB; `statement_timeout` de 15s
no Postgres para que uma consulta travada não segure uma conexão; corpo limitado
a 2 MB no Ingress — documentos vão direto ao R2 e não passam pelos serviços.

**Aceito:** não há proteção volumétrica na aplicação. Isso é trabalho do
Cloudflare na frente do Ingress.

## Revisão

Este documento é revisto a cada trimestre e sempre que uma superfície nova
aparece: um endpoint público, uma integração externa, um tipo de dado novo.
