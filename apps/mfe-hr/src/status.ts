import type { EmploymentStatus } from '@ssm/contracts';
import type { BadgeTone } from '@ssm/ui-kit';

export const STATUS_LABEL: Record<EmploymentStatus, string> = {
  applicant: 'Candidato',
  onboarding: 'Em admissão',
  active: 'Ativo',
  on_leave: 'Afastado',
  offboarding: 'Em desligamento',
  terminated: 'Desligado',
};

export const STATUS_TONE: Record<EmploymentStatus, BadgeTone> = {
  applicant: 'neutral',
  onboarding: 'info',
  active: 'success',
  on_leave: 'warning',
  offboarding: 'warning',
  terminated: 'neutral',
};
