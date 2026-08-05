import { clearSession, getSession, updateTokens } from './session';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Single-flight refresh: many requests can fail with 401 at the same moment
 * (the access token is short-lived). They all await one shared refresh call so
 * we mint exactly one new token, then each retries. Returns the new access
 * token, or null if the refresh token is missing/expired.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getSession()?.refreshToken;
  if (!refreshToken) return null;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) return null;
        const { access_token, refresh_token } = json.data as {
          access_token: string;
          refresh_token?: string;
        };
        updateTokens(access_token, refresh_token);
        return access_token;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

function request(path: string, opts: RequestInit, token: string | undefined): Promise<Response> {
  return fetch(`${BASE}/api/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res = await request(path, opts, getSession()?.token);

  // Access token expired mid-session: refresh once and retry the request. If we
  // have no refresh token (e.g. the login call itself), skip straight to the
  // normal error path so bad credentials surface as-is.
  if (res.status === 401 && getSession()?.refreshToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await request(path, opts, newToken);
    } else {
      // Refresh token is gone or expired — end the session cleanly instead of
      // showing a cryptic error, and send the user back to sign in.
      clearSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new Error('Your session has expired. Please sign in again.');
    }
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const err = json?.error ?? { message: res.statusText };
    throw new Error(err.message ?? err.code ?? 'Request failed');
  }
  return json.data as T;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  user: { email: string; userType: string };
  tenant: { code: string } | null;
  permissions: string[];
  roles: string[];
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
export interface TenantUserRow {
  id: string;
  name: string;
  email: string;
  userType: string;
  status: string;
  lastLoginAt: string | null;
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
  tenantUsers: (id: string) => apiFetch<TenantUserRow[]>(`/platform/tenants/${id}/users`),
  createTenantUser: (id: string, b: { name: string; email: string; password: string }) =>
    apiFetch<{ id: string; email: string }>(`/platform/tenants/${id}/users`, {
      method: 'POST',
      body: JSON.stringify(b),
    }),
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

// ---- Tenant portal (Sprint 3) ----
export interface Row {
  id: string;
  [k: string]: unknown;
}

/** Generic tenant-scoped CRUD client for a resource path. */
export function crud(path: string) {
  return {
    list: () => apiFetch<Row[]>(`/${path}`),
    create: (b: Record<string, unknown>) =>
      apiFetch<Row>(`/${path}`, { method: 'POST', body: JSON.stringify(b) }),
    update: (id: string, b: Record<string, unknown>) =>
      apiFetch<Row>(`/${path}/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: string) => apiFetch<Row>(`/${path}/${id}`, { method: 'DELETE' }),
  };
}

export const company = {
  get: () => apiFetch<Row | null>('/company'),
  update: (b: Record<string, unknown>) =>
    apiFetch<Row>('/company', { method: 'PATCH', body: JSON.stringify(b) }),
};

export const settings = {
  list: () => apiFetch<Row[]>('/settings'),
  set: (key: string, value: string) =>
    apiFetch<Row>(`/settings/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
};

export const usersApi = {
  list: () => apiFetch<Row[]>('/users'),
  create: (b: Record<string, unknown>) =>
    apiFetch<Row>('/users', { method: 'POST', body: JSON.stringify(b) }),
};

export const rolesApi = {
  list: () => apiFetch<Row[]>('/roles'),
  create: (b: Record<string, unknown>) =>
    apiFetch<Row>('/roles', { method: 'POST', body: JSON.stringify(b) }),
  update: (id: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  remove: (id: string) => apiFetch<{ deleted: boolean }>(`/roles/${id}`, { method: 'DELETE' }),
  catalog: () => apiFetch<Row[]>('/roles/permissions-catalog'),
  getPerms: (id: string) => apiFetch<string[]>(`/roles/${id}/permissions`),
  setPerms: (id: string, permissionIds: string[]) =>
    apiFetch<string[]>(`/roles/${id}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissionIds }),
    }),
};

// ---- Sales module (Sprint 4) ----
const post = (path: string, b?: Record<string, unknown>) =>
  apiFetch<Row>(path, { method: 'POST', ...(b ? { body: JSON.stringify(b) } : {}) });

