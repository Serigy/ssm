import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  LoadingBar,
  Metric,
  Panel,
  Select,
  Table,
  formatDate,
  type Column,
} from '@ssm/ui-kit';
import { useHost, useQuery } from '@ssm/mfe-runtime';
import type { Employee, EmploymentStatus } from '@ssm/contracts';
import { hrApi } from '../api.js';
import { STATUS_LABEL, STATUS_TONE } from '../status.js';

const STATUS_OPTIONS = Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }));

export function EmployeeListScreen() {
  const { api, can, setPageTitle, locale } = useHost();
  const navigate = useNavigate();

  const [status, setStatus] = useState<EmploymentStatus | ''>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => setPageTitle('Colaboradores', 'PESSOAS'), [setPageTitle]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error, refetch } = useQuery(
    () => hrApi.list(api, { status: status || undefined, q: debounced || undefined, limit: 25 }),
    [status, debounced],
  );

  const items = data?.items ?? [];
  const activeCount = items.filter((e) => e.status === 'active').length;
  const onboardingCount = items.filter((e) => e.status === 'onboarding').length;

  const columns: Column<Employee>[] = [
    { key: 'number', header: 'Matrícula', render: (e) => <span className="ssm-num">{e.employeeNumber}</span> },
    { key: 'name', header: 'Nome', render: (e) => `${e.firstName} ${e.lastName}` },
    { key: 'title', header: 'Cargo', render: (e) => e.jobTitle },
    {
      key: 'status',
      header: 'Situação',
      render: (e) => (
        <Badge tone={STATUS_TONE[e.status]} dot>
          {STATUS_LABEL[e.status]}
        </Badge>
      ),
    },
    { key: 'start', header: 'Admissão', render: (e) => formatDate(e.startDate, locale) },
    { key: 'email', header: 'E-mail', render: (e) => e.workEmail },
  ];

  return (
    <div className="ssm-stack">
      <div className="ssm-grid-metrics">
        <Metric label="NA LISTA" value={String(items.length)} />
        <Metric label="ATIVOS" value={String(activeCount)} tone="up" />
        <Metric label="EM ADMISSÃO" value={String(onboardingCount)} />
      </div>

      <div className="ssm-toolbar">
        <Input
          placeholder="Buscar por nome, matrícula ou e-mail"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="sm"
          wrapperStyle={{ minWidth: 300 }}
        />
        <Select
          options={STATUS_OPTIONS}
          placeholder="Todas as situações"
          value={status}
          size="sm"
          onChange={(e) => setStatus(e.target.value as EmploymentStatus | '')}
        />
        <div className="ssm-toolbar__spacer" />
        {can('hr:employee:create') && (
          <Button onClick={() => navigate('/pessoas/colaboradores/novo')}>Admitir colaborador</Button>
        )}
      </div>

      {loading && <LoadingBar />}

      {error && (
        <EmptyState
          title="Não foi possível carregar os colaboradores"
          body={error.message}
          action={
            <Button variant="secondary" onClick={refetch}>
              Tentar novamente
            </Button>
          }
        />
      )}

      {!loading && !error && (
        <Panel title={`${items.length} colaborador(es)`} padded={false}>
          <Table
            columns={columns}
            rows={items}
            rowKey={(e) => e.id}
            onRowClick={(e) => navigate(`/pessoas/colaboradores/${e.id}`)}
            empty={
              <EmptyState
                title="Nenhum colaborador encontrado"
                body={
                  status || debounced
                    ? 'Nenhum resultado para o filtro atual. Ajuste a busca ou limpe a situação selecionada.'
                    : 'Ainda não há colaboradores cadastrados neste ambiente.'
                }
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
