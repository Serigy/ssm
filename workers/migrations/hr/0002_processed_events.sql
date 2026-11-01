-- Consumo idempotente de eventos.
--
-- A entrega da Cloudflare Queues é ao-menos-uma-vez: o mesmo evento chega duas
-- vezes quando um lote falha parcialmente, quando o Worker morre depois de
-- processar e antes de confirmar, ou quando a repetição é acionada. Sem esta
-- tabela, um `um evento reentregue` reentregue reaplicaria o efeito.
--
-- O `INSERT OR IGNORE` é a trava: quem consegue inserir processa, quem não
-- consegue já foi processado por outra tentativa. Fica no mesmo banco do
-- módulo, então a decisão e o efeito são a mesma transação.
CREATE TABLE processed_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

-- A varredura de faxina usa esta ordem; o id sozinho não ajuda a expirar.
CREATE INDEX processed_events_age_idx ON processed_events (processed_at);
