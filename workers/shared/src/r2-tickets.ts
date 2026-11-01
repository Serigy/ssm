import type { DocumentTicket } from '@ssm/contracts';
import { AwsClient } from 'aws4fetch';
import type { BaseBindings } from './env.js';
import { HttpProblem } from './problem.js';

/**
 * Bilhetes assinados para o R2.
 *
 * O binário não passa pelo Worker, e essa é a propriedade que se quis
 * preservar: o navegador envia direto ao R2 e baixa direto do R2. Um Worker tem
 * 128 MiB no total, então um PDF de contrato atravessando a memória dele é o
 * caminho mais curto para derrubar o módulo inteiro com um upload grande.
 *
 * O `env.R2` — o binding — não consegue assinar URL: ele é um handle para ler e
 * escrever de dentro do Worker, não um cliente S3. A assinatura sai do endpoint
 * S3 do R2 com as credenciais da conta, e a `aws4fetch` faz SigV4 usando a
 * WebCrypto, sem WASM e sem dependência de Node.
 */
const TICKET_TTL_SECONDS = 600;

let cachedClient: AwsClient | undefined;
let cachedId: string | undefined;

function client(env: BaseBindings): AwsClient {
  const id = env.R2_ACCESS_KEY_ID;
  const secret = env.R2_SECRET_ACCESS_KEY;
  if (!id || !secret || !env.R2_ACCOUNT_ID) {
    // 503 com explicação, e não 500 genérico. Em desenvolvimento esta é a
    // situação normal: as credenciais S3 do R2 não podem ser inventadas por
    // scripts/gen-secrets.sh, vêm do painel da Cloudflare. Um "erro inesperado"
    // aqui manda quem desenvolve procurar bug onde só falta configuração.
    throw new HttpProblem(
      503,
      'ServiceUnavailable',
      'O envio de documentos exige as credenciais S3 do R2. Preencha ' +
        'secrets/local/r2_account_id, r2_access_key_id e r2_secret_access_key ' +
        '(painel da Cloudflare, R2 > Manage API tokens) e rode scripts/cf-devvars.sh.',
    );
  }
  if (cachedClient && cachedId === id) return cachedClient;
  cachedClient = new AwsClient({ accessKeyId: id, secretAccessKey: secret, service: 's3' });
  cachedId = id;
  return cachedClient;
}

/**
 * A chave carrega coleção, cliente e registro.
 *
 * Não é só organização: quem anexa recusa qualquer chave que não comece com
 * este prefixo, então a estrutura do caminho é o que impede um cliente de
 * apontar o seu registro para o arquivo de outro.
 */
export function documentPrefix(collection: string, tenantId: string, id: string): string {
  return `${collection}/${tenantId}/${id}/`;
}

export function documentKey(
  collection: string,
  tenantId: string,
  id: string,
  filename: string,
): string {
  // O nome enviado pelo navegador é reduzido ao que é seguro num caminho: barra
  // e ".." num nome de arquivo escapariam do prefixo que acabou de ser montado.
  const safe = filename.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/\.{2,}/g, '.').slice(0, 120);
  return `${documentPrefix(collection, tenantId, id)}${crypto.randomUUID()}-${safe}`;
}

async function sign(
  env: BaseBindings,
  key: string,
  method: 'GET' | 'PUT',
  contentType?: string,
): Promise<DocumentTicket> {
  const bucket = env.R2_BUCKET_NAME;
  const url = new URL(`https://${bucket}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`);
  url.searchParams.set('X-Amz-Expires', String(TICKET_TTL_SECONDS));

  const signed = await client(env).sign(
    new Request(url, { method, headers: contentType ? { 'content-type': contentType } : undefined }),
    { aws: { signQuery: true } },
  );

  return {
    url: signed.url,
    key,
    method,
    expiresAt: new Date(Date.now() + TICKET_TTL_SECONDS * 1000).toISOString(),
    ...(contentType ? { headers: { 'content-type': contentType } } : {}),
  };
}

export function uploadTicket(
  env: BaseBindings,
  collection: string,
  tenantId: string,
  id: string,
  filename: string,
  contentType: string,
): Promise<DocumentTicket> {
  // Só PDF: o documento assinado é documento, e aceitar qualquer tipo
  // transforma o balde num depósito de arquivo arbitrário servido do domínio
  // da empresa.
  if (contentType !== 'application/pdf') {
    throw HttpProblem.badRequest('O documento precisa ser um PDF.');
  }
  return sign(env, documentKey(collection, tenantId, id, filename), 'PUT', contentType);
}

export function downloadTicket(env: BaseBindings, key: string): Promise<DocumentTicket> {
  return sign(env, key, 'GET');
}
