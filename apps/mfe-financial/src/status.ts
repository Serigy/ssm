import type { InvoiceStatus } from '@ssm/contracts';
import type { BadgeTone } from '@ssm/ui-kit';

/**
 * One mapping from domain state to presentation, used by the list, the detail
 * screen and anything added later — so a status never renders as "warning" in
 * one place and "danger" in another.
 */
export const STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: 'Rascunho',
  issued: 'Emitida',
  partially_paid: 'Parcial',
  paid: 'Paga',
  void: 'Cancelada',
};

export const STATUS_TONE: Record<InvoiceStatus, BadgeTone> = {
  draft: 'neutral',
  issued: 'info',
  partially_paid: 'warning',
  paid: 'success',
  void: 'danger',
};

/** True when the due date has passed and the balance is still open. */
export function isOverdue(dueDate: string, status: InvoiceStatus): boolean {
  if (status !== 'issued' && status !== 'partially_paid') return false;
  return new Date(dueDate) < new Date(new Date().toISOString().slice(0, 10));
}
