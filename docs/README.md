# Documentação do SSM

SSM — Serigy Service Manager. Três módulos de negócio (Financeiro, Pessoas,
Jurídico) sobre uma arquitetura de microsserviços em NestJS e micro-frontends
federados em React.

## Por onde começar

| Você quer… | Leia |
|---|---|
| Subir o projeto na sua máquina | [runbooks/desenvolvimento-local.md](runbooks/desenvolvimento-local.md) |
| Entender a arquitetura | [architecture/visao-geral.md](architecture/visao-geral.md) |
| Saber *por que* algo é assim | [adr/](adr/) |
| Trabalhar em um módulo | [modules/](modules/) |
| Consumir a API | [api/](api/) |
| Publicar em um cluster | [runbooks/implantacao.md](runbooks/implantacao.md) |
| Entender as decisões de segurança | [security/](security/) |
| Construir uma tela | [design/](design/) |

## Estrutura do repositório

```
apps/
  gateway/          entrada única do navegador; encaminha /api para os serviços
  identity-svc/     autenticação, usuários, papéis — único dono da chave privada
  financial-svc/    faturamento          (Postgres)
  hr-svc/           colaboradores        (Postgres)
  legal-svc/        contratos            (MongoDB)
  ops-svc/          sustentação e SLA    (Postgres)
  shell/            host dos micro-frontends
  mfe-financial/    remote federado
  mfe-hr/           remote federado
  mfe-legal/        remote federado
  mfe-operations/   remote federado

libs/
  contracts/        tipos e eventos compartilhados — fonte da verdade
  nest-common/      plataforma dos serviços: config, segredos, auth, bus, storage
  ui-kit/           design system da Serigy em React + CSS
  mfe-runtime/      contrato entre o shell e os remotes

deploy/
  kind/             cluster local
  helm/ssm/         chart da aplicação
  terraform/        R2, namespace, cotas
  ansible/          preparo do host

docs/               esta documentação
secrets/            segredos em arquivo — nunca .env
tools/seed/         dados de demonstração
```

## Convenções que valem em todo o repositório

- **Segredos são arquivos**, não variáveis de ambiente. Ver [secrets/README.md](../secrets/README.md).
- **Dinheiro é inteiro** na menor unidade da moeda, com código ISO-4217. Nunca ponto flutuante.
- **Toda consulta filtra por `tenantId`** como primeiro predicado, vindo do token verificado.
- **Serviços de módulo não se chamam por HTTP.** Comunicam-se por eventos no RabbitMQ.
- **Erros seguem a RFC 9457** (`application/problem+json`) e carregam um `traceId`.
- **A interface segue o Design System da Serigy** — sem exceção e sem emoji.
