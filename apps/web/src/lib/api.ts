import { getSession } from './session';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getSession()?.token;
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const err = json?.error ?? { message: res.statusText };
    throw new Error(err.message ?? err.code ?? 'Request failed');
  }
  return json.data as T;
}

export interface LoginResult {
  access_token: string;
  user: { email: string; userType: string };
  tenant: { code: string } | null;
  permissions: string[];
}
export interface TenantRow {
  id: string;
  code: string;
  name: string;
  status: string;
  planCode: string | null;
  enabledModules: number;
}
export interface PlanRow {
  id: string;
  code: string;
  name: string;
  monthlyPrice: number;
  maxPlants: number;
  maxUsers: number;
  moduleCount: number;
}
export interface TenantModuleRow {
  moduleKey: string;
  name: string;
  phase: number;
  isEnabled: boolean;
}
export interface ModuleRow {
  moduleKey: string;
  name: string;
  phase: number;
}

export const api = {
  login: (login: string, password: string) =>
    apiFetch<LoginResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password }),
    }),
  tenants: () => apiFetch<TenantRow[]>('/platform/tenants'),
  createTenant: (b: { tenantCode: string; tenantName: string; planId?: string }) =>
    apiFetch<{ id: string }>('/platform/tenants', { method: 'POST', body: JSON.stringify(b) }),
  tenant: (id: string) => apiFetch<TenantRow & { planCode: string | null }>(`/platform/tenants/${id}`),
  assignPlan: (id: string, planId: string) =>
    apiFetch<TenantModuleRow[]>(`/platform/tenants/${id}/assign-plan`, {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),
  tenantModules: (id: string) => apiFetch<TenantModuleRow[]>(`/platform/tenants/${id}/modules`),
  setTenantModule: (id: string, key: string, isEnabled: boolean) =>
    apiFetch<TenantModuleRow[]>(`/platform/tenants/${id}/modules/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ isEnabled }),
    }),
  plans: () => apiFetch<PlanRow[]>('/platform/plans'),
  createPlan: (b: {
    planCode: string;
    planName: string;
    monthlyPrice?: number;
    maxPlants?: number;
    maxUsers?: number;
  }) => apiFetch<{ id: string }>('/platform/plans', { method: 'POST', body: JSON.stringify(b) }),
  setPlanModules: (id: string, moduleKeys: string[]) =>
    apiFetch<unknown>(`/platform/plans/${id}/modules`, {
      method: 'PUT',
      body: JSON.stringify({ moduleKeys }),
    }),
  modules: () => apiFetch<ModuleRow[]>('/platform/modules'),
};
