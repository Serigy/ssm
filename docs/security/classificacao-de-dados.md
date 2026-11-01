# Classificação de dados

Quatro níveis. O nível determina o tratamento — não é rótulo decorativo.

| Nível | Definição | Exemplos no SSM |
|---|---|---|
| **Público** | Divulgável sem restrição | Nome do produto, versão da API |
| **Interno** | Visível a qualquer usuário autenticado do tenant | Nome de departamento, título de contrato, número de fatura |
| **Confidencial** | Restrito por permissão | Valores de fatura, cláusulas contratuais, cargo e gestor |
| **Restrito** | Dado pessoal ou de alto impacto legal | CPF, data de nascimento, salário, endereço, dados bancários |

## Onde está o dado Restrito

| Campo | Onde | Proteção |
|---|---|---|
| `employees.national_id_enc` | hr-svc / Postgres | **Cifrado com pgcrypto**, chave em `/run/secrets/pii_encryption_key`; decifrado dentro do banco, nunca no Node |
| `employees.salary_minor` | hr-svc / Postgres | Omitido da projeção sem `hr:payroll:read` |
| `employees.date_of_birth` | hr-svc / Postgres | Idem |
| `employees.personal_email`, `phone`, `address` | hr-svc / Postgres | Idem |
| `users.password_hash` | identity-worker / D1 | Argon2id, 19 MiB, 2 passes, p=1 |
| `refresh_tokens.token_hash` | identity-svc / Postgres | SHA-256 do token; o token nunca é armazenado |
| PDFs de contrato e fatura | R2 | Bucket privado; acesso só por URL assinada de 2 a 5 minutos |

## As regras de tratamento

**Omissão, não anulação.** Um chamador sem `hr:payroll:read` recebe uma resposta
em que os campos sensíveis estão **ausentes**, não `null`. A diferença importa: um
`null` é indistinguível de "esse colaborador não tem salário cadastrado", e um
cliente que não sabe a diferença mostra "—" onde deveria mostrar "sem permissão".
É `employeeSafeSchema` em `libs/contracts` que expressa isso.

**Redação em log.** O logger corta por dois caminhos: uma lista de nomes de campo
(`*.salary`, `*.nationalId`, `*.password`, `authorization`, `cookie`…) e uma
varredura de valor — o `SecretsService` lembra todo valor que já entregou e o
`SsmLogger` substitui qualquer ocorrência dele. Cinto e suspensório, porque uma
credencial em um agregador de log é permanente na prática.

**Decifragem no banco.** O CPF é decifrado com `pgp_sym_decrypt` dentro da
consulta. A chave nunca viaja até o Node e o texto claro nunca fica em uma
variável que possa cair em um dump de heap.

**Sem PII em URL.** Nunca em query string: URLs vão para log de acesso, histórico
do navegador e cabeçalho `Referer`.

**Sem PII em evento.** `hr.employee.offboarded` carrega `employeeId`, `lastDay` e
`reason` — não carrega nome, CPF nem salário. Um evento é lido por serviços que
não têm permissão para ver esses campos, e fica retido no broker e na DLQ.

## Retenção

| Dado | Prazo | Base |
|---|---|---|
| Fatura emitida | 10 anos | Prazo fiscal |
| Contrato assinado | 10 anos após o fim da vigência | Prazo prescricional |
| Cadastro de colaborador | 30 anos após o desligamento | Legislação trabalhista |
| PII de candidato não contratado | 6 meses | LGPD — finalidade encerrada |
| Log de aplicação | 90 dias | Operacional |
| Refresh token expirado | 30 dias | Investigação de incidente |

O ciclo de vida do bucket R2 é configurado no Terraform
(`document_retention_days`). **Confirme o número com o jurídico antes de
reduzi-lo** — é uma decisão legal, não de infraestrutura.

## LGPD

- **Titularidade.** O colaborador é titular dos dados em `employees`.
- **Acesso.** Atendido por `GET /api/hr/v1/employees/:id` com permissão adequada.
- **Correção.** `PUT` no mesmo recurso.
- **Eliminação.** Colide com a retenção trabalhista. A resposta é anonimização
  ao fim do prazo, não exclusão: os campos Restritos são zerados e o registro
  contábil permanece.
- **Portabilidade.** Ainda não implementada. Está na dívida.
