#!/usr/bin/env node
// Cria ou atualiza o papel de um módulo (ssm_<módulo>) no Postgres.
//
//   NEON_MIGRATION_URL=... NEON_IDENTITY_URL=... node roles.mjs identity     # CI
//   node roles.mjs --url-file secrets/local/neon_development_url \
//        --role-url-file identity=secrets/local/neon_identity_url
//
// A senha do papel mora na URL do próprio papel (neon_<módulo>_url), que é
// também o que o Hyperdrive usa. Este script a extrai dali: existe uma só fonte
// da senha, e ela nunca é digitada, impressa nem passada na linha de comando.
//
// Rode ANTES de apply.mjs: a migração só concede acesso a papel que já existe.
// Idempotente — rodar de novo apenas reafirma senha e atributos.
//
// O papel nasce sem nenhum privilégio além de LOGIN. Os GRANTs de cada tabela
// estão na migração do módulo, onde são revisados junto com o esquema.
import { readFileSync } from 'node:fs';
import { readUrl, redact, withClient } from './connection.mjs';

const argv = process.argv.slice(2);

function roleUrl(module) {
  const i = argv.indexOf('--role-url-file');
  if (i !== -1) {
    const [m, file] = (argv[i + 1] ?? '').split('=');
    if (m === module && file) return readFileSync(file, 'utf8').trim();
  }
  const fromEnv = process.env[`NEON_${module.toUpperCase()}_URL`];
  if (fromEnv) return fromEnv.trim();
  throw new Error(
    `Sem a URL do papel de ${module}: use --role-url-file ${module}=<arquivo> ou NEON_${module.toUpperCase()}_URL.`,
  );
}

let adminUrl;
try {
  adminUrl = readUrl({ envName: 'NEON_MIGRATION_URL', argv });
} catch (err) {
  console.error(err.message);
  process.exit(2);
}

const modules = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!modules.length) {
  console.error('Informe o(s) módulo(s): node roles.mjs identity');
  process.exit(2);
}

try {
  await withClient(adminUrl, async (client) => {
    for (const module of modules) {
      if (!/^[a-z][a-z0-9_]*$/.test(module)) throw new Error(`Módulo inválido: ${module}`);
      const u = new URL(roleUrl(module));
      const role = decodeURIComponent(u.username);
      const password = decodeURIComponent(u.password);
      if (role !== `ssm_${module}`) {
        throw new Error(`A URL de ${module} deveria usar o papel ssm_${module}.`);
      }
      if (password.length < 24) throw new Error(`Senha de ssm_${module} curta demais.`);

      // format() com %I e %L devolve o DDL já escapado pelo próprio servidor.
      // Evita montar SQL com a senha em JavaScript — e o DDL não é registrado
      // em lugar nenhum daqui.
      const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rows.length > 0;
      // Os atributos de privilégio só são dados na criação. Repeti-los num ALTER
      // foi recusado no Neon com "permission denied to alter role" (medido; a
      // causa provável é que o dono do banco não tem poder sobre todos eles,
      // mesmo para desligá-los). O ALTER troca só a senha.
      const attrs = exists ? '' : ' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION';
      const verb = exists ? 'ALTER ROLE' : 'CREATE ROLE';
      const ddl = (
        await client.query(
          `SELECT format('${verb} %I WITH LOGIN PASSWORD %L${attrs}', $1::text, $2::text) AS ddl`,
          [role, password],
        )
      ).rows[0].ddl;
      await client.query(ddl);
      // Sem isto o SQL do Worker teria de qualificar toda tabela, e o papel
      // não encontraria nada no schema public, que ele nem deve usar.
      await client.query(
        (
          await client.query(`SELECT format('ALTER ROLE %I SET search_path = %I', $1::text, $2::text) AS ddl`, [role, module])
        ).rows[0].ddl,
      );
      console.log(`${role}: ${exists ? 'atualizado' : 'criado'}`);
    }
  });
} catch (err) {
  console.error('Falha ao configurar papel:', redact(err instanceof Error ? err.message : err, adminUrl));
  process.exit(1);
}
