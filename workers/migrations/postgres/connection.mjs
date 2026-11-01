import { readFileSync } from 'node:fs';

/**
 * Onde as ferramentas de banco buscam a URL, sem nunca exibi-la.
 *
 * CI entrega por variável de ambiente (o cofre do pipeline injeta); local, por
 * arquivo em secrets/local/, como manda o ADR 0005. A variável é a exceção de
 * CI e existe porque o pipeline não tem /run/secrets; o arquivo é o caminho
 * normal. Os dois são lidos aqui e em nenhum outro lugar.
 */
export function readUrl({ envName, argv }) {
  const i = argv.indexOf('--url-file');
  if (i !== -1) {
    const file = argv[i + 1];
    if (!file) throw new Error('--url-file pede o caminho de um arquivo.');
    return readFileSync(file, 'utf8').trim();
  }
  const fromEnv = process.env[envName];
  if (fromEnv) return fromEnv.trim();
  throw new Error(`Informe --url-file <arquivo> ou defina ${envName}.`);
}

/**
 * Tira do texto de um erro tudo o que identifique a conexão. Os erros do `pg`
 * às vezes repetem host e usuário; a senha não deveria aparecer, mas a regra
 * aqui é não depender disso.
 */
export function redact(text, url) {
  let out = String(text);
  try {
    const u = new URL(url);
    for (const secret of [url, u.password, decodeURIComponent(u.password), u.username, u.hostname]) {
      if (secret) out = out.split(secret).join('[omitido]');
    }
  } catch {
    out = out.split(url).join('[omitido]');
  }
  return out;
}

export async function withClient(url, fn) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}
