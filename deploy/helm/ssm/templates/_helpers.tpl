{{/* Common naming and labels. */}}

{{- define "ssm.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ssm.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "ssm.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "ssm.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "ssm.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: ssm
{{- end -}}

{{- define "ssm.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- printf "%s-sa" (include "ssm.fullname" .) -}}
{{- else -}}
default
{{- end -}}
{{- end -}}

{{/*
Environment shared by every service. Only non-secret values live here — anything
sensitive arrives as a file under /run/secrets, never as an env var, because env
vars are visible in `kubectl describe`, in crash dumps and in /proc.
*/}}
{{- define "ssm.commonEnv" -}}
- name: NODE_ENV
  value: {{ .root.Values.global.environment | quote }}
- name: LOG_LEVEL
  value: {{ .root.Values.config.logLevel | quote }}
- name: SSM_SECRETS_DIR
  value: /run/secrets
- name: SSM_VERSION
  value: {{ .root.Values.image.tag | quote }}
- name: CORS_ORIGINS
  value: {{ printf "https://%s" .root.Values.global.domain | quote }}
- name: JWT_ISSUER
  value: {{ .root.Values.config.jwtIssuer | quote }}
- name: JWT_AUDIENCE
  value: {{ .root.Values.config.jwtAudience | quote }}
- name: ACCESS_TOKEN_TTL_SECONDS
  value: {{ .root.Values.config.accessTokenTtlSeconds | quote }}
- name: REFRESH_TOKEN_TTL_SECONDS
  value: {{ .root.Values.config.refreshTokenTtlSeconds | quote }}
- name: RABBITMQ_HOST
  value: {{ .root.Values.rabbitmq.host | quote }}
- name: RABBITMQ_PORT
  value: {{ .root.Values.rabbitmq.port | quote }}
- name: RABBITMQ_USER
  value: {{ .root.Values.rabbitmq.user | quote }}
- name: RABBITMQ_VHOST
  value: {{ .root.Values.rabbitmq.vhost | quote }}
- name: REDIS_HOST
  value: {{ .root.Values.redisConfig.host | quote }}
- name: REDIS_PORT
  value: {{ .root.Values.redisConfig.port | quote }}
- name: REDIS_DB
  value: {{ .root.Values.redisConfig.db | quote }}
- name: REDIS_ENABLED
  value: {{ .root.Values.redisConfig.enabled | quote }}
- name: ZEN_ENABLED
  value: {{ .root.Values.config.zen.enabled | quote }}
- name: ZEN_BLOCKING
  value: {{ .root.Values.config.zen.blocking | quote }}
- name: R2_BUCKET
  value: {{ .root.Values.config.r2.bucket | quote }}
- name: R2_REGION
  value: {{ .root.Values.config.r2.region | quote }}
- name: R2_ENDPOINT
  value: {{ .root.Values.config.r2.endpoint | quote }}
{{- if eq (.svc.engine | default "postgres") "mongodb" }}
- name: MONGO_HOST
  value: {{ .root.Values.mongo.host | quote }}
- name: MONGO_PORT
  value: {{ .root.Values.mongo.port | quote }}
- name: MONGO_USER
  value: {{ .root.Values.mongo.user | quote }}
- name: MONGO_DB
  value: {{ .svc.database | quote }}
{{- else if .svc.database }}
- name: POSTGRES_HOST
  value: {{ .root.Values.postgres.host | quote }}
- name: POSTGRES_PORT
  value: {{ .root.Values.postgres.port | quote }}
- name: POSTGRES_USER
  value: {{ .root.Values.postgres.user | quote }}
- name: POSTGRES_DB
  value: {{ .svc.database | quote }}
- name: POSTGRES_SSL
  value: {{ .root.Values.postgres.ssl | quote }}
{{- end }}
{{- end -}}

{{/*
Hardened pod and container security context, applied to every workload.
Each line closes a specific escalation path, so none of them is optional.
*/}}
{{- define "ssm.podSecurityContext" -}}
runAsNonRoot: true
runAsUser: 10001
runAsGroup: 10001
fsGroup: 10001
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "ssm.containerSecurityContext" -}}
allowPrivilegeEscalation: false
privileged: false
readOnlyRootFilesystem: true
runAsNonRoot: true
capabilities:
  drop: ["ALL"]
{{- end -}}
