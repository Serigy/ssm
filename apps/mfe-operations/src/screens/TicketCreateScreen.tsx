import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Panel, Select, Input, Textarea } from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { CreateTicket, Severity } from '@ssm/contracts';
import { operationsApi } from '../api.js';
import { SEVERITY_LABEL } from '../status.js';

const SEVERITY_HELP: Record<Severity, string> = {
  sev1: 'Serviço parado ou perda de dados. Coloca o ambiente em incidente.',
  sev2: 'Degradação com impacto em produção.',
  sev3: 'Demais solicitações.',
};

const KINDS = [
  { value: 'incident', label: 'Incidente' },
  { value: 'request', label: 'Solicitação' },
  { value: 'change', label: 'Mudança' },
  { value: 'problem', label: 'Problema' },
];

export function TicketCreateScreen() {
  const { api, notify, setPageTitle } = useHost();
  const navigate = useNavigate();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState('incident');
  const [severity, setSeverity] = useState<Severity>('sev2');
  const [environmentId, setEnvironmentId] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  useEffect(() => setPageTitle('Novo chamado', 'OPERAÇÕES'), [setPageTitle]);

  // The environment drives the response deadline, so it is offered as a list
  // rather than typed — a mistyped code would silently fall back to defaults.
  const { data: environments } = useQuery(
    () => operationsApi.environments.list(api, { limit: 100 }),
    [],
  );

  const envOptions = (environments?.items ?? []).map((e) => ({
    value: e.id,
    label: `${e.code} — ${e.name}`,
  }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const dto: CreateTicket = {
      subject: subject.trim(),
      description: description.trim(),
      kind: kind as CreateTicket['kind'],
      severity,
      environmentId: environmentId || null,
    };

    try {
      const created = await operationsApi.tickets.create(api, dto);
      notify.success(
        `Chamado #${created.number} aberto`,
        `Prazo de primeira resposta até ${new Date(created.responseDueAt).toLocaleTimeString('pt-BR')}.`,
      );
      navigate(`/operacoes/chamados/${created.id}`);
    } catch (err) {
      const problem = err as { fieldErrors?: Record<string, string[]>; message?: string };
      setFieldErrors(problem.fieldErrors ?? {});
      notify.error(
        'Não foi possível abrir o chamado',
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
        <Button variant="ghost" size="sm" type="button" onClick={() => navigate('/operacoes/chamados')}>
          ← Chamados
        </Button>
      </div>

      <Panel title="Chamado">
        <div className="ssm-form-grid">
          <Input
            label="Assunto"
            required
            wrapperStyle={{ gridColumn: '1 / -1' }}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Latência acima do limite em amb-dados-01"
            error={err('subject')}
          />
          <Select
            label="Ambiente"
            options={envOptions}
            placeholder="Sem ambiente vinculado"
            value={environmentId}
            onChange={(e) => setEnvironmentId(e.target.value)}
            hint="Define o prazo de resposta e leva o chamado para a apuração de SLA."
            error={err('environmentId')}
          />
          <Select
            label="Tipo"
            options={KINDS}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          />
          <Select
            label="Severidade"
            required
            options={Object.entries(SEVERITY_LABEL).map(([value, label]) => ({ value, label }))}
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
            hint={SEVERITY_HELP[severity]}
            error={err('severity')}
          />
          <Textarea
            label="Descrição"
            wrapperStyle={{ gridColumn: '1 / -1' }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="O que foi observado, desde quando, e o que já foi verificado."
            rows={6}
            error={err('description')}
          />
        </div>

        <div className="ssm-form-actions">
          <Button variant="secondary" type="button" onClick={() => navigate('/operacoes/chamados')}>
            Descartar
          </Button>
          <Button type="submit" loading={saving} disabled={!subject.trim() || saving}>
            Abrir chamado
          </Button>
        </div>
      </Panel>

      {severity === 'sev1' && (
        <Card eyebrow="ATENÇÃO" title="Severidade 1 coloca o ambiente em incidente">
          O ambiente aparece como “Incidente” no inventário até que este chamado seja resolvido, e
          o período conta como indisponibilidade na apuração mensal de disponibilidade.
        </Card>
      )}
    </form>
  );
}
