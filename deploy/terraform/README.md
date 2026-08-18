# Terraform

Provisions the infrastructure SSM runs on: the R2 bucket, the Kubernetes
namespace, and the quota and limit ranges that keep it inside its budget.

## What this does not do

It does not create secrets, and it does not install the application.

- **Secrets** would end up in the state file in plaintext. They are created out
  of band and, in staging and production, synced by the External Secrets
  Operator from Vault. See [docs/security/secrets-management.md](../../docs/security/secrets-management.md).
- **The application** is a Helm release, deployed by CI on every merge. Managing
  it from Terraform would tie an application deploy to an infrastructure plan,
  which is the wrong cadence for both.

## Usage

```bash
export TF_VAR_cloudflare_api_token="$(cat ~/.config/serigy/cf-token)"

terraform init -backend-config=environments/production.backend
terraform plan  -var-file=environments/production.tfvars
terraform apply -var-file=environments/production.tfvars
```

For local development none of this is needed — `make kind-up` plus MinIO covers
it, which is the point of keeping the S3 code path identical.
