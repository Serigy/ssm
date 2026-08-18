terraform {
  required_version = ">= 1.9.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.2"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.36"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # State holds bucket names and namespace metadata — not credentials, since
  # those live in the cluster Secret — but it is still the map of the estate.
  # Configure with `terraform init -backend-config=environments/<env>.backend`.
  backend "s3" {}
}
