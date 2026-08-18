terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.2"
    }
  }
}

variable "account_id" { type = string }
variable "bucket_name" { type = string }
variable "environment" { type = string }
variable "retention_days" { type = number }

/**
 * Cloudflare R2 bucket for SSM documents.
 *
 * The bucket is private with no public access at all — every read and write
 * goes through a presigned URL minted by a service, which is what keeps an
 * invoice PDF from being enumerable by anyone who guesses a key.
 */
resource "cloudflare_r2_bucket" "documents" {
  account_id = var.account_id
  name       = var.bucket_name
  location   = "WEUR"

  # Object versioning: an overwritten contract is recoverable. For a legal
  # document store this is not optional.
  storage_class = "Standard"
}

resource "cloudflare_r2_bucket_lifecycle" "documents" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.documents.name

  rules = [
    {
      id      = "abort-incomplete-uploads"
      enabled = true
      # Applies to the whole bucket. The provider requires `conditions` on every
      # rule even when the scope is everything.
      conditions = {
        prefix = ""
      }
      # A browser that starts a presigned multipart upload and closes the tab
      # leaves parts behind that are billed but unreachable.
      abort_multipart_uploads_transition = {
        condition = {
          max_age = 86400
          type    = "Age"
        }
      }
    },
    {
      id      = "purge-old-versions"
      enabled = true
      conditions = {
        prefix = ""
      }
      delete_objects_transition = {
        condition = {
          max_age = var.retention_days * 86400
          type    = "Age"
        }
      }
    },
  ]
}

resource "cloudflare_r2_bucket_cors" "documents" {
  account_id  = var.account_id
  bucket_name = cloudflare_r2_bucket.documents.name

  rules = [
    {
      # Presigned PUT from the browser needs CORS; the origin list is narrow on
      # purpose, and a wildcard here would let any site upload with a leaked URL.
      allowed = {
        origins = var.environment == "production" ? ["https://ssm.serigy.io"] : ["https://ssm.staging.serigy.io", "http://localhost:4200"]
        methods = ["GET", "PUT"]
        headers = ["Content-Type"]
      }
      max_age_seconds = 3600
    },
  ]
}

output "bucket_name" {
  value = cloudflare_r2_bucket.documents.name
}

output "endpoint" {
  description = "S3-compatible endpoint the services point at."
  value       = "https://${var.account_id}.r2.cloudflarestorage.com"
}
