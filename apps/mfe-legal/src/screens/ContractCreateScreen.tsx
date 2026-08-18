import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Checkbox, IconButton, Input, Panel, Select, Tag } from '@ssm/ui-kit';
import { useHost } from '@ssm/mfe-runtime';
import type { CreateContract } from '@ssm/contracts';
import { legalApi } from '../api.js';
import { KIND_LABEL } from '../status.js';

const KINDS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));

const PARTY_ROLES = [
  { value: 'first_party', label: 'Nossa parte' },
  { value: 'counterparty', label: 'Contraparte' },
  { value: 'guarantor', label: 'Fiadora' },
  { value: 'witness', label: 'Testemunha' },
];

const CURRENCIES = [
  { value: 'BRL', label: 'BRL — Real' },
  { value: 'USD', label: 'USD — Dólar' },
  { value: 'EUR', label: 'EUR — Euro' },
];

interface PartyDraft {
  key: string;
  name: string;
  role: string;
  externalRef: string;
}

const newParty = (role: string): PartyDraft => ({
  key: crypto.randomUUID(),
  name: '',
  role,
  externalRef: '',
});

function toMinor(input: string): number {
  const normalised = input.trim().replace(/\./g, '').replace(',', '.');
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function ContractCreateScreen() {
  const { api, notify, setPageTitle } = useHost();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState('service_agreement');
  const [governingLaw, setGoverningLaw] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [renewalNoticeDays, setRenewalNoticeDays] = useState('30');
  const [autoRenew, setAutoRenew] = useState(false);
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('BRL');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  // Pre-seeded with the two roles every contract has, so the common case is
  // filling names rather than working out the structure first.
  const [parties, setParties] = useState<PartyDraft[]>([
    { ...newParty('first_party'), name: 'Serigy Tecnologia e Marketing' },
    newParty('counterparty'),
  ]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => setPageTitle('Novo contrato', 'JURÍDICO'), [setPageTitle]);

  const updateParty = (key: string, patch: Partial<PartyDraft>) =>
    setParties((cur) => cur.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const namedParties = parties.filter((p) => p.name.trim());
  const canSubmit = title.trim() && namedParties.length > 0 && !saving;

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags((cur) => [...cur, t]);
    setTagInput('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const dto: CreateContract = {
      title: title.trim(),
      kind: kind as CreateContract['kind'],
      parties: namedParties.map((p) => ({
        name: p.name.trim(),
        role: p.role as 'first_party' | 'counterparty' | 'guarantor' | 'witness',
        externalRef: p.externalRef.trim() || null,
      })),
      governingLaw: governingLaw.trim() || undefined,
      jurisdiction: jurisdiction.trim() || undefined,
      effectiveFrom: effectiveFrom || undefined,
      effectiveTo: effectiveTo || undefined,
      renewalNoticeDays: Number(renewalNoticeDays) || 30,
      autoRenew,
      value: value.trim() ? { amountMinor: toMinor(value), currency } : undefined,
      tags: tags.length ? tags : undefined,
    };

    try {
      const created = await legalApi.create(api, dto);
      notify.success('Contrato cadastrado', `Referência ${created.reference}.`);
      navigate(`/juridico/contratos/${created.id}`);
    } catch (err) {
      const problem = err as { fieldErrors?: Record<string, string[]>; message?: string };
      setFieldErrors(problem.fieldErrors ?? {});
      notify.error(
        'Não foi possível cadastrar o contrato',
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
        <Button variant="ghost" size="sm" type="button" onClick={() => navigate('/juridico/contratos')}>
          ← Contratos
        </Button>
      </div>

      <Panel title="Objeto">
        <div className="ssm-form-grid">
          <Input
            label="Título"
            required
            wrapperStyle={{ gridColumn: '1 / -1' }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sustentação de infraestrutura — Prefeitura de Aracaju"
            error={err('title')}
          />
          <Select
            label="Tipo"
            required
            options={KINDS}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            hint="Define o prefixo da referência gerada."
            error={err('kind')}
          />
          <Input
            label="Lei aplicável"
            value={governingLaw}
            onChange={(e) => setGoverningLaw(e.target.value)}
            placeholder="Lei nº 14.133/2021"
            error={err('governingLaw')}
          />
          <Input
            label="Foro"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            placeholder="Aracaju, SE"
            error={err('jurisdiction')}
          />
        </div>
      </Panel>

      <Panel
        title="Partes"
        action={
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={() => setParties((cur) => [...cur, newParty('counterparty')])}
          >
            Adicionar parte
          </Button>
        }
      >
        <div className="ssm-stack" style={{ gap: 'var(--space-4)' }}>
          {parties.map((party, index) => (
            <div
              key={party.key}
              className="ssm-line-row"
              style={{ gridTemplateColumns: 'minmax(220px, 3fr) 200px minmax(160px, 2fr) 40px' }}
            >
              <Input
                label={index === 0 ? 'Nome' : undefined}
                aria-label={`Nome da parte ${index + 1}`}
                value={party.name}
                onChange={(e) => updateParty(party.key, { name: e.target.value })}
                placeholder="Razão social"
                error={err(`parties.${index}.name`)}
              />
              <Select
                label={index === 0 ? 'Papel' : undefined}
                aria-label={`Papel da parte ${index + 1}`}
                options={PARTY_ROLES}
                value={party.role}
                onChange={(e) => updateParty(party.key, { role: e.target.value })}
              />
              <Input
                label={index === 0 ? 'Vínculo externo' : undefined}
                aria-label={`Vínculo externo da parte ${index + 1}`}
                value={party.externalRef}
                onChange={(e) => updateParty(party.key, { externalRef: e.target.value })}
                placeholder="id de colaborador ou cliente"
              />
              <IconButton
                label={`Remover parte ${index + 1}`}
                variant="ghost"
                type="button"
                disabled={parties.length === 1}
                onClick={() => setParties((cur) => cur.filter((p) => p.key !== party.key))}
              >
                ×
              </IconButton>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Vigência e valor">
        <div className="ssm-form-grid">
          <Input
            label="Vigência a partir de"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            hint="Obrigatória para ativar o contrato depois."
            error={err('effectiveFrom')}
          />
          <Input
            label="Vigência até"
            type="date"
            value={effectiveTo}
            onChange={(e) => setEffectiveTo(e.target.value)}
            hint="Em branco significa prazo indeterminado."
            error={err('effectiveTo')}
          />
          <Input
            label="Aviso de vencimento (dias)"
            inputMode="numeric"
            value={renewalNoticeDays}
            onChange={(e) => setRenewalNoticeDays(e.target.value)}
            hint="Antecedência com que o alerta de vencimento é disparado."
            error={err('renewalNoticeDays')}
          />
          <Input
            label="Valor do contrato"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0,00"
            error={err('value.amountMinor')}
          />
          <Select
            label="Moeda"
            options={CURRENCIES}
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 'var(--space-2)' }}>
            <Checkbox
              label="Renovação automática"
              hint="Sem isso, o vencimento exige ação manual."
              checked={autoRenew}
              onChange={(e) => setAutoRenew(e.target.checked)}
            />
          </div>
        </div>
      </Panel>

      <Panel title="Etiquetas">
        <div className="ssm-toolbar" style={{ marginBottom: 'var(--space-4)' }}>
          <Input
            placeholder="sustentação, setor público…"
            size="sm"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Enter adds a tag; it must not submit the whole form.
                e.preventDefault();
                addTag();
              }
            }}
          />
          <Button variant="secondary" size="sm" type="button" onClick={addTag}>
            Adicionar
          </Button>
        </div>
        <div className="ssm-row" style={{ flexWrap: 'wrap' }}>
          {tags.length ? (
            tags.map((t) => (
              <Tag key={t} onRemove={() => setTags((cur) => cur.filter((x) => x !== t))}>
                {t}
              </Tag>
            ))
          ) : (
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
              Nenhuma etiqueta. Elas alimentam os filtros da listagem.
            </span>
          )}
        </div>

        <div className="ssm-form-actions">
          <Button variant="secondary" type="button" onClick={() => navigate('/juridico/contratos')}>
            Descartar
          </Button>
          <Button type="submit" loading={saving} disabled={!canSubmit}>
            Cadastrar contrato
          </Button>
        </div>
      </Panel>

      <Card eyebrow="PRÓXIMO PASSO" title="O contrato nasce como rascunho">
        As cláusulas entram depois, por aditivo, na tela do contrato — junto com o PDF assinado.
        Ativar a vigência é uma ação separada e exige <code>legal:contract:approve</code>.
      </Card>
    </form>
  );
}
