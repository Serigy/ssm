# 0007 — Gateway é proxy reverso, não BFF

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

O navegador precisa de uma origem só: uma para o CORS, uma para o cookie de
refresh, uma para o certificado. Isso exige um componente na frente dos quatro
serviços.

A pergunta é o que ele faz além de encaminhar. A tentação é transformá-lo num
Backend for Frontend: agregar respostas de vários módulos, adaptar formatos,
resolver o N+1 da tela.

## Decisão

O gateway encaminha e nada mais. As responsabilidades dele são todas
operacionais ou adjacentes à autenticação:

- origem única para o navegador;
- rate limiting (rajada de 20/s, sustentado de 300/min);
- CORS e cabeçalhos de segurança;
- propagação do `correlationId`;
- **remoção de cabeçalhos forjados** — `x-tenant-id`, `x-actor-id`, `x-user-id`
  são apagados de toda requisição que passa;
- `/api/v1/status`, o estado agregado dos módulos.

Ele não agrega, não transforma e não revalida payload.

## Consequências

**Bom.** O gateway não sabe nada de domínio, então uma mudança no Financeiro não
o toca. Ele é sem estado e escala horizontalmente sem cuidado nenhum. O
encaminhamento é *streaming* — um relatório grande atravessa sem passar pelo heap
do gateway, o que não seria verdade se ele fizesse a requisição com um cliente
HTTP e reemitisse o corpo. E como não conhece nenhum esquema, uma mudança de
contrato não exige um deploy coordenado dos dois.

**Ruim:**

- **A tela faz mais chamadas.** Uma tela que precisa de fatura e contraparte faz
  duas requisições. Com HTTP/2 no Ingress isso é uma multiplexação, não duas
  conexões — o custo é real, mas pequeno.
- **Não há lugar óbvio para agregação.** Quando uma tela precisar mesmo de uma
  visão composta, a resposta certa é um endpoint no módulo dono do agregado, ou
  um serviço de leitura dedicado — não engordar o gateway.

## Alternativas consideradas

**BFF com agregação** — menos requisições, resposta talhada para a tela.
Rejeitado porque coloca conhecimento de domínio dos três módulos em um único
componente que os três compartilham. Ele passaria a ser reimplantado a cada
mudança em qualquer módulo, que é exatamente o acoplamento que a arquitetura
existe para evitar. É o ponto onde arquiteturas assim costumam apodrecer.

**Um BFF por micro-frontend** — evita o acoplamento cruzado e é uma escolha
legítima. Rejeitado por proporção: são mais três serviços para operar,
implantar e monitorar, para uma economia de latência que hoje não é o gargalo.
A porta fica aberta: cada módulo já tem seu próprio prefixo de rota.

**Ingress puro, sem gateway** — o nginx encaminharia direto. Rejeitado porque o
rate limiting por usuário autenticado, a remoção de cabeçalhos forjados e o
endpoint de estado agregado ficariam sem casa, ou virariam configuração de nginx
que ninguém testa.
