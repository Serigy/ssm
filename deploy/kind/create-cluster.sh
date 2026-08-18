#!/usr/bin/env bash
# Create the local kind cluster and everything the chart expects to already exist.
set -euo pipefail

CLUSTER="${1:-ssm}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

command -v kind >/dev/null || { echo "kind não encontrado. Rode 'make install-tools'."; exit 1; }
command -v kubectl >/dev/null || { echo "kubectl não encontrado."; exit 1; }

if kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  echo "Cluster '$CLUSTER' já existe. Reaproveitando."
else
  echo "==> Criando o cluster kind '$CLUSTER'"
  kind create cluster --config "$ROOT/deploy/kind/cluster.yaml" --name "$CLUSTER" --wait 120s
fi

kubectl config use-context "kind-$CLUSTER"

echo "==> Instalando o ingress-nginx"
kubectl apply -f https://raw.githubusercontent.com/kubernetes-sigs/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml

echo "==> Aguardando o controlador de ingress"
# The admission job races the controller; ignore it and wait on what matters.
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=180s

echo "==> Instalando o metrics-server (para HPA e 'kubectl top')"
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
# kind nodes serve their kubelet with a self-signed certificate.
kubectl -n kube-system patch deployment metrics-server --type=json \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' \
  2>/dev/null || true

echo
echo "Cluster pronto."
echo
echo "Adicione ao /etc/hosts, se ainda não estiver lá:"
echo "  127.0.0.1  ssm.localhost"
echo
echo "Depois: make deploy"
