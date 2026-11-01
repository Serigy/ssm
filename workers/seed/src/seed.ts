import { argon2id } from '@noble/hashes/argon2';
import { computeAvailabilityBps, computeSlaCredit } from '@ssm/contracts';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Semeadura do D1.
 *
 * Gera SQL e o aplica com `wrangler d1 execute`. Gerar o arquivo em vez de
 * inserir direto tem duas razões: o mesmo SQL serve para local e para
 * homologação, e ele fica legível para revisão antes de tocar num banco que não
 * seja o da máquina de quem desenvolve.
 *
 * O hash da senha é calculado aqui com a mesma implementação que o Worker usa
 * para conferir. Usar o argon2 nativo do Node produziria um hash com parâmetros
 * diferentes que o Worker recusaria — foi assim que a primeira versão falhou.
 */
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');

const TENANT = '00000000-0000-4000-8000-0000000000ff';
const USERS = {
  admin: '00000000-0000-4000-8000-000000000001',
  controller: '00000000-0000-4000-8000-000000000002',
  hrManager: '00000000-0000-4000-8000-000000000003',
  counsel: '00000000-0000-4000-8000-000000000004',
  oncall: '00000000-0000-4000-8000-000000000005',
};
const DEMO_PASSWORD = 'serigy-desenvolvimento-2026';

/** Mesmos parâmetros de workers/identity/src/passwords.ts. */
const PARAMS = { t: 2, m: 19_456, p: 1, dkLen: 32 } as const;