export const leadsApi = {
  list: () => apiFetch<Row[]>('/leads'),
  get: (id: string) => apiFetch<Row>(`/leads/${id}`),
  create: (b: Record<string, unknown>) => post('/leads', b),
  update: (id: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  addFollowup: (id: string, b: Record<string, unknown>) => post(`/leads/${id}/followups`, b),
};

export const quotationsApi = {
  list: () => apiFetch<Row[]>('/quotations'),
  get: (id: string) => apiFetch<Row>(`/quotations/${id}`),
  create: (b: Record<string, unknown>) => post('/quotations', b),
  update: (id: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/quotations/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  addItem: (id: string, b: Record<string, unknown>) => post(`/quotations/${id}/items`, b),
  deleteItem: (id: string, itemId: string) =>
    apiFetch<Row>(`/quotations/${id}/items/${itemId}`, { method: 'DELETE' }),
  submit: (id: string) => post(`/quotations/${id}/submit`),
  approve: (id: string) => post(`/quotations/${id}/approve`),
  reject: (id: string, reason: string) => post(`/quotations/${id}/reject`, { reason }),
  revisions: (id: string) => apiFetch<Row[]>(`/quotations/${id}/revisions`),
  createRevision: (id: string, changeReason: string) =>
    post(`/quotations/${id}/revisions`, { changeReason }),
  share: (id: string, mobile: string) => post(`/quotations/${id}/share`, { mobile }),
  pdfUrl: (id: string) => `/quotations/${id}/pdf`,
};

export const rateContractsApi = {
  list: () => apiFetch<Row[]>('/rate-contracts'),
  get: (id: string) => apiFetch<Row>(`/rate-contracts/${id}`),
  create: (b: Record<string, unknown>) => post('/rate-contracts', b),
  addItem: (id: string, b: Record<string, unknown>) => post(`/rate-contracts/${id}/items`, b),
  deleteItem: (id: string, itemId: string) =>
    apiFetch<Row>(`/rate-contracts/${id}/items/${itemId}`, { method: 'DELETE' }),
  submit: (id: string) => post(`/rate-contracts/${id}/submit`),
  approve: (id: string) => post(`/rate-contracts/${id}/approve`),
  reject: (id: string, reason: string) => post(`/rate-contracts/${id}/reject`, { reason }),
};

export const orderDraftsApi = {
  list: () => apiFetch<Row[]>('/order-drafts'),
  get: (id: string) => apiFetch<Row>(`/order-drafts/${id}`),
  fromQuotation: (quotationId: string, b: Record<string, unknown>) =>
    post(`/order-drafts/from-quotation/${quotationId}`, b),
  fromRateContract: (rateContractId: string, b: Record<string, unknown>) =>
    post(`/order-drafts/from-rate-contract/${rateContractId}`, b),
};

// ---- Orders + credit control (Sprint 5) ----
export const ordersApi = {
  list: (status?: string) => apiFetch<Row[]>(`/orders${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/orders/${id}`),
  creditCheck: (id: string) => apiFetch<Row>(`/orders/${id}/credit-check`),
  confirm: (id: string) => post(`/orders/${id}/confirm`),
  cancel: (id: string, reason: string) => post(`/orders/${id}/cancel`, { reason }),
};

export const creditHoldsApi = {
  list: (status?: string) => apiFetch<Row[]>(`/credit-holds${status ? `?status=${status}` : ''}`),
  approve: (id: string, note: string) => post(`/credit-holds/${id}/approve`, { note }),
  reject: (id: string, note: string) => post(`/credit-holds/${id}/reject`, { note }),
};

// ---- Production & batching (Sprint 6) ----
export const mixDesignsApi = {
  list: () => apiFetch<Row[]>('/mix-designs'),
  get: (id: string) => apiFetch<Row>(`/mix-designs/${id}`),
  create: (b: Record<string, unknown>) => post('/mix-designs', b),
  addMaterial: (id: string, b: Record<string, unknown>) => post(`/mix-designs/${id}/materials`, b),
  deleteMaterial: (id: string, rowId: string) =>
    apiFetch<Row>(`/mix-designs/${id}/materials/${rowId}`, { method: 'DELETE' }),
  approve: (id: string) => post(`/mix-designs/${id}/approve`),
  reject: (id: string) => post(`/mix-designs/${id}/reject`),
};

export const productionPlansApi = {
  list: () => apiFetch<Row[]>('/production-plans'),
  get: (id: string) => apiFetch<Row>(`/production-plans/${id}`),
  create: (b: Record<string, unknown>) => post('/production-plans', b),
  addItem: (id: string, b: Record<string, unknown>) => post(`/production-plans/${id}/items`, b),
  enqueue: (id: string) => post(`/production-plans/${id}/enqueue`),
};

export const batchQueueApi = {
  list: (status?: string) => apiFetch<Row[]>(`/batch-queue${status ? `?status=${status}` : ''}`),
  enqueueFromOrder: (orderId: string) => post(`/batch-queue/from-order/${orderId}`),
};

export const batchTicketsApi = {
  list: (status?: string) => apiFetch<Row[]>(`/batch-tickets${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/batch-tickets/${id}`),
  createFromQueue: (queueId: string, b: Record<string, unknown>) => post(`/batch-tickets/from-queue/${queueId}`, b),
  updateActuals: (id: string, materials: Record<string, unknown>[]) => post(`/batch-tickets/${id}/actuals`, { materials }),
  confirm: (id: string, overrideVariance?: boolean) => post(`/batch-tickets/${id}/confirm`, { overrideVariance }),
  cancel: (id: string) => post(`/batch-tickets/${id}/cancel`),
};

export const stockApi = {
  balances: () => apiFetch<Row[]>('/stock/balances'),
  ledger: (materialId?: string) => apiFetch<Row[]>(`/stock/ledger${materialId ? `?materialId=${materialId}` : ''}`),
  setOpening: (b: Record<string, unknown>) => post('/stock/opening', b),
};

export const productionReportsApi = {
  summary: () => apiFetch<{ byGrade: Row[]; totals: Row }>('/production-reports/summary'),
  variance: () => apiFetch<Row[]>('/production-reports/variance'),
  consumption: () => apiFetch<Row[]>('/production-reports/material-consumption'),
};

// ---- Dispatch & delivery challan (Sprint 7) ----
export const dispatchApi = {
  list: (status?: string) => apiFetch<Row[]>(`/dispatches${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/dispatches/${id}`),
  createFromBatch: (batchTicketId: string, b: Record<string, unknown>) => post(`/dispatches/from-batch-ticket/${batchTicketId}`, b),
  setStatus: (id: string, status: string, extra: Record<string, unknown> = {}) => post(`/dispatches/${id}/status`, { status, ...extra }),
};

export const challansApi = {
  list: (status?: string) => apiFetch<Row[]>(`/delivery-challans${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/delivery-challans/${id}`),
  createFromDispatch: (dispatchId: string, b: Record<string, unknown>) => post(`/delivery-challans/from-dispatch/${dispatchId}`, b),
  issue: (id: string) => post(`/delivery-challans/${id}/issue`),
  deliver: (id: string, b: Record<string, unknown>) => post(`/delivery-challans/${id}/deliver`, b),
  cancel: (id: string, reason: string) => post(`/delivery-challans/${id}/cancel`, { reason }),
  share: (id: string, mobile: string) => post(`/delivery-challans/${id}/share`, { mobile }),
};

// ---- Inventory & weighbridge (Sprint 8) ----
export const materialInwardApi = {
  list: (status?: string) => apiFetch<Row[]>(`/material-inwards${status ? `?status=${status}` : ''}`),
  create: (b: Record<string, unknown>) => post('/material-inwards', b),
  post: (id: string) => post(`/material-inwards/${id}/post`),
  cancel: (id: string) => post(`/material-inwards/${id}/cancel`),
};

export const weighbridgeApi = {
  list: (status?: string) => apiFetch<Row[]>(`/weighbridge${status ? `?status=${status}` : ''}`),
  create: (b: Record<string, unknown>) => post('/weighbridge', b),
  toInward: (id: string, rate: number) => post(`/weighbridge/${id}/to-inward`, { rate }),
  setStatus: (id: string, status: string) => post(`/weighbridge/${id}/status`, { status }),
};

export const stockAdjustApi = {
  adjust: (b: Record<string, unknown>) => post('/stock-adjustments', b),
};

export const negativeStockApi = {
  list: (status?: string) => apiFetch<Row[]>(`/negative-stock-requests${status ? `?status=${status}` : ''}`),
  approve: (id: string, remarks: string) => post(`/negative-stock-requests/${id}/approve`, { remarks }),
  reject: (id: string, remarks: string) => post(`/negative-stock-requests/${id}/reject`, { remarks }),
};

export const inventoryReportsApi = {
  lowStock: () => apiFetch<Row[]>('/inventory-reports/low-stock'),
  negativeStock: () => apiFetch<Row[]>('/inventory-reports/negative-stock'),
  valuation: () => apiFetch<{ rows: Row[]; total: number }>('/inventory-reports/valuation'),
  movement: () => apiFetch<Row[]>('/inventory-reports/movement'),
};

// ---- Billing & payments (Sprint 9) ----
export const invoicesApi = {
  list: (status?: string) => apiFetch<Row[]>(`/invoices${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/invoices/${id}`),
  billableChallans: (customerId: string) => apiFetch<Row[]>(`/invoices/billable-challans?customerId=${customerId}`),
  fromChallans: (b: Record<string, unknown>) => post('/invoices/from-challans', b),
  issue: (id: string) => post(`/invoices/${id}/issue`),
  cancel: (id: string, reason: string) => post(`/invoices/${id}/cancel`, { reason }),
  share: (id: string, mobile: string) => post(`/invoices/${id}/share`, { mobile }),
};

export const receiptsApi = {
  list: () => apiFetch<Row[]>('/receipts'),
  get: (id: string) => apiFetch<Row>(`/receipts/${id}`),
  create: (b: Record<string, unknown>) => post('/receipts', b),
  share: (id: string, mobile: string) => post(`/receipts/${id}/share`, { mobile }),
};

export const billingReportsApi = {
  outstanding: () => apiFetch<{ rows: Row[]; totals: Row }>('/billing-reports/outstanding'),
  salesRegister: () => apiFetch<{ rows: Row[]; total: number; taxable: number; count: number }>('/billing-reports/sales-register'),
  gstSummary: () => apiFetch<Row>('/billing-reports/gst-summary'),
  receiptsRegister: () => apiFetch<Row[]>('/billing-reports/receipts-register'),
};

/** Download the Tally export CSV (auth header required). */
export async function downloadTallyCsv(): Promise<void> {
  const token = getSession()?.token;
  const res = await fetch(`${BASE}/api/v1/billing-reports/tally-export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Failed to export');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = 'tally-sales-export.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- Dashboard, reports center, sync (Sprint 10) ----
export const dashboardApi = {
  summary: () => apiFetch<Row>('/dashboard/summary'),
  funnel: () => apiFetch<Row>('/dashboard/operations-funnel'),
};

export const reportsCatalogApi = {
  catalog: () => apiFetch<{ groups: { module: string; reports: { key: string; name: string; path: string }[] }[] }>('/reports/catalog'),
};

// ---- AI assistant (Phase 4) ----
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}
export const aiApi = {
  status: () => apiFetch<{ enabled: boolean }>('/ai/status'),
  chat: (messages: ChatTurn[]) =>
    apiFetch<{ reply: string }>('/ai/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }),
  insights: () => apiFetch<{ insights: string; generatedAt: string }>('/ai/insights'),
  draft: (kind: string, context: Record<string, unknown>, instructions?: string) =>
    apiFetch<{ text: string }>('/ai/draft', {
      method: 'POST',
      body: JSON.stringify({ kind, context, instructions }),
    }),
};

export const syncApi = {
  devices: () => apiFetch<Row[]>('/sync/devices'),
  reservations: () => apiFetch<Row[]>('/sync/number-reservations'),
  conflicts: (status?: string) => apiFetch<Row[]>(`/sync/conflicts${status ? `?status=${status}` : ''}`),
  resolveConflict: (id: string, resolution: string) => post(`/sync/conflicts/${id}/resolve`, { resolution }),
};

/** Fetch a PDF as a blob (auth header required) and open it in a new tab. */
export async function openPdf(path: string): Promise<void> {
  const token = getSession()?.token;
  const res = await fetch(`${BASE}/api/v1${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Failed to load PDF');
  const url = URL.createObjectURL(await res.blob());
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Fetch the quotation PDF as a blob (auth header required) and open it. */
export async function openQuotationPdf(id: string): Promise<void> {
  const token = getSession()?.token;
  const res = await fetch(`${BASE}/api/v1/quotations/${id}/pdf`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Failed to load PDF');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
