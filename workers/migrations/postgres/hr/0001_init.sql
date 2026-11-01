-- hr · Postgres (Neon)
--
-- Tradução de workers/migrations/hr/0001_init.sql (D1). Diferenças, e só estas:
--
--   datas civis        TEXT -> date (nascimento, admissão, último dia). O driver
--                      as devolve como 'AAAA-MM-DD', o mesmo texto do D1.
--   carimbos           TEXT ISO -> timestamptz(3). Três casas, como o ISO do D1:
--                      o cursor de paginação é um carimbo em milissegundos, e
--                      com microssegundos guardados a comparação do cursor
--                      pularia linhas.
--   salário            INTEGER -> bigint (menor unidade) + char(3) ISO-4217.
--   address, payload   TEXT com json_valid -> jsonb.
--   busca              FTS5 e seus gatilhos -> coluna tsvector gerada + GIN.
--
-- O CPF continua cifrado pelo Worker (AES-GCM) antes de chegar aqui. O banco
-- nunca o recebe em claro, e o CHECK abaixo recusa um valor com cara de CPF,
-- mesmo que alguém grave por fora do Worker.

CREATE SCHEMA IF NOT EXISTS hr;

CREATE TABLE hr.departments (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL,
  name              text NOT NULL,
  parent_id         text REFERENCES hr.departments(id) ON DELETE SET NULL,
  head_employee_id  text,
  created_at        timestamptz(3) NOT NULL DEFAULT now(),
  created_by        text,
  updated_at        timestamptz(3) NOT NULL DEFAULT now(),
  updated_by        text
);
CREATE INDEX departments_tenant_idx ON hr.departments (tenant_id);

CREATE TABLE hr.employees (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL,
  employee_number  text NOT NULL,
  user_id          text,
  first_name       text NOT NULL,
  last_name        text NOT NULL,
  work_email       text NOT NULL,
  personal_email   text,
  phone            text,
  date_of_birth    date,
  -- AES-GCM no Worker: nonce || ciphertext, em base64.
  national_id_enc  text,
  address          jsonb,
  status           text NOT NULL DEFAULT 'onboarding',
  contract_type    text NOT NULL,
  job_title        text NOT NULL,
  department_id    text REFERENCES hr.departments(id) ON DELETE SET NULL,
  manager_id       text REFERENCES hr.employees(id) ON DELETE SET NULL,
  start_date       date NOT NULL,
  end_date         date,
  salary_minor     bigint,
  salary_currency  char(3),
  document_key     text,
  created_at       timestamptz(3) NOT NULL DEFAULT now(),
  created_by       text,
  updated_at       timestamptz(3) NOT NULL DEFAULT now(),
  updated_by       text,

  -- Texto de busca: minúsculas, sem acento e sem pontuação, para que
  -- "alvaro" ache "Álvaro" e "serigy" ache o domínio do e-mail. translate() é
  -- imutável, o que a coluna gerada exige; unaccent() não é.
  search           tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', lower(translate(
      first_name || ' ' || last_name || ' ' || work_email || ' ' || employee_number,
      'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ@._-',
      'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn    '
    )))
  ) STORED,

  CONSTRAINT employees_status_ck CHECK (
    status IN ('applicant','onboarding','active','on_leave','offboarding','terminated')),
  -- Salário sem moeda não significa nada, e vice-versa.
  CONSTRAINT employees_salary_pair_ck CHECK ((salary_minor IS NULL) = (salary_currency IS NULL)),
  -- Um desligado tem que ter último dia registrado.
  CONSTRAINT employees_terminated_end_ck CHECK (status <> 'terminated' OR end_date IS NOT NULL),
  CONSTRAINT employees_dates_ck CHECK (end_date IS NULL OR end_date >= start_date),
  -- Só cifra entra: base64 de nonce(12) + etiqueta(16) + texto(>=1) tem 40
  -- caracteres ou mais. Um CPF em claro tem 11 a 14 e é recusado.
  CONSTRAINT employees_national_id_cipher_ck CHECK (
    national_id_enc IS NULL
    OR (length(national_id_enc) >= 40 AND national_id_enc ~ '^[A-Za-z0-9+/]+={0,2}$'))
);

CREATE UNIQUE INDEX employees_tenant_number_uq ON hr.employees (tenant_id, employee_number);
CREATE UNIQUE INDEX employees_tenant_email_uq ON hr.employees (tenant_id, lower(work_email));
CREATE INDEX employees_tenant_status_idx ON hr.employees (tenant_id, status);
CREATE INDEX employees_tenant_cursor_idx ON hr.employees (tenant_id, created_at DESC, id DESC);
CREATE INDEX employees_search_idx ON hr.employees USING gin (search);

CREATE TABLE hr.outbox (
  id              text PRIMARY KEY,
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  tenant_id       text NOT NULL,
  actor_id        text,
  correlation_id  text NOT NULL,
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  published_at    timestamptz(3),
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,

  CONSTRAINT outbox_attempts_ck CHECK (attempts >= 0)
);
CREATE INDEX outbox_unpublished_idx ON hr.outbox (created_at) WHERE published_at IS NULL;

-- Acesso do papel do módulo, tabela a tabela (nunca schema_migrations).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ssm_hr') THEN
    GRANT USAGE ON SCHEMA hr TO ssm_hr;
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON hr.departments, hr.employees, hr.outbox TO ssm_hr;
    ALTER DEFAULT PRIVILEGES IN SCHEMA hr
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ssm_hr;
  END IF;
END
$$;
