import { argon2id } from '@noble/hashes/argon2';

/**
 * Argon2id em JavaScript puro.
 *
 * Duas descobertas mudaram a escolha em relação ao serviço em contêiner:
 *
 *   1. **WASM compilado em tempo de execução é proibido.** A primeira tentativa
 *      usou hash-wasm, que traz o módulo embutido em base64 e chama
 *      `WebAssembly.compile()`. O workerd recusa: "Wasm code generation
 *      disallowed by embedder". Só entra WASM importado estaticamente no
 *      bundle. Uma implementação em JS puro resolve e não depende disso.
 *
 *   2. **64 MiB não cabe.** Os parâmetros do serviço em contêiner (m=64 MiB,
 *      t=3) medidos aqui dentro custam 1637 ms e ocupariam metade dos 128 MiB
 *      que o Worker inteiro tem. Os parâmetros abaixo são o mínimo que a OWASP
 *      documenta para argon2id e custam 394 ms medidos no workerd.
 *
 * A troca é real e está registrada: um atacante com a tabela de hashes tem o
 * trabalho reduzido em relação ao ajuste anterior. O que a compensa é que a
 * política de bloqueio por tentativas continua igual, e o hash carrega os
 * parâmetros — subir o custo depois é mudar estas constantes, sem migração.
 */
const PARAMS = { t: 2, m: 19_456, p: 1, dkLen: 32 } as const;

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = argon2id(plain, salt, PARAMS);
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(digest)}`;
}

/**
 * Confere a senha contra o hash gravado, usando os parâmetros que estão no
 * próprio hash — e não os atuais. É isso que permite subir o custo sem
 * invalidar as senhas de quem já existe.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  const parsed = parse(hash);
  if (!parsed) return false;

  const digest = argon2id(plain, parsed.salt, {
    t: parsed.t,
    m: parsed.m,
    p: parsed.p,
    dkLen: parsed.expected.length,
  });
  return timingSafeEqual(digest, parsed.expected);
}

/** Diz se o hash foi gerado com custo menor que o atual e merece ser refeito. */
export function needsRehash(hash: string): boolean {
  const parsed = parse(hash);
  return !parsed || parsed.m < PARAMS.m || parsed.t < PARAMS.t;
}

interface ParsedHash {
  m: number;
  t: number;
  p: number;
  salt: Uint8Array;
  expected: Uint8Array;
}

function parse(hash: string): ParsedHash | null {
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([^$]+)\$([^$]+)$/.exec(hash);
  if (!m) return null;
  try {
    return {
      m: Number(m[1]),
      t: Number(m[2]),
      p: Number(m[3]),
      salt: unb64(m[4]!),
      expected: unb64(m[5]!),
    };
  } catch {
    return null;
  }
}

/**
 * Comparação de tempo constante.
 *
 * Sair no primeiro byte diferente vaza, pelo tempo de resposta, quantos bytes
 * do digest o atacante já acertou — e um digest pode ser reconstruído byte a
 * byte a partir disso.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Argon2 usa base64 sem preenchimento. */
function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '');
}
function unb64(value: string): Uint8Array {
  const bin = atob(value + '='.repeat((4 - (value.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
