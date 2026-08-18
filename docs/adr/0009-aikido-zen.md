# 0009 — Aikido Zen como firewall em aplicação

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

O SSM manipula dinheiro, dado pessoal e documento jurídico. As três classes de
dado que mais interessam a um atacante estão aqui.

As defesas de código já existem: consultas parametrizadas, Zod em toda entrada,
guards de permissão, escopo por tenant. Elas são a defesa principal e continuam
sendo. Mas todas dependem de o próximo desenvolvedor não errar, e a superfície é
grande — cinco serviços, dezenas de endpoints, uma equipe que cresce.

Um WAF tradicional fica na borda e casa padrões contra a requisição bruta. Ele
não sabe o que a aplicação fez com aquela entrada: bloqueia `' OR 1=1` num campo
onde isso era um nome de empresa legítimo, e deixa passar uma injeção montada em
três partes que só se junta perto do driver.

## Decisão

Adotar **Zen**, o firewall em aplicação da Aikido (`@aikidosec/firewall`), em
todos os cinco serviços, e a varredura de CI da Aikido no pipeline.

Zen instrumenta o runtime do Node — driver SQL, cliente HTTP, `fs`,
`child_process` — e compara o que chega ao *sink* com o que veio na entrada do
usuário. A decisão é tomada com o contexto que o WAF não tem: não "isso parece
SQL", mas "esta string veio do corpo da requisição e está virando estrutura de
comando".

Três consequências operacionais:

1. **`zen-preload` é o primeiro import de todo `main.ts`**, antes do
   `@nestjs/core` e antes do `pg`. Ele instala hooks no carregador de módulos;
   qualquer coisa importada antes fica sem instrumentação.
2. **Modo de bloqueio é ligado em produção e desligado em desenvolvimento.**
   Localmente ele reporta o que teria bloqueado, sem interromper um script de
   seed no meio.
3. **`assertZenInProduction()` recusa subir** um serviço de produção sem o
   firewall. Se a proteção é opcional, ela acaba desligada.

Zen também recebe a identidade do usuário autenticado (`tagZenUser`, chamado
pelo `JwtAuthGuard`), para que rate limiting e bloqueio operem por ator e não
por IP de origem — que atrás de um Ingress compartilhado é a mesma coisa para
todo mundo.

## Consequências

**Bom.** Uma injeção que passe por uma revisão é bloqueada no ponto de execução.
A varredura de CI cobre dependência, SAST e IaC no mesmo lugar. O bloqueio por
ator funciona atrás do Ingress. Nada disso exige mudar código de aplicação.

**Ruim:**

- **Sobrecarga em tempo de execução.** Pequena, mas existe, em todo I/O
  instrumentado.
- **Dependência de fornecedor no caminho quente.** Mitigado por o carregamento
  ser opcional: o pacote ausente registra um aviso alto e o serviço sobe — exceto
  em produção, onde é falha dura. Nunca deve haver uma versão do Zen que impeça
  os serviços de subir.
- **Falsos positivos em modo bloqueio.** Por isso o rollout é escalonado:
  desenvolvimento reporta, homologação reporta e é auditada, produção bloqueia.

**Zen não substitui nada.** Consulta parametrizada, validação, guard e escopo por
tenant continuam obrigatórios. Zen é a rede sob o trapézio, não o trapézio.

## Alternativas consideradas

**Só WAF na borda** (Cloudflare, ModSecurity) — mantido, e continua útil contra
volumetria e varredura automatizada. Rejeitado como defesa principal contra
injeção por não ter contexto da aplicação: gera falso positivo em dado legítimo e
perde ataque montado em partes.

**Só SAST no CI** — encontra o padrão antes do merge, o que é melhor. Rejeitado
como suficiente porque não vê nada em tempo de execução: não pega injeção via
dependência, nem via dado que entrou por um caminho que a análise estática não
percorreu.

**Nada além do código** — rejeitado pela combinação de superfície e sensibilidade
do dado. Defesa em profundidade não é opcional quando o que está em jogo é folha
de pagamento e contrato assinado.
