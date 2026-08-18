#!/usr/bin/env bash
# Install kind, helm and terraform into ~/.local/bin (no root required).
set -euo pipefail

BIN="${HOME}/.local/bin"
mkdir -p "$BIN"
ARCH="$(uname -m)"; case "$ARCH" in x86_64) ARCH=amd64 ;; aarch64|arm64) ARCH=arm64 ;; esac
OS="$(uname | tr '[:upper:]' '[:lower:]')"

KIND_VERSION="${KIND_VERSION:-v0.27.0}"
HELM_VERSION="${HELM_VERSION:-v3.17.3}"
TF_VERSION="${TF_VERSION:-1.11.4}"

have() { command -v "$1" >/dev/null 2>&1; }

if have kind; then echo "kind already installed: $(kind --version)"; else
  echo "==> kind ${KIND_VERSION}"
  curl -fsSL -o "$BIN/kind" "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-${OS}-${ARCH}"
  chmod +x "$BIN/kind"
fi

if have helm; then echo "helm already installed: $(helm version --short)"; else
  echo "==> helm ${HELM_VERSION}"
  tmp="$(mktemp -d)"
  curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-${OS}-${ARCH}.tar.gz" | tar -xz -C "$tmp"
  install -m 0755 "$tmp/${OS}-${ARCH}/helm" "$BIN/helm"
  rm -rf "$tmp"
fi

if have terraform; then echo "terraform already installed: $(terraform version | head -1)"; else
  echo "==> terraform ${TF_VERSION}"
  tmp="$(mktemp -d)"
  curl -fsSL -o "$tmp/tf.zip" \
    "https://releases.hashicorp.com/terraform/${TF_VERSION}/terraform_${TF_VERSION}_${OS}_${ARCH}.zip"
  (cd "$tmp" && unzip -qo tf.zip && install -m 0755 terraform "$BIN/terraform")
  rm -rf "$tmp"
fi

echo
echo "Installed into $BIN"
case ":$PATH:" in
  *":$BIN:"*) : ;;
  *) echo "WARNING: $BIN is not on your PATH. Add to ~/.bashrc:"
     echo "  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