function hashPassword(plain: string): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const digest = argon2id(plain, salt, PARAMS);
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=${PARAMS.m},t=${PARAMS.t},p=${PARAMS.p}$${b64(salt)}$${b64(digest)}`;
}

const q = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

function identitySql(): string {
  const hash = hashPassword(DEMO_PASSWORD);
  const people: Array<[string, string, string, string[]]> = [
    [USERS.admin, 'admin@serigy.local', 'Administração da Plataforma', ['platform:admin']],
    [USERS.controller, 'financeiro@serigy.local', 'Controladoria', ['financial:controller']],
    [USERS.hrManager, 'pessoas@serigy.local', 'Gestão de Pessoas', ['hr:manager']],
    [USERS.counsel, 'juridico@serigy.local', 'Jurídico', ['legal:counsel']],
    [USERS.oncall, 'plantao@serigy.local', 'Plantão de Sustentação', ['operations:oncall']],
  ];

  // Um hash por pessoa: hashes iguais em contas diferentes revelam que as senhas
  // são iguais a quem lê o banco, e isso não deve ser verdade nem no ambiente de
  // desenvolvimento, onde o hábito se forma.
  const rows = people
    .map(
      ([id, email, name, roles]) =>
        `  (${q(id)}, ${q(TENANT)}, ${q(email)}, ${q(hashPassword(DEMO_PASSWORD))}, ` +
        `${q(name)}, 'active', ${q(JSON.stringify(roles))})`,
    )
    .join(',\n');

  return [
    '-- Gerado por workers/seed. Não editar à mão.',
    'DELETE FROM refresh_tokens;',
    'DELETE FROM users;',
    'INSERT INTO users (id, tenant_id, email, password_hash, display_name, status, roles) VALUES',
    `${rows};`,
    `-- senha de todos: ${DEMO_PASSWORD} (hash ${hash.slice(0, 30)}…)`,
    '',
  ].join('\n');
}


// --- financeiro -------------------------------------------------------------

function financialSql(): string {
  const invoices = [
    { id: 'a0000000-0000-4000-8000-000000000001', number: 'FAT-2026-00001', status: 'issued',
      name: 'Prefeitura de Aracaju', total: 1_250_000, paid: 0, due: '2026-09-15' },
    { id: 'a0000000-0000-4000-8000-000000000002', number: 'FAT-2026-00002', status: 'paid',
      name: 'Grupo Sergipe Varejo', total: 480_000, paid: 480_000, due: '2026-08-01' },
    { id: 'a0000000-0000-4000-8000-000000000003', number: null, status: 'draft',
      name: 'Cooperativa Vale do São Francisco', total: 2_100_000, paid: 0, due: '2026-10-30' },
  ];

  const lines: string[] = ['DELETE FROM invoice_lines;', 'DELETE FROM invoices;'];
  for (const inv of invoices) {
    const issue = inv.status === 'draft' ? 'NULL' : q('2026-08-01');
    lines.push(
      `INSERT INTO invoices (id, tenant_id, number, status, counterparty_id, counterparty_name,
         issue_date, due_date, currency, subtotal_minor, tax_total_minor, total_minor,
         amount_paid_minor, created_by, updated_by)
       VALUES (${q(inv.id)}, ${q(TENANT)}, ${inv.number ? q(inv.number) : 'NULL'}, ${q(inv.status)},
         ${q(crypto.randomUUID())}, ${q(inv.name)}, ${issue}, ${q(inv.due)}, 'BRL',
         ${inv.total}, 0, ${inv.total}, ${inv.paid}, ${q(USERS.controller)}, ${q(USERS.controller)});`,
    );
    lines.push(
      `INSERT INTO invoice_lines (id, invoice_id, position, description, quantity_milli,
         unit_price_minor, tax_rate_bps, line_total_minor)
       VALUES (${q(crypto.randomUUID())}, ${q(inv.id)}, 0,
         'Sustentação de ambiente — mensalidade', 1000, ${inv.total}, 0, ${inv.total});`,
    );
  }
  return header('financial') + lines.join('\n') + '\n';
}

// --- pessoas ----------------------------------------------------------------

function hrSql(): string {
  const dept = 'b0000000-0000-4000-8000-0000000000d1';
  const employees = [
    { id: 'b0000000-0000-4000-8000-000000000001', num: 'COL-00001', first: 'Marina', last: 'Rocha',
      title: 'Engenheira de plataforma', status: 'active', start: '2024-03-04', salary: 1_450_000 },
    { id: 'b0000000-0000-4000-8000-000000000002', num: 'COL-00002', first: 'Tiago', last: 'Menezes',
      title: 'Analista de sustentação', status: 'active', start: '2025-01-13', salary: 980_000 },
    { id: 'b0000000-0000-4000-8000-000000000003', num: 'COL-00003', first: 'Beatriz', last: 'Correia',
      title: 'Analista de marketing', status: 'onboarding', start: '2026-09-01', salary: 760_000 },
  ];

  const lines = [
    'DELETE FROM employees;',
    'DELETE FROM departments;',
    `INSERT INTO departments (id, tenant_id, name, created_by, updated_by)
     VALUES (${q(dept)}, ${q(TENANT)}, 'Tecnologia', ${q(USERS.hrManager)}, ${q(USERS.hrManager)});`,
  ];
  for (const e of employees) {
    const email = `${e.first.toLowerCase()}.${e.last.toLowerCase()}@serigy.local`;
    lines.push(
      `INSERT INTO employees (id, tenant_id, employee_number, first_name, last_name, work_email,
         status, contract_type, job_title, department_id, start_date, salary_minor,
         salary_currency, created_by, updated_by)
       VALUES (${q(e.id)}, ${q(TENANT)}, ${q(e.num)}, ${q(e.first)}, ${q(e.last)}, ${q(email)},
         ${q(e.status)}, 'permanent', ${q(e.title)}, ${q(dept)}, ${q(e.start)}, ${e.salary},
         'BRL', ${q(USERS.hrManager)}, ${q(USERS.hrManager)});`,
    );
  }
  return header('hr') + lines.join('\n') + '\n';
}

// --- jurídico ---------------------------------------------------------------

function legalSql(): string {
  // Propositalmente perto da janela de aviso, para a tela de vencimentos ter o
  // que mostrar num ambiente recém-criado.
  const soon = new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10);

  const clauses = [
    { id: 'cl-1', ordinal: '1', heading: 'Objeto',
      body: 'Sustentação 24×7 dos ambientes de produção e homologação, com plantão a partir do segundo mês.',
      risk: null, tags: [], children: [] },
    { id: 'cl-2', ordinal: '2', heading: 'Nível de serviço',
      body: 'Disponibilidade mensal mínima de 99,5%, apurada por ambiente.',
      risk: 'high', tags: ['sla'],
      children: [
        { id: 'cl-2-1', ordinal: '2.1', heading: 'Penalidade',
          body: 'Desconto de 5% da mensalidade a cada 0,5% abaixo do mínimo, limitado a 20%.',
          risk: 'high', tags: ['sla', 'penalidade'], children: [] },
      ] },
  ];
  const obligations = [
    { id: 'ob-1', clauseId: 'cl-2', description: 'Enviar relatório mensal de disponibilidade',
      owner: 'us', dueDate: null, recurrence: 'monthly', amount: null, fulfilled: false },
  ];
  const partiesA = [
    { id: 'p1', name: 'Serigy Tecnologia e Marketing', role: 'first_party', externalRef: null },
    { id: 'p2', name: 'Prefeitura de Aracaju', role: 'counterparty', externalRef: null },
  ];
  const partiesB = [
    { id: 'p1', name: 'Serigy Tecnologia e Marketing', role: 'first_party', externalRef: null },
    { id: 'p2', name: 'Grupo Sergipe Varejo', role: 'counterparty', externalRef: null },
  ];

  return (
    header('legal') +
    [
      'DELETE FROM contract_versions;',
      'DELETE FROM contracts;',
      `INSERT INTO contracts (id, tenant_id, reference, title, kind, status, parties,
         governing_law, jurisdiction, effective_from, effective_to, renewal_notice_days,
         auto_renew, value_minor, value_currency, risk, tags, current_version,
         clauses, obligations, created_by, updated_by)
       VALUES ('c0000000-0000-4000-8000-000000000001', ${q(TENANT)}, 'SER-2026-0001',
         'Sustentação de infraestrutura — Prefeitura de Aracaju', 'service_agreement', 'active',
         ${q(JSON.stringify(partiesA))}, 'Lei nº 14.133/2021', 'Aracaju, SE',
         '2026-01-01', ${q(soon)}, 30, 0, 15000000, 'BRL', 'medium',
         ${q(JSON.stringify(['sustentação', 'setor público']))}, 1,
         ${q(JSON.stringify(clauses))}, ${q(JSON.stringify(obligations))},
         ${q(USERS.counsel)}, ${q(USERS.counsel)});`,
      `INSERT INTO contracts (id, tenant_id, reference, title, kind, status, parties,
         governing_law, jurisdiction, renewal_notice_days, auto_renew, risk, tags,
         current_version, clauses, obligations, created_by, updated_by)
       VALUES ('c0000000-0000-4000-8000-000000000002', ${q(TENANT)}, 'NDA-2026-0001',
         'Acordo de confidencialidade — Grupo Sergipe Varejo', 'nda', 'in_review',
         ${q(JSON.stringify(partiesB))}, 'Código Civil', 'Aracaju, SE', 30, 0, 'low',
         ${q(JSON.stringify(['confidencialidade']))}, 1, '[]', '[]',
         ${q(USERS.counsel)}, ${q(USERS.counsel)});`,
    ].join('\n') +
    '\n'
  );
}

// --- operações --------------------------------------------------------------

function operationsSql(): string {
  const envs = [
    { id: 'd0000000-0000-4000-8000-000000000001', code: 'amb-prod-01',
      name: 'Produção — Prefeitura de Aracaju', kind: 'production', target: 9950,
      ref: 'SER-2026-0001', tags: ['sustentação', 'setor público'] },
    { id: 'd0000000-0000-4000-8000-000000000002', code: 'amb-hom-01',
      name: 'Homologação — Prefeitura de Aracaju', kind: 'staging', target: 9500,
      ref: 'SER-2026-0001', tags: ['sustentação'] },
    { id: 'd0000000-0000-4000-8000-000000000003', code: 'amb-dados-01',
      name: 'Plataforma de dados — Grupo Sergipe Varejo', kind: 'data', target: 9900,
      ref: null, tags: ['dados', 'bi'] },
  ];

  const lines = ['DELETE FROM sla_periods;', 'DELETE FROM tickets;', 'DELETE FROM environments;'];
  for (const e of envs) {
    lines.push(
      `INSERT INTO environments (id, tenant_id, code, name, kind, status, region, provider,
         contract_ref, availability_target_bps, tags, created_by, updated_by)
       VALUES (${q(e.id)}, ${q(TENANT)}, ${q(e.code)}, ${q(e.name)}, ${q(e.kind)}, 'operational',
         'sa-east-1', 'AWS', ${e.ref ? q(e.ref) : 'NULL'}, ${e.target},
         ${q(JSON.stringify(e.tags))}, ${q(USERS.oncall)}, ${q(USERS.oncall)});`,
    );
  }

  // Um chamado em cada estado que quem está de plantão precisa distinguir.
  const now = Date.now();
  const tickets = [
    { num: 4818, subject: 'Latência acima do limite em amb-dados-01', sev: 'sev2',
      status: 'in_progress', env: envs[2]!, agoMin: 95, responded: true },
    { num: 4821, subject: 'Revisar regra de alerta de disco', sev: 'sev3',
      status: 'waiting_customer', env: envs[1]!, agoMin: 400, responded: true },
    { num: 4822, subject: 'Certificado TLS vence em 7 dias', sev: 'sev3',
      status: 'open', env: envs[0]!, agoMin: 20, responded: false },
  ];

  for (const t of tickets) {
    const opened = new Date(now - t.agoMin * 60_000);
    const dueMin = t.sev === 'sev1' ? 15 : t.sev === 'sev2' ? 60 : 480;
    const timeline = [
      { at: opened.toISOString(), actorId: null, kind: 'created',
        note: `Chamado aberto com severidade ${t.sev}.` },
    ];
    lines.push(
      `INSERT INTO tickets (id, tenant_id, number, subject, description, severity, status,
         environment_id, environment_code, opened_at, first_response_at, response_due_at,
         response_breached, waiting_since, timeline, created_by, updated_by)
       VALUES (${q(crypto.randomUUID())}, ${q(TENANT)}, ${t.num}, ${q(t.subject)},
         'Registrado pelo monitoramento.', ${q(t.sev)}, ${q(t.status)}, ${q(t.env.id)},
         ${q(t.env.code)}, ${q(opened.toISOString())},
         ${t.responded ? q(new Date(opened.getTime() + 8 * 60_000).toISOString()) : 'NULL'},
         ${q(new Date(opened.getTime() + dueMin * 60_000).toISOString())},
         ${!t.responded && t.agoMin > dueMin ? 1 : 0},
         ${t.status === 'waiting_customer' ? q(new Date(now - 60 * 60_000).toISOString()) : 'NULL'},
         ${q(JSON.stringify(timeline))}, ${q(USERS.oncall)}, ${q(USERS.oncall)});`,
    );
  }

  /**
   * Um incidente resolvido no mês anterior mais a sua apuração, para a tela de
   * SLA ter conteúdo num ambiente novo em vez do estado vazio.
   *
   * Os números saem das MESMAS computeAvailabilityBps e computeSlaCredit que o
   * Worker usa — fixá-los aqui à mão seria uma segunda implementação de um
   * número que termina numa fatura, que é exatamente o que pô-los em
   * @ssm/contracts existe para impedir.
   */
  const prod = envs[0]!;
  const outageStart = new Date(Date.UTC(2026, 6, 14, 2, 0, 0));
  const outageEnd = new Date(Date.UTC(2026, 6, 14, 14, 0, 0));
  const downtime = Math.round((outageEnd.getTime() - outageStart.getTime()) / 60_000);

  lines.push(
    `INSERT INTO tickets (id, tenant_id, number, subject, description, severity, status,
       environment_id, environment_code, opened_at, first_response_at, resolved_at, closed_at,
       response_due_at, response_breached, timeline, created_by, updated_by)
     VALUES (${q(crypto.randomUUID())}, ${q(TENANT)}, 4790,
       'Indisponibilidade prolongada do cluster',
       'Perda de quórum no cluster de banco. Restabelecido após reconstrução do nó.',
       'sev1', 'closed', ${q(prod.id)}, ${q(prod.code)}, ${q(outageStart.toISOString())},
       ${q(new Date(outageStart.getTime() + 11 * 60_000).toISOString())},
       ${q(outageEnd.toISOString())}, ${q(outageEnd.toISOString())},
       ${q(new Date(outageStart.getTime() + 15 * 60_000).toISOString())}, 0, '[]',
       ${q(USERS.oncall)}, ${q(USERS.oncall)});`,
  );

  const julyMinutes = 31 * 24 * 60;
  const achievedBps = computeAvailabilityBps(julyMinutes, downtime);
  const monthlyFeeMinor = 1_500_000;
  const creditMinor = computeSlaCredit(achievedBps, prod.target, monthlyFeeMinor);

  lines.push(
    `INSERT INTO sla_periods (id, tenant_id, environment_id, environment_code, month,
       measured_minutes, downtime_minutes, achieved_bps, target_bps, breached,
       credit_minor, credit_currency)
     VALUES (${q(crypto.randomUUID())}, ${q(TENANT)}, ${q(prod.id)}, ${q(prod.code)}, '2026-07-01',
       ${julyMinutes}, ${downtime}, ${achievedBps}, ${prod.target}, ${creditMinor > 0 ? 1 : 0},
       ${creditMinor > 0 ? creditMinor : 'NULL'}, ${creditMinor > 0 ? "'BRL'" : 'NULL'});`,
  );

  return header('operations') + lines.join('\n') + '\n';
}

function header(module: string): string {
  return `-- ${module} · gerado por workers/seed. Não editar à mão.\n`;
}

const MODULES: Record<string, () => string> = {
  identity: identitySql,
  financial: financialSql,
  hr: hrSql,
  legal: legalSql,
  operations: operationsSql,
};


const target = process.argv[2] ?? 'identity';
const remote = process.argv.includes('--remote');
const envName = process.argv.includes('--hmg') ? 'hmg' : process.argv.includes('--prd') ? 'prd' : 'dev';

const build = MODULES[target];
if (!build) {
  console.error(`Módulo desconhecido: ${target}. Disponíveis: ${Object.keys(MODULES).join(', ')}`);
  process.exit(1);
}

/**
 * Semear com o Worker no ar mata o Worker.
 *
 * O estado do Miniflare é um SQLite compartilhado pelos seis (ver
 * scripts/cf-dev.sh). Abrir o mesmo arquivo por fora, enquanto o `workerd` o
 * segura, produz `SQLITE_BUSY: database is locked` — e não é um erro que o
 * Worker trate: o runtime cai inteiro, com "The Workers runtime failed to
 * start". Aconteceu, e o sintoma enganou: quatro testes de navegador falharam
 * como se fossem dado sujo, quando o módulo simplesmente não estava no ar.
 *
 * Conferir a porta antes é mais barato que descobrir depois.
 */
const PORTAS: Record<string, number> = {
  identity: 8801, financial: 8802, hr: 8803, legal: 8804, operations: 8805,
};

async function noAr(porta: number): Promise<boolean> {
  try {
    await fetch(`http://localhost:${porta}/health/ready`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

