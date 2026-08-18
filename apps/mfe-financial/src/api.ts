import type {
  CreateInvoice,
  Invoice,
  InvoiceFilter,
  Page,
  RecordPayment,
} from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';

const BASE = '/api/financial/v1/invoices';

/**
 * Every call this module makes, in one file.
 *
 * Screens never build a URL themselves: when the gateway route or the API
 * version changes, this is the only file that moves.
 */
export const financialApi = {
  list: (api: ApiClient, filter: InvoiceFilter & { limit?: number; cursor?: string }) =>
    api.list<Invoice>(BASE, filter as Record<string, string | number | undefined>),

  get: (api: ApiClient, id: string) => api.get<Invoice>(`${BASE}/${id}`),

  create: (api: ApiClient, dto: CreateInvoice) => api.post<Invoice>(BASE, dto),

  // Derived key: issuing invoice X is the same operation however many times
  // it is attempted, so a second click replays the first answer.
  issue: (api: ApiClient, id: string) => api.post<Invoice>(`${BASE}/${id}/issue`, undefined, `issue:${id}`),

  // NOT derived. Two payments against the same invoice are two operations,
  // and a derived key would silently swallow the second one. The generated
  // per-call key still protects against a duplicated delivery of one request.
  recordPayment: (api: ApiClient, id: string, dto: RecordPayment) =>
    api.post<Invoice>(`${BASE}/${id}/payments`, dto),

  void: (api: ApiClient, id: string, reason: string) =>
    api.post<Invoice>(`${BASE}/${id}/void`, { reason }, `void:${id}`),

  remove: (api: ApiClient, id: string) => api.delete<void>(`${BASE}/${id}`),

  documentUrl: (api: ApiClient, id: string) =>
    api.get<{ url: string }>(`${BASE}/${id}/document`),
} as const;

export type InvoicePage = Page<Invoice>;
