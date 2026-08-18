output "namespace" {
  description = "Kubernetes namespace SSM is deployed into."
  value       = kubernetes_namespace.ssm.metadata[0].name
}

output "documents_bucket" {
  description = "R2 bucket holding invoice PDFs and signed contracts."
  value       = module.documents_bucket.bucket_name
}

output "r2_endpoint" {
  description = "Set as R2_ENDPOINT in the Helm values."
  value       = module.documents_bucket.endpoint
}

output "next_steps" {
  description = "What Terraform deliberately does not do."
  value       = <<-EOT
    Terraform provisions infrastructure. It does NOT create the application
    secrets, on purpose: putting a credential into Terraform means putting it
    into the state file, where it is stored in plaintext and read by anyone who
    can read the state bucket.

    Create the R2 API token by hand (or in the secret manager), then:

      kubectl -n ${kubernetes_namespace.ssm.metadata[0].name} create secret generic ssm-secrets \
        --from-file=secrets/local/

    In staging and production the External Secrets Operator syncs that Secret
    from Vault instead — see docs/security/secrets-management.md.
  EOT
}
