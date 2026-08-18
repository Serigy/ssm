import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  IconButton,
  Input,
  Panel,
  Select,
  Textarea,
  formatMoney,
} from '@ssm/ui-kit';
import { useHost } from '@ssm/mfe-runtime';
import { computeTotals, type ComputableLine, type CreateInvoice } from '@ssm/contracts';
import { financialApi } from '../api.js';

/**
 * Form state keeps the raw strings the user typed, not parsed numbers.
 *
 * Parsing on every keystroke fights the person typing: "1," becomes 1, the
 * cursor jumps, and a half-entered "10,5" is unrepresentable. The strings are
 * converted once, at submit and for the preview.
 */
interface LineDraft {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

const CURRENCIES = [
  { value: 'BRL', label: 'BRL — Real' },
  { value: 'USD', label: 'USD — Dólar' },
  { value: 'EUR', label: 'EUR — Euro' },
];

const emptyLine = (): LineDraft => ({
  key: crypto.randomUUID(),
  description: '',
  quantity: '1',
  unitPrice: '',
  taxRate: '0',
});

/** "1.234,56" and "1234.56" both mean the same thing to someone typing here. */
function toMinor(input: string): number {
  const normalised = input.trim().replace(/\./g, '').replace(',', '.');
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

/** Quantities travel as thousandths, so 1,5 becomes 1500. */
function toMilli(input: string): number {
  const normalised = input.trim().replace(/\./g, '').replace(',', '.');
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 1000) : 0;
}

/** Percentage to basis points: "21" -> 2100. */
function toBps(input: string): number {
  const normalised = input.trim().replace(',', '.');
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function InvoiceCreateScreen() {
  const { api, notify, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyId, setCounterpartyId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState('BRL');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => setPageTitle('Nova fatura', 'FINANCEIRO'), [setPageTitle]);

  /**
   * The preview uses the SAME computeTotals the service uses — it is exported
   * from @ssm/contracts precisely so the number shown here cannot drift from
   * the number that ends up on the invoice.
   */
  const totals = useMemo(() => {
    const computable: ComputableLine[] = lines.map((l) => ({
      quantityMilli: toMilli(l.quantity),
      unitPrice: { amountMinor: toMinor(l.unitPrice), currency },
      taxRateBps: toBps(l.taxRate),
    }));
    return computeTotals(computable);
  }, [lines, currency]);

  const updateLine = (key: string, patch: Partial<LineDraft>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const filledLines = lines.filter((l) => l.description.trim() && toMinor(l.unitPrice) !== 0);
  const canSubmit = counterpartyName.trim() && dueDate && filledLines.length > 0 && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const dto: CreateInvoice = {
      // A real counterparty picker lands with the customer registry; until then
      // an id may be pasted, and a blank one gets a placeholder so the draft can
      // be created and corrected later.
      counterpartyId: counterpartyId.trim() || '00000000-0000-4000-8000-000000000000',
      counterpartyName: counterpartyName.trim(),
      dueDate,
      currency,
      notes: notes.trim() || undefined,
      lines: filledLines.map((l) => ({
        description: l.description.trim(),
        quantityMilli: toMilli(l.quantity),
        unitPrice: { amountMinor: toMinor(l.unitPrice), currency },
        taxRateBps: toBps(l.taxRate),
      })),
    };

    try {
      const created = await financialApi.create(api, dto);
      notify.success('Rascunho criado', 'Revise os itens e emita quando estiver pronto.');
      navigate(`/financeiro/faturas/${created.id}`);
    } catch (err) {
      const problem = err as { fieldErrors?: Record<string, string[]>; message?: string };
      setFieldErrors(problem.fieldErrors ?? {});
      notify.error(
        'Não foi possível criar a fatura',
        problem.message ?? 'Verifique os campos destacados e tente novamente.',
      );
    } finally {
      setSaving(false);
    }
  }

  const err = (path: string) => fieldErrors[path]?.join('; ');

  return (
    <form className="ssm-stack" onSubmit={submit} noValidate>
      <div className="ssm-toolbar">
        <Button variant="ghost" size="sm" type="button" onClick={() => navigate('/financeiro/faturas')}>
          ← Faturas
        </Button>
      </div>

      <Panel title="Dados da fatura">
        <div className="ssm-form-grid">
          <Input
            label="Contraparte"
            required
            value={counterpartyName}
            onChange={(e) => setCounterpartyName(e.target.value)}
            placeholder="Razão social de quem vai receber a cobrança"
            error={err('counterpartyName')}
          />
          <Input
            label="Identificador da contraparte"
            value={counterpartyId}
            onChange={(e) => setCounterpartyId(e.target.value)}
            placeholder="UUID, se já houver cadastro"
            hint="Opcional enquanto não existe o cadastro de clientes."
            error={err('counterpartyId')}
          />
          <Input
            label="Vencimento"
            type="date"
            required
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            error={err('dueDate')}
          />
          <Select
            label="Moeda"
            required
            options={CURRENCIES}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            hint="Todos os itens usam a moeda da fatura."
            error={err('currency')}
          />
          <Textarea
            label="Observações"
            wrapperStyle={{ gridColumn: '1 / -1' }}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notas internas. Não aparecem no documento enviado."
            maxLength={2000}
            error={err('notes')}
          />
        </div>
      </Panel>

      <Panel
        title="Itens"
        action={
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setLines((cur) => [...cur, emptyLine()])}
          >
            Adicionar item
          </Button>
        }
      >
        <div>
          {/*
            Only the first row carries a visible label — repeating the column
            names on every row is visual noise. But every input still gets an
            aria-label, or a screen-reader user tabbing into the second row
            hears an unnamed text box and has to guess which column it is.
          */}
          {lines.map((line, index) => (
            <div className="ssm-line-row" key={line.key}>
              <Input
                label={index === 0 ? 'Descrição' : undefined}
                aria-label={`Descrição do item ${index + 1}`}
                value={line.description}
                onChange={(e) => updateLine(line.key, { description: e.target.value })}
                placeholder="Sustentação de ambiente — mensalidade"
                error={err(`lines.${index}.description`)}
              />
              <Input
                label={index === 0 ? 'Qtd.' : undefined}
                aria-label={`Qtd. do item ${index + 1}`}
                inputMode="decimal"
                value={line.quantity}
                onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                error={err(`lines.${index}.quantityMilli`)}
              />
              <Input
                label={index === 0 ? 'Preço unitário' : undefined}
                aria-label={`Preço unitário do item ${index + 1}`}
                inputMode="decimal"
                value={line.unitPrice}
                onChange={(e) => updateLine(line.key, { unitPrice: e.target.value })}
                placeholder="0,00"
                error={err(`lines.${index}.unitPrice.amountMinor`)}
              />
              <Input
                label={index === 0 ? 'Imposto %' : undefined}
                aria-label={`Imposto % do item ${index + 1}`}
                inputMode="decimal"
                value={line.taxRate}
                onChange={(e) => updateLine(line.key, { taxRate: e.target.value })}
                error={err(`lines.${index}.taxRateBps`)}
              />
              <Input
                label={index === 0 ? 'Total do item' : undefined}
                aria-label={`Total do item ${index + 1}`}
                readOnly
                tabIndex={-1}
                value={formatMoney(
                  { amountMinor: totals.lines[index]?.lineTotalMinor ?? 0, currency },
                  locale,
                )}
              />
              <IconButton
                label={`Remover item ${index + 1}`}
                variant="ghost"
                size="md"
                type="button"
                disabled={lines.length === 1}
                onClick={() => setLines((cur) => cur.filter((l) => l.key !== line.key))}
              >
                ×
              </IconButton>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Totais">
        <div className="ssm-totals">
          <div className="ssm-totals__row">
            <span>Subtotal</span>
            <span className="ssm-num">
              {formatMoney({ amountMinor: totals.subtotalMinor, currency }, locale)}
            </span>
          </div>
          <div className="ssm-totals__row">
            <span>Impostos</span>
            <span className="ssm-num">
              {formatMoney({ amountMinor: totals.taxTotalMinor, currency }, locale)}
            </span>
          </div>
          <div className="ssm-totals__row ssm-totals__row--grand">
            <span>Total</span>
            <span className="ssm-num">
              {formatMoney({ amountMinor: totals.totalMinor, currency }, locale)}
            </span>
          </div>
        </div>

        <div className="ssm-form-actions">
          <Button variant="secondary" type="button" onClick={() => navigate('/financeiro/faturas')}>
            Descartar
          </Button>
          <Button type="submit" loading={saving} disabled={!canSubmit}>
            Salvar rascunho
          </Button>
        </div>
      </Panel>
    </form>
  );
}
