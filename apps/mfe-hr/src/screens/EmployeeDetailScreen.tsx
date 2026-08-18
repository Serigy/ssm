import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Input,
  LoadingBar,
  Select,
  formatDate,
  formatMoney,
} from '@ssm/ui-kit';
import { isAggregateId, useHost, useQuery } from '@ssm/mfe-runtime';
import { hrApi } from '../api.js';
import { STATUS_LABEL, STATUS_TONE } from '../status.js';

const REASONS = [
  { value: 'resignation', label: 'Pedido de demissão' },
  { value: 'termination', label: 'Demissão' },
  { value: 'end_of_contract', label: 'Fim de contrato' },
  { value: 'retirement', label: 'Aposentadoria' },
];

export function EmployeeDetailScreen() {
  const { id = '' } = useParams();
  const { api, can, notify, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [offboarding, setOffboarding] = useState(false);
  const [lastDay, setLastDay] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('resignation');
  const [busy, setBusy] = useState(false);

  const valid = isAggregateId(id);
  const { data: employee, loading, error, refetch } = useQuery(
    () => (valid ? hrApi.get(api, id) : Promise.reject(new Error('Identificador inválido.'))),
    [id, valid],
  );

  useEffect(() => {
    if (employee) setPageTitle(`${employee.firstName} ${employee.lastName}`, employee.employeeNumber);
  }, [employee, setPageTitle]);

  async function activate() {
    setBusy(true);
    try {
      await hrApi.activate(api, id);
      notify.success('Admissão concluída', 'O colaborador está ativo.');
      refetch();
    } catch (err) {
      notify.error('Não foi possível concluir a admissão', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function offboard() {
    setBusy(true);
    try {
      await hrApi.offboard(api, id, { lastDay, reason: reason as never });
      notify.success('Desligamento registrado', 'Financeiro e jurídico foram notificados.');
      setOffboarding(false);
      refetch();
    } catch (err) {
      notify.error('Não foi possível registrar o desligamento', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingBar />;
  if (error || !employee) {
    return (
      <EmptyState
        title="Colaborador não encontrado"
        body={error?.message ?? 'O cadastro pode ter sido removido.'}
        action={
          <Button variant="secondary" onClick={() => navigate('/pessoas/colaboradores')}>
            Voltar à lista
          </Button>
        }
      />
    );
  }

  // `salary` is absent — not null — for callers without hr:payroll:read, which
  // is how the API distinguishes "not permitted" from "not set".
  const canSeePayroll = 'salary' in employee;

  return (
    <div className="ssm-stack">
      <div className="ssm-toolbar">
        <Button variant="ghost" size="sm" onClick={() => navigate('/pessoas/colaboradores')}>
          ← Colaboradores
        </Button>
        <Badge tone={STATUS_TONE[employee.status]} dot>
          {STATUS_LABEL[employee.status]}
        </Badge>
        <div className="ssm-toolbar__spacer" />
        {employee.status === 'onboarding' && can('hr:employee:update') && (
          <Button onClick={activate} loading={busy}>
            Concluir admissão
          </Button>
        )}
        {(employee.status === 'active' || employee.status === 'on_leave') &&
          can('hr:employee:delete') && (
            <Button variant="secondary" onClick={() => setOffboarding(true)}>
              Registrar desligamento
            </Button>
          )}
      </div>

      <div className="ssm-grid-metrics">
        <Card eyebrow="CARGO" title={employee.jobTitle}>
          Admitido em {formatDate(employee.startDate, locale)}
        </Card>
        <Card eyebrow="CONTATO" title={employee.workEmail}>
          {employee.phone ?? 'Telefone não informado'}
        </Card>
        {canSeePayroll && (
          <Card eyebrow="REMUNERAÇÃO" title={formatMoney(employee.salary, locale)}>
            Bruto anual · visível apenas com hr:payroll:read
          </Card>
        )}
      </div>

      <Dialog
        open={offboarding}
        title="Registrar desligamento"
        description={
          'O cadastro permanece como histórico e não é excluído. O evento ' +
          '`hr.employee.offboarded` é publicado, encerrando cobranças recorrentes no financeiro ' +
          'e marcando para revisão os contratos em que esta pessoa figura.'
        }
        onClose={() => setOffboarding(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOffboarding(false)}>
              Voltar
            </Button>
            <Button variant="danger" onClick={offboard} loading={busy}>
              Registrar desligamento
            </Button>
          </>
        }
      >
        <div className="ssm-stack" style={{ gap: 'var(--space-4)' }}>
          <Input
            label="Último dia"
            type="date"
            required
            value={lastDay}
            onChange={(e) => setLastDay(e.target.value)}
          />
          <Select
            label="Motivo"
            required
            options={REASONS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </Dialog>
    </div>
  );
}
