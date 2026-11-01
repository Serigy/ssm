-- hr · D1
--
-- O CPF era cifrado pelo pgcrypto dentro do banco. O D1 não tem extensões, então
-- a cifragem passa para o Worker, com WebCrypto (AES-GCM) e a chave em
-- `wrangler secret`. Na prática é melhor: a chave deixa de existir no banco, e
-- um dump do D1 passa a não conter nada decifrável nem em teoria.
--
-- O custo é que a coluna deixa de ser pesquisável, o que já era verdade.

PRAGMA foreign_keys = ON;

CREATE TABLE departments (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  name              TEXT NOT NULL,
  parent_id         TEXT REFERENCES departments(id) ON DELETE SET NULL,
  head_employee_id  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by        TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by        TEXT
);
CREATE INDEX departments_tenant_idx ON departments (tenant_id);

CREATE TABLE employees (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL,
  employee_number  TEXT NOT NULL,
  user_id          TEXT,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  work_email       TEXT NOT NULL,
  personal_email   TEXT,
  phone            TEXT,
  date_of_birth    TEXT,
  -- AES-GCM no Worker: nonce || ciphertext, em base64.
  national_id_enc  TEXT,
  address          TEXT,                    -- JSON
  status           TEXT NOT NULL DEFAULT 'onboarding',
  contract_type    TEXT NOT NULL,
  job_title        TEXT NOT NULL,
  department_id    TEXT REFERENCES departments(id) ON DELETE SET NULL,
  manager_id       TEXT REFERENCES employees(id) ON DELETE SET NULL,
  start_date       TEXT NOT NULL,
  end_date         TEXT,
  salary_minor     INTEGER,
  salary_currency  TEXT,
  document_key     TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by       TEXT,
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       TEXT,

  CHECK (status IN ('applicant','onboarding','active','on_leave','offboarding','terminated')),
  -- Salário sem moeda não significa nada, e vice-versa.
  CHECK ((salary_minor IS NULL) = (salary_currency IS NULL)),
  -- Um desligado tem que ter último dia registrado.
  CHECK (status <> 'terminated' OR end_date IS NOT NULL),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (address IS NULL OR json_valid(address))
);

CREATE UNIQUE INDEX employees_tenant_number_uq ON employees (tenant_id, employee_number);
CREATE UNIQUE INDEX employees_tenant_email_uq ON employees (tenant_id, lower(work_email));
CREATE INDEX employees_tenant_status_idx ON employees (tenant_id, status);
CREATE INDEX employees_tenant_cursor_idx ON employees (tenant_id, created_at DESC, id DESC);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY, aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, tenant_id TEXT NOT NULL, actor_id TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_at TEXT, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  CHECK (json_valid(payload))
);
CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL;

-- Busca por nome, e-mail e matrícula.
CREATE VIRTUAL TABLE employees_fts USING fts5(
  first_name, last_name, work_email, employee_number,
  content = 'employees', content_rowid = 'rowid',
  tokenize = "unicode61 remove_diacritics 2"
);
CREATE TRIGGER employees_fts_insert AFTER INSERT ON employees BEGIN
  INSERT INTO employees_fts(rowid, first_name, last_name, work_email, employee_number)
    VALUES (new.rowid, new.first_name, new.last_name, new.work_email, new.employee_number);
END;
CREATE TRIGGER employees_fts_delete AFTER DELETE ON employees BEGIN
  INSERT INTO employees_fts(employees_fts, rowid, first_name, last_name, work_email, employee_number)
    VALUES ('delete', old.rowid, old.first_name, old.last_name, old.work_email, old.employee_number);
END;
CREATE TRIGGER employees_fts_update AFTER UPDATE ON employees BEGIN
  INSERT INTO employees_fts(employees_fts, rowid, first_name, last_name, work_email, employee_number)
    VALUES ('delete', old.rowid, old.first_name, old.last_name, old.work_email, old.employee_number);
  INSERT INTO employees_fts(rowid, first_name, last_name, work_email, employee_number)
    VALUES (new.rowid, new.first_name, new.last_name, new.work_email, new.employee_number);
END;
