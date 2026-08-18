import type { ContractStatus } from '@ssm/contracts';
import type { BadgeTone } from '@ssm/ui-kit';

export const STATUS_LABEL: Record<ContractStatus, string> = {
  draft: 'Rascunho',
  in_review: 'Em revisão',
  awaiting_signature: 'Aguardando assinatura',
  active: 'Vigente',
  expired: 'Vencido',
  terminated: 'Encerrado',
};

export const STATUS_TONE: Record<ContractStatus, BadgeTone> = {
  draft: 'neutral',
  in_review: 'info',
  awaiting_signature: 'warning',
  active: 'success',
  expired: 'danger',
  terminated: 'neutral',
};

export const KIND_LABEL: Record<string, string> = {
  nda: 'NDA',
  service_agreement: 'Prestação de serviços',
  employment: 'Trabalho',
  lease: 'Locação',
  supplier: 'Fornecimento',
  license: 'Licenciamento',
  other: 'Outro',
};

export const RISK_LABEL: Record<string, string> = {
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  critical: 'Crítico',
};

export const RISK_TONE: Record<string, BadgeTone> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

/** Days until the contract's end date; null when it has none. */
export function daysUntil(effectiveTo: string | null): number | null {
  if (!effectiveTo) return null;
  return Math.ceil((new Date(effectiveTo).getTime() - Date.now()) / 86_400_000);
}