if (!remote && envName === 'dev' && (await noAr(PORTAS[target]!))) {
  console.error(
    `O Worker de ${target} está no ar na porta ${PORTAS[target]}.\n` +
      `Semear agora trava o SQLite e derruba o runtime. Pare antes:\n\n` +
      `  ./scripts/cf-dev.sh stop ${target}\n` +
      `  pnpm --filter @ssm/worker-seed seed ${target}\n` +
      `  ./scripts/cf-dev.sh start ${target}\n`,
  );
  process.exit(1);
}

const outDir = join(root, 'workers/seed/generated');
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `${target}.sql`);
writeFileSync(file, build());
console.log(`SQL gerado em ${file.replace(root + '/', '')}`);

const database = envName === 'prd' ? `ssm-${target}` : `ssm-${target}-${envName}`;
const args = ['wrangler', 'd1', 'execute', database, remote ? '--remote' : '--local', '--file', file];
// O estado local é comum aos seis Workers — ver o comentário em package.json.
if (!remote) args.push('--persist-to', '../.wrangler-state');
if (envName !== 'dev') args.push('--env', envName);

if (remote && envName === 'prd') {
  console.error('Semear produção não é operação de ferramenta. Recusado.');
  process.exit(1);
}

execFileSync('npx', args, { cwd: join(root, `workers/${target}`), stdio: 'inherit' });
console.log(`${target} semeado em ${database}.`);
