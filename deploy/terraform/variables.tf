variable "environment" {
  description = "Deployment environment. Drives naming and retention."
  type        = string
  validation {
    condition     = contains(["development", "staging", "production"], var.environment)
    error_message = "environment must be development, staging or production."
  }
}

variable "cloudflare_account_id" {
  description = "Cloudflare account that owns the R2 buckets."
  type        = string
}

variable "cloudflare_api_token" {
  description = <<-EOT
    Cloudflare API token with R2 edit permission.

    Never put this in a .tfvars file — those are gitignored but still land on
    disk in plaintext. Pass it as TF_VAR_cloudflare_api_token from the CI
    secret store, or read it from the file the operator already has:
      export TF_VAR_cloudflare_api_token="$(cat secrets/local/cloudflare_token)"
  EOT
  type        = string
  sensitive   = true
}

variable "domain" {
  description = "Public hostname for the application."
  type        = string
  default     = "ssm.serigy.io"
}

variable "kube_context" {
  description = "kubectl context to target."
  type        = string
}

variable "namespace" {
  description = "Kubernetes namespace for SSM."
  type        = string
  default     = "ssm"
}

variable "document_retention_days" {
  description = <<-EOT
    Days before a document in the non-current version tier is purged.

    This is a legal-retention decision, not an infrastructure one: invoices and
    signed contracts have statutory minimum retention. Confirm the figure with
    counsel before lowering it.
  EOT
  type        = number
  default     = 3650 # ten years
}
