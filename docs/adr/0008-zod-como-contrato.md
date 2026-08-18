# 0008 — Zod como fonte única de esquema

- **Estado:** Aceita
- **Data:** 2026-08-17

## Contexto

Cada forma de dado no SSM tem três consumidores: o serviço que valida a
requisição, o micro-frontend que monta e valida o formulário, e o consumidor de
evento que recebe o payload.

O padrão do NestJS é `class-validator` com decoradores. Isso resolve o primeiro
consumidor e deixa os outros dois se virarem — na prática, redigitando a mesma
forma em TypeScript no front-end. As duas definições então divergem, e a
divergência aparece como um 422 em produção.

## Decisão

Esquemas **Zod** em `libs/contracts` são a fonte da verdade. Deles derivam:

- o tipo TypeScript (`z.infer`), usado no serviço e no front-end;
- a validação no servidor, via `ZodValidationPipe`;
- o modelo do Swagger, via `createZodDto` do `nestjs-zod`;
- a validação de payload de evento, via `parseEventPayload`.

Uma definição, quatro usos.

## Consequências

**Bom.** Um campo novo aparece no tipo do front-end assim que o esquema muda —
o compilador aponta onde tratar. A validação do evento é a mesma do endpoint. Os
`docs/api/*.openapi.json` são gerados e versionados, então uma quebra de
contrato vira um diff no code review.

**Ruim:**

- **Duas classes de DTO por endpoint.** `createZodDto` gera uma classe só para
  o Swagger enxergar. É cerimônia, mas é derivada, não duplicada.
- **`nestjs-zod` no caminho.** Uma dependência a mais entre o Zod e o Swagger.
- **Zod não expressa tudo do JSON Schema.** Casos exóticos precisam de
  `@ApiProperty` explícito.

## Alternativas consideradas

**`class-validator` com `class-transformer`** — o padrão do Nest, integração de
Swagger pronta. Rejeitado por resolver só o servidor: o front-end redigitaria
tudo, e é exatamente aí que a divergência nasce.

**OpenAPI primeiro, com geração de código** — o contrato seria o artefato
central e ambos os lados seriam gerados. É uma arquitetura defensável e comum em
equipes maiores. Rejeitado pelo atrito: um passo de geração no meio de cada
mudança, tipos gerados que não se lêem bem, e um YAML grande como principal
superfície de edição. Aqui o esquema é código, e o OpenAPI é gerado dele — o
inverso.

**Apenas tipos TypeScript, sem validação em runtime** — rejeitado sem discussão.
Tipos desaparecem na compilação; a entrada de rede precisa ser validada em
execução.
