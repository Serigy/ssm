# Estado de ssm.serigy.net antes do corte do ORDS

Capturado em 2026-08-19T15:11:18Z para permitir volta atrás.

## Rota de Worker
- id `d743b4e1f410400d8ef54fa0003507c9` | padrão `ssm.serigy.net/*` | script `reverse-proxy-oci-ssm`

## Registro DNS
- id `4a750cfbf40c6a387566281f8d82ecfc` | AAAA `100::` | proxied=True

## Como voltar atrás

Recriar a rota apontando para \`reverse-proxy-oci-ssm\` e devolver o registro
para \`AAAA 100::\` proxied. O Worker do proxy não é apagado por este corte —
ele continua na conta, sem rota, e volta a servir assim que a rota existir.
