-- Consumo idempotente de eventos.
--
-- A entrega da Cloudflare Queues é ao-menos-uma-vez: o mesmo evento chega duas
-- vezes quando um lote falha parcialmente, quando o Worker morre depois de
-- processar e antes de confirmar, ou quando a repetição é acionada. Sem esta
-- tabela, um evento reentregue reaplicaria o efeito.
--
-- A trava é a chave primária: `INSERT … ON CONFLICT (event_id) DO NOTHING`
-- (o `INSERT OR IGNORE` do SQLite). Quem consegue inserir — meta.changes = 1 —
-- processa; quem não consegue já foi processado por outra tentativa. Fica no
-- mesmo banco do módulo, então decisão e efeito são a mesma transação.
CREATE TABLE financial.processed_events (
  event_id      text PRIMARY KEY,
  type          text NOT NULL,
  processed_at  timestamptz(3) NOT NULL
);

-- A varredura de faxina usa esta ordem; o id sozinho não ajuda a expirar.
CREATE INDEX processed_events_age_idx ON financial.processed_events (processed_at);

-- Sem GRANT aqui: ALTER DEFAULT PRIVILEGES da 0001 já concede ao ssm_financial
-- as tabelas criadas depois. Por isso roles.mjs roda antes de apply.mjs.
