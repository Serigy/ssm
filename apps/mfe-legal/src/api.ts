import type {
  Contract,
  ContractFilter,
  ContractStatus,
  CreateContract,
  DocumentTicket,
  Page,
} from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';

const BASE = '/api/legal/v1/contracts';

export const legalApi = {
  list: (api: ApiClient, filter: ContractFilter & { limit?: number; cursor?: string }) =>
    api.list<Contract>(BASE, filter as Record<string, string | number | undefined>),
  get: (api: ApiClient, id: string) => api.get<Contract>(`${BASE}/${id}`),
  create: (api: ApiClient, dto: CreateContract) => api.post<Contract>(BASE, dto),
  transition: (api: ApiClient, id: string, status: ContractStatus) =>
    api.post<Contract>(`${BASE}/${id}/status`, { status }, `status:${id}:${status}`),
  expiring: (api: ApiClient, withinDays = 60) =>
    api.get<Contract[]>(`${BASE}/expiring?withinDays=${withinDays}`),
  documentUrl: (api: ApiClient, id: string) => api.get<DocumentTicket>(`${BASE}/${id}/document`),

  /**
   * Two-step upload: ask for a presigned PUT, send the file straight to R2,
   * then tell the API the key is in place. The binary never touches the service.
   */
  upload: async (api: ApiClient, id: string, file: File): Promise<Contract> => {
    const ticket = await api.post<DocumentTicket>(`${BASE}/${id}/document/upload-url`, {
      filename: file.name,
      contentType: file.type || 'application/pdf',
    });

    const put = await fetch(ticket.url, {
      method: 'PUT',
      headers: ticket.headers,
      body: file,
    });
    if (!put.ok) {
      throw new Error(
        `O envio para o armazenamento falhou (${put.status}). Verifique a conexão e tente de novo.`,
      );
    }

    return api.post<Contract>(`${BASE}/${id}/document`, { key: ticket.key });
  },
} as const;

export type ContractPage = Page<Contract>;
