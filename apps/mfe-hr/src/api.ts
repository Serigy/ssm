import type {
  CreateEmployee,
  Employee,
  EmployeeFilter,
  OffboardEmployee,
  Page,
} from '@ssm/contracts';
import type { ApiClient } from '@ssm/mfe-runtime';

const BASE = '/api/hr/v1/employees';

export const hrApi = {
  list: (api: ApiClient, filter: EmployeeFilter & { limit?: number; cursor?: string }) =>
    api.list<Employee>(BASE, filter as Record<string, string | number | undefined>),
  get: (api: ApiClient, id: string) => api.get<Employee>(`${BASE}/${id}`),
  create: (api: ApiClient, dto: CreateEmployee) => api.post<Employee>(BASE, dto),
  activate: (api: ApiClient, id: string) =>
    api.post<Employee>(`${BASE}/${id}/activate`, undefined, `activate:${id}`),
  offboard: (api: ApiClient, id: string, dto: OffboardEmployee) =>
    api.post<Employee>(`${BASE}/${id}/offboard`, dto, `offboard:${id}`),
} as const;

export type EmployeePage = Page<Employee>;
