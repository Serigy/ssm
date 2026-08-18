import type { EnvironmentStatus, Severity, TicketStatus } from '@ssm/contracts';
import type { BadgeTone } from '@ssm/ui-kit';

export const ENV_STATUS_LABEL: Record<EnvironmentStatus, string> = {
  operational: 'Operacional',
  incident: 'Incidente',
  scheduled_window: 'Janela agendada',
  decommissioned: 'Desativado',
};

export const ENV_STATUS_TONE: Record<EnvironmentStatus, BadgeTone> = {
  operational: 'success',
  incident: 'danger',
  scheduled_window: 'warning',
  decommissioned: 'neutral',
};

export const ENV_KIND_LABEL: Record<string, string> = {
  production: 'Produção',
  staging: 'Homologação',
  development: 'Desenvolvimento',
  data: 'Dados',
  legacy: 'Legado',
};

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Aberto',
  in_progress: 'Em atendimento',
  waiting_customer: 'Aguardando cliente',
  resolved: 'Resolvido',
  closed: 'Encerrado',
  cancelled: 'Cancelado',
};

export const TICKET_STATUS_TONE: Record<TicketStatus, BadgeTone> = {
  open: 'danger',
  in_progress: 'info',
  waiting_customer: 'warning',
  resolved: 'success',
  closed: 'neutral',
  cancelled: 'neutral',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  sev1: 'Severidade 1',
  sev2: 'Severidade 2',
  sev3: 'Severidade 3',
};

export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  sev1: 'danger',
  sev2: 'warning',
  sev3: 'neutral',
};

/** Basis points to the percentage a contract states: 9950 -> "99,50%". */
export function formatBpsPercent(bps: number): string {
  return `${(bps / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;
}

/**
 * Countdown to the response deadline, written the way someone on call reads it.
 * Past the deadline it says how late, not a negative number.
 */
export function formatDeadline(responseDueAt: string, firstResponseAt: string | null): string {
  if (firstResponseAt) return 'Respondido';
  const minutes = Math.round((new Date(responseDueAt).getTime() - Date.now()) / 60_000);
  if (minutes < 0) {
    const late = Math.abs(minutes);
    return late >= 60 ? `${Math.floor(late / 60)}h em atraso` : `${late} min em atraso`;
  }
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h restantes` : `${minutes} min restantes`;
}
