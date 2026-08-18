import type {
  CreateEnvironment,
  CreateTicket,
  Environment,
  EnvironmentFilter,
  Money,
  Page,
  SlaPeriod,
  Ticket,
  TicketFilter,
  TicketStatus,
} from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';

const ENV = '/api/operations/v1/environments';
const TICKETS = '/api/operations/v1/tickets';
const SLA = '/api/operations/v1/sla';

export const operationsApi = {
  environments: {
    list: (api: ApiClient, filter: EnvironmentFilter & { limit?: number; cursor?: string }) =>
      api.list<Environment>(ENV, filter as Record<string, string | number | undefined>),
    get: (api: ApiClient, id: string) => api.get<Environment>(`${ENV}/${id}`),
    create: (api: ApiClient, dto: CreateEnvironment) => api.post<Environment>(ENV, dto),
  },

  tickets: {
    list: (api: ApiClient, filter: TicketFilter & { limit?: number; cursor?: string }) =>
      api.list<Ticket>(TICKETS, filter as Record<string, string | number | undefined>),
    get: (api: ApiClient, id: string) => api.get<Ticket>(`${TICKETS}/${id}`),
    create: (api: ApiClient, dto: CreateTicket) => api.post<Ticket>(TICKETS, dto),
    // Derived key: moving ticket X to a given state is the same operation
    // however many times it is attempted.
    transition: (api: ApiClient, id: string, status: TicketStatus, note?: string) =>
      api.post<Ticket>(`${TICKETS}/${id}/status`, { status, note }, `ticket-status:${id}:${status}`),
    assign: (api: ApiClient, id: string, assigneeId: string | null) =>
      api.post<Ticket>(`${TICKETS}/${id}/assign`, { assigneeId }),
  },

  sla: {
    list: (api: ApiClient, month?: string) =>
      api.get<SlaPeriod[]>(month ? `${SLA}?month=${month}` : SLA),
    reckon: (api: ApiClient, month: string, environmentId: string, monthlyFee: Money) =>
      api.post<SlaPeriod>(
        `${SLA}/reckon`,
        { month, environmentId, monthlyFee },
        // Reckoning a month for an environment happens once, by definition.
        `sla-reckon:${environmentId}:${month}`,
      ),
  },
} as const;

export type TicketPage = Page<Ticket>;
