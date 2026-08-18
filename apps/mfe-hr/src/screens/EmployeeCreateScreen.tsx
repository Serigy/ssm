import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input, Panel, Select } from '@ssm/ui-kit';
import { useHost } from '@ssm/mfe-runtime';
import type { CreateEmployee } from '@ssm/contracts';
import { hrApi } from '../api.js';

const CONTRACT_TYPES = [
  { value: 'permanent', label: 'Efetivo' },
  { value: 'fixed_term', label: 'Prazo determinado' },
  { value: 'contractor', label: 'Prestador' },
  { value: 'intern', label: 'Estágio' },
  { value: 'apprentice', label: 'Aprendiz' },
];

const CURRENCIES = [
  { value: 'BRL', label: 'BRL — Real' },
  { value: 'USD', label: 'USD — Dólar' },
  { value: 'EUR', label: 'EUR — Euro' },
];

function toMinor(input: string): number {
  const normalised = input.trim().replace(/\./g, '').replace(',', '.');
  const value = Number(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export function EmployeeCreateScreen() {
  const { api, can, notify, setPageTitle } = useHost();
  const navigate = useNavigate();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [personalEmail, setPersonalEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [contractType, setContractType] = useState('permanent');
  const [startDate, setStartDate] = useState('');
  const [salary, setSalary] = useState('');
  const [salaryCurrency, setSalaryCurrency] = useState('BRL');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  // Salary is behind hr:payroll:read, so someone without it should not be
  // asked for a value they will never be allowed to read back.
  const canSetSalary = can('hr:payroll:read');

  useEffect(() => setPageTitle('Novo colaborador', 'PESSOAS'), [setPageTitle]);

  const canSubmit =
    firstName.trim() && lastName.trim() && workEmail.trim() && jobTitle.trim() && startDate && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFieldErrors({});

    const dto: CreateEmployee = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      workEmail: workEmail.trim(),
      personalEmail: personalEmail.trim() || undefined,
      phone: phone.trim() || undefined,
      dateOfBirth: dateOfBirth || undefined,
      contractType: contractType as CreateEmployee['contractType'],
      jobTitle: jobTitle.trim(),
      departmentId: null,
      managerId: null,
      startDate,
      salary:
        canSetSalary && salary.trim()
          ? { amountMinor: toMinor(salary), currency: salaryCurrency }
          : undefined,
    };

    try {
      const created = await hrApi.create(api, dto);
      notify.success(
        'Colaborador cadastrado',
        `Matrícula ${created.employeeNumber}. Conclua a admissão quando a documentação estiver completa.`,
      );
      navigate(`/pessoas/colaboradores/${created.id}`);
    } catch (err) {
      const problem = err as { fieldErrors?: Record<string, string[]>; message?: string };
      setFieldErrors(problem.fieldErrors ?? {});
      notify.error(
        'Não foi possível cadastrar',
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
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => navigate('/pessoas/colaboradores')}
        >
          ← Colaboradores
        </Button>
      </div>

      <Panel title="Identificação">
        <div className="ssm-form-grid">
          <Input
            label="Nome"
            required
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            error={err('firstName')}
          />
          <Input
            label="Sobrenome"
            required
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            error={err('lastName')}
          />
          <Input
            label="E-mail corporativo"
            type="email"
            required
            value={workEmail}
            onChange={(e) => setWorkEmail(e.target.value)}
            placeholder="nome.sobrenome@serigy.local"
            hint="Único por cliente. É por ele que o acesso será vinculado."
            error={err('workEmail')}
          />
          <Input
            label="E-mail pessoal"
            type="email"
            value={personalEmail}
            onChange={(e) => setPersonalEmail(e.target.value)}
            hint="Dado pessoal. Visível apenas com hr:payroll:read."
            error={err('personalEmail')}
          />
          <Input
            label="Telefone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(79) 90000-0000"
            error={err('phone')}
          />
          <Input
            label="Data de nascimento"
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            hint="Dado pessoal."
            error={err('dateOfBirth')}
          />
        </div>
      </Panel>

      <Panel title="Vínculo">
        <div className="ssm-form-grid">
          <Input
            label="Cargo"
            required
            value={jobTitle}
            onChange={(e) => setJobTitle(e.target.value)}
            placeholder="Analista de sustentação"
            error={err('jobTitle')}
          />
          <Select
            label="Tipo de contrato"
            required
            options={CONTRACT_TYPES}
            value={contractType}
            onChange={(e) => setContractType(e.target.value)}
            error={err('contractType')}
          />
          <Input
            label="Data de admissão"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            error={err('startDate')}
          />

          {canSetSalary && (
            <>
              <Input
                label="Remuneração anual bruta"
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                placeholder="0,00"
                hint="Visível apenas para quem tem hr:payroll:read."
                error={err('salary.amountMinor')}
              />
              <Select
                label="Moeda"
                options={CURRENCIES}
                value={salaryCurrency}
                onChange={(e) => setSalaryCurrency(e.target.value)}
              />
            </>
          )}
        </div>

        <div className="ssm-form-actions">
          <Button
            variant="secondary"
            type="button"
            onClick={() => navigate('/pessoas/colaboradores')}
          >
            Descartar
          </Button>
          <Button type="submit" loading={saving} disabled={!canSubmit}>
            Cadastrar colaborador
          </Button>
        </div>
      </Panel>

      <Card eyebrow="PRÓXIMO PASSO" title="O cadastro entra em admissão">
        O colaborador é criado com a situação “Em admissão”. Concluir a admissão é uma ação
        separada, na tela do colaborador — é ela que publica o evento consumido pelo financeiro.
      </Card>
    </form>
  );
}
