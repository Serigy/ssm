# 0012 — Perímetro sem rede: o que substitui VCN, subnet e NSG na Cloudflare

- **Estado:** Aceito
- **Data:** 2026-08-18

## Contexto

A pergunta veio na forma certa: numa OCI, a topologia seria uma VCN, com
subnets privadas para banco e aplicação, NSGs com regras entre elas, um load
balancer na subnet pública e um NAT gateway para saída controlada. Nada disso
existe na Cloudflare, e a ausência precisa ser explicada — não é omissão do
desenho, é que o desenho passou a se apoiar em outra coisa.

O ADR [0002](0002-microsservicos-por-modulo.md) já dizia que módulo não chama
módulo por HTTP, e na versão em Kubernetes isso era imposto por NetworkPolicy.
Ao migrar para Workers, a NetworkPolicy some. A pergunta é o que a substitui.

## Decisão

**O perímetro deixa de ser topológico e passa a ser de capacidade.** Um Worker
não alcança um recurso porque está na mesma subnet; ele alcança porque tem um
*binding* declarado no `wrangler.jsonc`. Sem binding não há rota, não há nome
para resolver e não há endereço para tentar — a chamada não é recusada, ela é
inexprimível.

### Equivalências

| OCI | Para que serve | Aqui |
|---|---|---|
| VCN | Fronteira de isolamento | A conta Cloudflare e a zona |
| Subnet privada (banco) | Banco inalcançável da internet | D1, KV, R2 e Durable Objects **não têm endpoint público** — só binding |
| NSG `app → db:5432` | Liberar um fluxo específico | A entrada `d1_databases` no `wrangler.jsonc` |
| Regra padrão *deny* | Negar o que não foi liberado | Ausência de binding. O padrão já é negar |
| Subnet pública + LB | Entrada | `routes` no `wrangler.jsonc` e a própria borda |
| WAF no LB | Filtro L7 | Regras de WAF na zona |
| Limite de taxa no LB | Volumetria | Rate limiting da Cloudflare + o Durable Object por ator |
| Bastion + SSH | Acesso administrativo | Não existe. `wrangler` e o painel, com Access na frente |
| NetworkPolicy do k8s | Módulo não chama módulo | Nenhum *service binding* entre Workers de módulo — a comunicação é por fila |

### O que fica mais forte

Uma NSG é uma regra que alguém escreve e alguém pode afrouxar; um banco em
subnet privada continua tendo um endereço, um listener e uma porta, e o que
separa o atacante dele é a configuração estar correta. Um D1 não tem endereço.
Não há porta a fechar, não há `pg_hba.conf` a errar, não há grupo de segurança
que alguém abra para `0.0.0.0/0` numa madrugada de incidente. A superfície some
em vez de ser protegida.

A regra do ADR 0002 também fica mais forte. A NetworkPolicy recusava a chamada
direta entre módulos em tempo de execução; aqui não há como escrevê-la: o
Worker do financeiro não tem binding para o do jurídico, e `fetch()` para ele só
sairia pela internet pública, onde a rota exige o mesmo token que qualquer
cliente. A restrição saiu do plano de rede e virou propriedade da estrutura.

### O que fica mais fraco, e o que se faz a respeito

Três perdas reais, registradas para não serem descobertas depois.

**1. Não há controle de saída.** Uma subnet privada sem NAT não fala com a
internet. Um Worker fala com qualquer host, porque `fetch()` é parte do runtime.
Um pacote comprometido na árvore de dependências consegue exfiltrar dado sem
tocar em nenhuma regra. O que atenua:

- O `pnpm-lock.yaml` é a fronteira, e o Aikido (ADR [0009](0009-aikido-zen.md))
  vigia a árvore. Isso deixou de ser higiene e passou a ser controle primário.
- Nenhum código nosso faz `fetch()` com URL vinda de requisição. É verificável
  por revisão, e vale uma regra de lint.
- Onde a Cloudflare oferece política de egresso por conta, ela deve ser ligada.

**2. Não há observabilidade de pacote.** Não existe VPC Flow Log. O que existe é
log de requisição, `traceId` e a consulta de observabilidade do Worker. Para
investigar movimento lateral, a evidência é a aplicação, não a rede — o que
torna o log estruturado com `traceId` uma exigência, e não um confortinho.

**3. O raio de alcance de um token é a conta inteira, não uma subnet.** Um token
de API com escopo largo vale mais que qualquer regra de firewall aqui. Daí a
disciplina do ADR [0005](0005-segredos-em-arquivo.md) continuar valendo, com
tokens separados por finalidade — deploy de Worker, deploy de Pages, R2 — e
nunca a chave global em automação.

### Onde ainda existe rede

Nem tudo é Worker. A infraestrutura de produção da Serigy — Proxmox, k3s,
controladores de domínio — continua em rede própria, e o que a conecta é o
**Cloudflare Tunnel**, não uma VPN nem um IP público. O tunnel é saída apenas:
o `cloudflared` abre a conexão de dentro para fora, então não há porta aberta no
firewall de borda para ninguém varrer. É o análogo mais próximo de um Service
Gateway, e é mais fechado que ele.

Para o que precisar de perímetro com identidade — uma API interna, um painel
administrativo — o instrumento é o **Cloudflare Access**, que exige identidade
antes de a requisição chegar ao Worker. Access é o que substitui "só quem está
na subnet de gestão", com a diferença de perguntar quem é a pessoa em vez de de
onde ela vem.

## Consequências

- Revisar `wrangler.jsonc` passa a ser revisão de segurança. Um binding a mais é
  uma regra de firewall a mais, e deve receber o mesmo escrutínio.
- Não há diagrama de rede a manter, e não deve haver: um desenho com caixas e
  setas sugeriria uma topologia que não existe. O mapa é a tabela de bindings.
- A resposta a incidente muda de ferramenta. Não há captura de tráfego nem
  regra de firewall para cortar um fluxo; há desfazer deploy, revogar token e
  regra de WAF.
- Se algum dia for preciso alcançar um banco relacional de verdade em rede
  privada, o caminho é Tunnel mais Hyperdrive, e isso merece ADR próprio.
