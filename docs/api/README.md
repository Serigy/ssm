# Especificações OpenAPI

Os arquivos `*.openapi.json` deste diretório são **gerados**, e versionados de
propósito: uma mudança de contrato aparece como diff no code review em vez de
ser descoberta por um cliente em produção.

```bash
make openapi        # regenera; faça commit do diff
make openapi-check  # falha se estiverem desatualizados (é o que o CI roda)
```

| Arquivo | Serviço | Prefixo |
|---|---|---|
| `identity.openapi.json` | identity-svc | `/api/identity/v1` |
| `financial.openapi.json` | financial-svc | `/api/financial/v1` |
| `hr.openapi.json` | hr-svc | `/api/hr/v1` |
| `legal.openapi.json` | legal-svc | `/api/legal/v1` |
| `gateway.openapi.json` | gateway | `/api/v1/status` |

Fora de produção, cada serviço também serve o Swagger UI em `/docs` — por
exemplo `http://localhost:3002/docs`. Em produção ele é desligado: é uma
superfície HTML não autenticada e não tem por que existir lá.

## Convenções que valem em todos os endpoints

**Autenticação.** `Authorization: Bearer <access token>` em tudo, exceto os
poucos endpoints marcados `@Public()` — login, refresh, logout e as sondas.

**Erros.** RFC 9457, `application/problem+json`:

```jsonc
{
  "type": "https://ssm.serigy.io/problems/validation-failed",
  "title": "Request validation failed",
  "status": 422,
  "detail": "2 field(s) rejected.",
  "instance": "/api/financial/v1/invoices",
  "traceId": "8f14e45f-ceea-467a-9b3e-2c1a4d5e6f70",
  "errors": { "lines.0.quantityMilli": ["Number must be greater than 0"] }
}
```

O `traceId` é o mesmo `X-Correlation-Id` da requisição, e é o que liga a resposta
à linha de log e ao span. Sempre cite-o ao reportar um problema.

Um 500 **nunca** traz a mensagem real — ela fica no log, sob o `traceId`.

**Paginação.** Por cursor (keyset), não por offset:

```
GET /api/financial/v1/invoices?limit=25
→ { "items": [...], "nextCursor": "MjAyNi0wOC0xN1QxNDozMjowMFp8YTAwMDAwMDA…" }

GET /api/financial/v1/invoices?limit=25&cursor=MjAyNi0wOC0xN1QxNDozMjowMFp8…
```

O cursor é **opaco**. Não construa nem interprete o valor: é a codificação da
chave de ordenação e o formato pode mudar. Offset foi descartado porque uma
inserção concorrente faz uma linha aparecer em duas páginas — ou em nenhuma.

**Versionamento.** Na URL (`/v1`). Uma versão nova é criada quando uma mudança
quebra clientes; adições de campo não quebram e não versionam.

**Dinheiro.**

```json
{ "amountMinor": 125000, "currency": "BRL" }
```

Inteiro na menor unidade mais ISO-4217. R$ 1.250,00. Nunca ponto flutuante,
nunca string formatada.

**Datas.** `date` é `YYYY-MM-DD`; `datetime` é ISO-8601 com offset.

**Idempotência.** Endpoints de transição de estado (`/issue`, `/activate`,
`/offboard`, `/status`) recusam a transição inválida com 409 em vez de repetir
o efeito. Chamar `/issue` duas vezes emite uma fatura, não duas.

## Gerando um cliente

```bash
npx openapi-typescript docs/api/financial.openapi.json -o cliente.ts
```

Dentro do monorepo isso não é necessário: importe os tipos de `@ssm/contracts`,
que é de onde a especificação foi gerada.
