# Fluxo de branches

O código sobe por três branches protegidas, sempre por pull request:

```text
feature -> development -> staging -> main
```

| Branch | Checks obrigatórios | Aprovações |
|---|---|---|
| `development` | `ssm-worker-mr-check-development`, `ssm-web-mr-check-development` | 1 |
| `staging` | `ssm-worker-mr-check-staging`, `ssm-web-mr-check-staging` | 2, incluindo o dono do código |
| `main` | `ssm-worker-mr-check-main`, `ssm-web-mr-check-main` | 2, incluindo o dono do código |

Os checks rodam no GitHub Actions, em `.github/workflows/mr-check.yml`, antes do
merge. O CircleCI roda depois, nas três branches, sobre o que já foi aceito.

## Implantação

O CircleCI implanta depois do merge, com `scripts/cf-deploy.sh`:

| Branch | Depois do merge |
|---|---|
| `development` | Só verifica: não há ambiente remoto |
| `staging` | Verifica e implanta em `hmg` |
| `main` | Verifica, espera a aprovação em `aprovar-prd` e implanta em `prd` |

Os jobs leem as credenciais dos contexts `ssm-hmg` e `ssm-prd` do CircleCI, com
`CLOUDFLARE_API_TOKEN` e `SENTRY_AUTH_TOKEN`. Em repositório público, mantenha
desligado **Pass secrets to builds from forked pull requests**.

## Limites do GitHub

- **Plano.** Regras de branch em repositório privado exigem o plano Team.
- **Autor não aprova o próprio PR.** O dono do código precisa abrir seus PRs por
  outra conta, ou a aprovação dele nunca poderá contar.
- **Segundo revisor.** A segunda aprovação precisa vir de outra conta com acesso
  de escrita ao repositório.
