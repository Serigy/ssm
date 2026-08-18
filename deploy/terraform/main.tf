provider "cloudflare" {
  api_token = var.cloudflare_api_token
}

provider "kubernetes" {
  config_context = var.kube_context
}

provider "helm" {
  kubernetes {
    config_context = var.kube_context
  }
}

locals {
  name = "ssm-${var.environment}"

  common_tags = {
    application = "ssm"
    environment = var.environment
    managed_by  = "terraform"
    repository  = "serigy/ssm"
  }
}

# --- Object storage ---------------------------------------------------------
module "documents_bucket" {
  source = "./modules/r2"

  account_id     = var.cloudflare_account_id
  bucket_name    = "${local.name}-documents"
  environment    = var.environment
  retention_days = var.document_retention_days
}

# --- Kubernetes namespace ---------------------------------------------------
resource "kubernetes_namespace" "ssm" {
  metadata {
    name = var.namespace
    labels = merge(local.common_tags, {
      # Required by the chart's NetworkPolicy, which selects namespaces by this
      # label rather than by name.
      "kubernetes.io/metadata.name" = var.namespace
      # Enforces the restricted Pod Security Standard: no privileged pods, no
      # host namespaces, no root. The chart's securityContext already complies,
      # so this is a backstop against a future manifest that does not.
      "pod-security.kubernetes.io/enforce" = "restricted"
      "pod-security.kubernetes.io/audit"   = "restricted"
      "pod-security.kubernetes.io/warn"    = "restricted"
    })
  }
}

# --- Resource guardrails ----------------------------------------------------
resource "kubernetes_resource_quota" "ssm" {
  metadata {
    name      = "ssm-quota"
    namespace = kubernetes_namespace.ssm.metadata[0].name
  }

  spec {
    hard = {
      "requests.cpu"    = var.environment == "production" ? "8" : "2"
      "requests.memory" = var.environment == "production" ? "16Gi" : "4Gi"
      "limits.cpu"      = var.environment == "production" ? "16" : "4"
      "limits.memory"   = var.environment == "production" ? "32Gi" : "8Gi"
      "pods"            = var.environment == "production" ? "60" : "20"
      # A runaway PVC is the most common way a namespace exhausts a cluster.
      "persistentvolumeclaims" = "10"
    }
  }
}

resource "kubernetes_limit_range" "ssm" {
  metadata {
    name      = "ssm-limits"
    namespace = kubernetes_namespace.ssm.metadata[0].name
  }

  spec {
    limit {
      type = "Container"
      # Catches a manifest that forgets to declare resources — without a
      # default, such a pod is BestEffort and is the first thing evicted under
      # memory pressure, usually at the worst moment.
      default = {
        cpu    = "500m"
        memory = "512Mi"
      }
      default_request = {
        cpu    = "100m"
        memory = "128Mi"
      }
      max = {
        cpu    = "2"
        memory = "4Gi"
      }
    }
  }
}
