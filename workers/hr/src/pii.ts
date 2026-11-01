import type { BaseBindings } from '@ssm/worker-common';

/**
 * Cifra do CPF em repouso.
 *
 * No Postgres isto era `pgp_sym_encrypt`, uma função do banco. O SQLite não tem
 * equivalente, então a cifra sobe para o Worker — e isso é melhoria, não perda:
 * a chave deixa de trafegar como parâmetro de consulta, onde acabava em
 * `pg_stat_statements` e em log de consulta lenta se alguém ligasse um dos dois.
 *
 * Formato gravado: base64 de nonce (12 bytes) concatenado ao texto cifrado, que
 * já inclui a etiqueta de autenticação do GCM. Um byte alterado no banco faz a
 * decifra falhar em vez de devolver lixo silenciosamente.
 */
const NONCE_BYTES = 12;

let cachedKey: CryptoKey | undefined;
let cachedRaw: string | undefined;

async function key(env: BaseBindings): Promise<CryptoKey> {
  const raw = env.PII_ENCRYPTION_KEY;
  if (!raw) throw new Error('PII_ENCRYPTION_KEY ausente: só o Worker de pessoas a recebe.');
  if (cachedKey && cachedRaw === raw) return cachedKey;

  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) {
    throw new Error(`PII_ENCRYPTION_KEY deve ter 32 bytes em base64, veio com ${bytes.length}.`);
  }
  cachedKey = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
  cachedRaw = raw;
  return cachedKey;
}

export async function encryptPii(env: BaseBindings, plain: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce },
      await key(env),
      new TextEncoder().encode(plain),
    ),
  );
  const joined = new Uint8Array(nonce.length + cipher.length);
  joined.set(nonce);
  joined.set(cipher, nonce.length);
  return btoa(String.fromCharCode(...joined));
}

/**
 * Devolve `null` quando a decifra falha, em vez de lançar.
 *
 * Um registro cujo CPF não decifra — chave rotacionada sem migrar, byte
 * corrompido — não deve derrubar a tela inteira de quem só queria ver o nome e
 * o cargo. O campo aparece ausente, que é o mesmo que o chamador sem permissão
 * vê, e o problema fica no log com o id do registro.
 */
export async function decryptPii(
  env: BaseBindings,
  stored: string | null,
  employeeId: string,
): Promise<string | null> {
  if (!stored) return null;
  try {
    const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, NONCE_BYTES) },
      await key(env),
      bytes.slice(NONCE_BYTES),
    );
    return new TextDecoder().decode(plain);
  } catch {
    console.error(JSON.stringify({ event: 'hr.pii.decrypt_failed', employeeId }));
    return null;
  }
}
