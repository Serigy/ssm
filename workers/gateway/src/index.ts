import { SSM_MODULES } from '@ssm/contracts';
import { createApp, Coordinator, withMonitoring, type AppEnv } from '@ssm/worker-common';

/**
 * O que sobrou do gateway.
 *
 * Na pilha em contêiner ele era um proxy reverso: recebia tudo em /api/* e
 * encaminhava para o serviço certo. Na Cloudflare esse trabalho é da própria
 * plataforma — cada Worker declara a rota que atende em `wrangler.jsonc`, e a
 * borda entrega direto. Um proxy aqui só acrescentaria um salto, um ponto de
 * falha e o custo de uma invocação a cada requisição do sistema.
 *
 * Restam duas responsabilidades, e as duas são reais:
 *
 *   1. **O estado agregado dos módulos**, que o shell consulta para avisar que
 *      um módulo está fora antes de alguém clicar nele.
 *
 *   2. **A posse do Durable Object.** O Coordinator é declarado aqui e os
 *      outros cinco Workers o acessam por binding entre scripts. Ele precisa
 *      morar em algum lugar, e o gateway é o único que não tem domínio próprio
 *      — pô-lo dentro do financeiro faria a numeração de faturas depender do
 *      ciclo de deploy de um módulo que não é dono dela.
 *
 *      Consequência de ordem: o gateway é o primeiro a subir num ambiente novo.
 *      Ver scripts/cf-provision.sh.
 */
const app = createApp('/api');

/**
 * Como o gateway alcança cada módulo.
 *
 * Não é por URL, e a razão custou uma investigação: **uma subrequisição de
 * Worker para a própria zona não reentra no roteamento de Workers.** A
 * Cloudflare a encaminha para a origem, para evitar laço — e a origem aqui é o
 * Pages. O resultado era 404, e a página de estado dizia "degraded" com os
 * cinco módulos perfeitamente no ar.
 *
 * O caminho nativo é o *service binding*: a chamada não passa pela rede, não
 * depende de DNS nem de rota, e é uma capacidade declarada — visível no
 * `wrangler.jsonc` e revisável como qualquer outro binding (ver ADR 0012).
 *
 * Isso não afrouxa a regra do ADR 0002 de que módulo não chama módulo. Não há
 * chamada de negócio aqui: o gateway pergunta "você está de pé?", e é o único
 * que tem esses bindings. Nenhum módulo tem binding para outro.
 *
 * Em desenvolvimento os seis rodam em processos separados de `wrangler dev`, e
 * o binding não resolve entre eles — daí o caminho por HTTP em localhost.
 */
const DEV_PORTS: Record<string, number> = {
  identity: 8801,
  financial: 8802,
  hr: 8803,
  legal: 8804,
  operations: 8805,
};

function serviceFor(env: AppEnv['Bindings'], moduleName: string): Fetcher | undefined {
  const bindings: Record<string, Fetcher | undefined> = {
    identity: env.SVC_IDENTITY,
    financial: env.SVC_FINANCIAL,
    hr: env.SVC_HR,
    legal: env.SVC_LEGAL,
    operations: env.SVC_OPERATIONS,
  };
  return bindings[moduleName];
}

/**
 * Prazo curto de propósito: este endpoint precisa continuar rápido quando um
 * módulo está pendurado, ou a página de estado vira a próxima indisponibilidade.
 */
async function probe(env: AppEnv['Bindings'], moduleName: string): Promise<Response> {
  const caminho = `/api/${moduleName}/health/ready`;
  const init = { signal: AbortSignal.timeout(2_000) };

  const svc = serviceFor(env, moduleName);
  if (svc) return svc.fetch(`https://interno${caminho}`, init);

  return fetch(`http://localhost:${DEV_PORTS[moduleName]}${caminho}`, init);
}

app.get('/api/v1/status', async (c) => {
  const checks = await Promise.all(
    [...SSM_MODULES, 'identity'].map(async (moduleName) => {
      try {
        const res = await probe(c.env, moduleName);
        if (!res.ok) {
          // Sem isto "degraded" é adjetivo sem causa: quem investiga não sabe
          // se o módulo recusou, se a rota não casou, ou se a sonda foi parar
          // noutro lugar.
          console.warn(
            JSON.stringify({
              event: 'gateway.probe.degraded',
              module: moduleName,
              status: res.status,
            }),
          );
        }
        return [moduleName, res.ok ? 'up' : 'degraded'] as const;
      } catch (err) {
        console.warn(
          JSON.stringify({ event: 'gateway.probe.down', module: moduleName, err: String(err) }),
        );
        return [moduleName, 'down'] as const;
      }
    }),
  );

  const modules = Object.fromEntries(checks);

  // Estado nunca é cacheado. A borda guardava a resposta e continuava servindo
  // "degraded" depois de tudo voltar — uma página de estado errada é pior que
  // nenhuma, porque quem olha para de olhar.
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  return c.json({
    status: Object.values(modules).every((v) => v === 'up') ? 'ok' : 'degraded',
    environment: c.env.ENVIRONMENT,
    modules,
  });
});

export default withMonitoring({ fetch: app.fetch } satisfies ExportedHandler<AppEnv['Bindings']>);

export { Coordinator };
