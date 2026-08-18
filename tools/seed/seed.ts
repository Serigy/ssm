/**
 * Loads the demo dataset.
 *
 * Idempotent: every insert is keyed on a fixed UUID and uses ON CONFLICT DO
 * NOTHING, so running it twice changes nothing and running it against a
 * half-seeded database completes it. That matters because the most common time
 * to run a seed is after something went wrong.
 *
 *   make seed
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { MongoClient } from 'mongodb';
import argon2 from 'argon2';

const SECRETS = process.env.SSM_SECRETS_DIR ?? join(process.cwd(), 'secrets/local');
const secret = (name: string) => readFileSync(join(SECRETS, name), 'utf8').replace(/\r?\n$/, '');

// Fixed ids so the seed is idempotent and so the demo data is referenceable
// from documentation and from tests.
const TENANT = '00000000-0000-4000-8000-0000000000ff';
const USERS = {
  admin: '00000000-0000-4000-8000-000000000001',
  controller: '00000000-0000-4000-8000-000000000002',
  hrManager: '00000000-0000-4000-8000-000000000003',
  counsel: '00000000-0000-4000-8000-000000000004',
};
const DEMO_PASSWORD = 'serigy-desenvolvimento-2026';

const pgBase = {
  host: process.env.POSTGRES_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? 5433),
  user: process.env.POSTGRES_USER ?? 'ssm',
  password: secret('postgres_password'),
};

async function withPg<T>(database: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ ...pgBase, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function seedIdentity(): Promise<void> {
  const hash = await argon2.hash(DEMO_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 4,
  });

  await withPg('ssm_identity', async (c) => {
    const people: Array<[string, string, string, string[]]> = [
      [USERS.admin, 'admin@serigy.local', 'Administração da Plataforma', ['platform:admin']],
      [USERS.controller, 'financeiro@serigy.local', 'Controladoria', ['financial:controller']],
      [USERS.hrManager, 'pessoas@serigy.local', 'Gestão de Pessoas', ['hr:manager']],
      [USERS.counsel, 'juridico@serigy.local', 'Jurídico', ['legal:counsel']],
    ];

    for (const [id, email, name, roles] of people) {
      await c.query(
        `INSERT INTO users (id, tenant_id, email, password_hash, display_name, status, roles)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, TENANT, email, hash, name, roles],
      );
    }
    console.log(`  identity   ${people.length} usuários`);
  });
}

async function seedFinancial(): Promise<void> {
  await withPg('ssm_financial', async (c) => {
    const invoices = [
      { id: 'a0000000-0000-4000-8000-000000000001', number: 'FAT-2026-00001', status: 'issued',
        name: 'Prefeitura de Aracaju', total: 1_250_000, paid: 0, due: '2026-09-15' },
      { id: 'a0000000-0000-4000-8000-000000000002', number: 'FAT-2026-00002', status: 'paid',
        name: 'Grupo Sergipe Varejo', total: 480_000, paid: 480_000, due: '2026-08-01' },
      { id: 'a0000000-0000-4000-8000-000000000003', number: null, status: 'draft',
        name: 'Cooperativa Vale do São Francisco', total: 2_100_000, paid: 0, due: '2026-10-30' },
    ];

    for (const inv of invoices) {
      const issueDate = inv.status === 'draft' ? null : '2026-08-01';
      await c.query(
        `INSERT INTO invoices
           (id, tenant_id, number, status, counterparty_id, counterparty_name,
            issue_date, due_date, currency, subtotal_minor, tax_total_minor,
            total_minor, amount_paid_minor, created_by, updated_by)
         VALUES ($1,$2,$3,$4,gen_random_uuid(),$5,$6,$7,'BRL',$8,0,$8,$9,$10,$10)
         ON CONFLICT (id) DO NOTHING`,
        [inv.id, TENANT, inv.number, inv.status, inv.name, issueDate, inv.due,
         inv.total, inv.paid, USERS.controller],
      );

      await c.query(
        `INSERT INTO invoice_lines
           (invoice_id, position, description, quantity_milli, unit_price_minor,
            tax_rate_bps, line_total_minor)
         VALUES ($1, 0, $2, 1000, $3, 0, $3)
         ON CONFLICT (invoice_id, position) DO NOTHING`,
        [inv.id, 'Sustentação de ambiente — mensalidade', inv.total],
      );
    }
    console.log(`  financial  ${invoices.length} faturas`);
  });
}

async function seedHr(): Promise<void> {
  await withPg('ssm_hr', async (c) => {
    const dept = 'b0000000-0000-4000-8000-0000000000d1';
    await c.query(
      `INSERT INTO departments (id, tenant_id, name, created_by, updated_by)
       VALUES ($1, $2, 'Tecnologia', $3, $3) ON CONFLICT (id) DO NOTHING`,
      [dept, TENANT, USERS.hrManager],
    );

    const employees = [
      { id: 'b0000000-0000-4000-8000-000000000001', num: 'COL-00001', first: 'Marina',
        last: 'Rocha', title: 'Engenheira de plataforma', status: 'active',
        start: '2024-03-04', salary: 1_450_000 },
      { id: 'b0000000-0000-4000-8000-000000000002', num: 'COL-00002', first: 'Tiago',
        last: 'Menezes', title: 'Analista de sustentação', status: 'active',
        start: '2025-01-13', salary: 980_000 },
      { id: 'b0000000-0000-4000-8000-000000000003', num: 'COL-00003', first: 'Beatriz',
        last: 'Correia', title: 'Analista de marketing', status: 'onboarding',
        start: '2026-09-01', salary: 760_000 },
    ];

    for (const e of employees) {
      await c.query(
        `INSERT INTO employees
           (id, tenant_id, employee_number, first_name, last_name, work_email,
            status, contract_type, job_title, department_id, start_date,
            salary_minor, salary_currency, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'permanent',$8,$9,$10,$11,'BRL',$12,$12)
         ON CONFLICT (id) DO NOTHING`,
        [e.id, TENANT, e.num, e.first, e.last,
         `${e.first.toLowerCase()}.${e.last.toLowerCase()}@serigy.local`,
         e.status, e.title, dept, e.start, e.salary, USERS.hrManager],
      );
    }
    console.log(`  hr         ${employees.length} colaboradores, 1 departamento`);
  });
}

async function seedLegal(): Promise<void> {
  const pass = encodeURIComponent(secret('mongo_password'));
  const uri =
    process.env.MONGO_URI ??
    `mongodb://ssm:${pass}@${process.env.MONGO_HOST ?? 'localhost'}:${process.env.MONGO_PORT ?? 27018}/ssm_legal?authSource=admin`;

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const contracts = client.db('ssm_legal').collection('contracts');

    // Deliberately near its notice window, so the expiry scheduler and the
    // "Vencimentos" screen have something to show on a fresh environment.
    const soon = new Date();
    soon.setDate(soon.getDate() + 25);

    const docs = [
      {
        id: 'c0000000-0000-4000-8000-000000000001',
        tenantId: TENANT,
        reference: 'SER-2026-0001',
        title: 'Sustentação de infraestrutura — Prefeitura de Aracaju',
        kind: 'service_agreement',
        status: 'active',
        parties: [
          { id: 'p1', name: 'Serigy Tecnologia e Marketing', role: 'first_party', externalRef: null },
          { id: 'p2', name: 'Prefeitura de Aracaju', role: 'counterparty', externalRef: null },
        ],
        governingLaw: 'Lei nº 14.133/2021',
        jurisdiction: 'Aracaju, SE',
        effectiveFrom: '2026-01-01',
        effectiveTo: soon.toISOString().slice(0, 10),
        renewalNoticeDays: 30,
        autoRenew: false,
        value: { amountMinor: 15_000_000, currency: 'BRL' },
        risk: 'medium',
        tags: ['sustentação', 'setor público'],
        currentVersion: 1,
        clauses: [
          {
            id: 'cl-1', ordinal: '1', heading: 'Objeto',
            body: 'Sustentação 24×7 dos ambientes de produção e homologação, com plantão a partir do segundo mês.',
            risk: null, tags: [], children: [],
          },
          {
            id: 'cl-2', ordinal: '2', heading: 'Nível de serviço',
            body: 'Disponibilidade mensal mínima de 99,5%, apurada por ambiente.',
            risk: 'high', tags: ['sla'],
            children: [
              {
                id: 'cl-2-1', ordinal: '2.1', heading: 'Penalidade',
                body: 'Desconto de 5% da mensalidade a cada 0,5% abaixo do mínimo, limitado a 20%.',
                risk: 'high', tags: ['sla', 'penalidade'], children: [],
              },
            ],
          },
        ],
        obligations: [
          {
            id: 'ob-1', clauseId: 'cl-2', description: 'Enviar relatório mensal de disponibilidade',
            owner: 'us', dueDate: null, recurrence: 'monthly', amount: null, fulfilled: false,
          },
        ],
        versions: [],
        documentKey: null,
        expiryNoticeSentFor: null,
        createdBy: USERS.counsel,
        updatedBy: USERS.counsel,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'c0000000-0000-4000-8000-000000000002',
        tenantId: TENANT,
        reference: 'NDA-2026-0001',
        title: 'Acordo de confidencialidade — Grupo Sergipe Varejo',
        kind: 'nda',
        status: 'in_review',
        parties: [
          { id: 'p1', name: 'Serigy Tecnologia e Marketing', role: 'first_party', externalRef: null },
          { id: 'p2', name: 'Grupo Sergipe Varejo', role: 'counterparty', externalRef: null },
        ],
        governingLaw: 'Código Civil',
        jurisdiction: 'Aracaju, SE',
        effectiveFrom: null,
        effectiveTo: null,
        renewalNoticeDays: 30,
        autoRenew: false,
        value: null,
        risk: 'low',
        tags: ['confidencialidade'],
        currentVersion: 1,
        clauses: [],
        obligations: [],
        versions: [],
        documentKey: null,
        expiryNoticeSentFor: null,
        createdBy: USERS.counsel,
        updatedBy: USERS.counsel,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    for (const doc of docs) {
      await contracts.updateOne(
        { id: doc.id, tenantId: TENANT },
        { $setOnInsert: doc },
        { upsert: true },
      );
    }
    console.log(`  legal      ${docs.length} contratos`);
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  console.log('Carregando dados de demonstração...\n');

  await seedIdentity();
  await seedFinancial();
  await seedHr();
  await seedLegal();

  console.log(`
Pronto. Entre com qualquer um destes e a senha "${DEMO_PASSWORD}":

  admin@serigy.local        acesso total
  financeiro@serigy.local   só o módulo Financeiro
  pessoas@serigy.local      só o módulo Pessoas
  juridico@serigy.local     só o módulo Jurídico

Entrar com um dos três últimos é a forma mais rápida de confirmar que a
filtragem de módulos por permissão está funcionando no shell.
`);
}

main().catch((err: unknown) => {
  console.error('\nFalha ao carregar os dados:', (err as Error).message);
  console.error('\nO ambiente está de pé? Rode "make dev" e tente de novo.');
  process.exit(1);
});
