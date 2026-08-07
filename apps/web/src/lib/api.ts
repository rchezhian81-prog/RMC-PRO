import { clearSession, getSession, updateTokens } from './session';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Error carrying a message that is already fit to show a plant operator.
 *
 * `toString()` returns the bare message instead of Node's `"Error: <message>"`,
 * so the many screens that render `String(e)` show "Cannot reach the server"
 * rather than "Error: Failed to fetch". Every throw below uses this class.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  override toString(): string {
    return this.message;
  }
}

/** Map a transport-level failure to something a non-technical user can act on. */
function networkError(): ApiError {
  return new ApiError('Cannot reach the server. Check your internet connection and try again.');
}

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

/**
 * Creates that are currently in flight, keyed by method + path + body.
 *
 * A slow save shows no feedback for a second or two, so the natural reaction is
 * to click again — which would post a second quotation, order or challan into
 * the live ledger. While an identical create is still running, a repeat call
 * joins the first instead of starting another.
 *
 * Only concurrent duplicates collapse: once the first request settles its entry
 * is removed, so deliberately creating the same thing twice still works.
 */
const inFlightCreates = new Map<string, Promise<unknown>>();

/**
 * 403 codes whose server message is shown as-is. These are subscription
 * decisions ("your plan does not include this", "your account is suspended"),
 * not role decisions, so the generic permission wording would misdirect.
 */
const PASS_THROUGH_403 = new Set(['MODULE_NOT_ENABLED', 'TENANT_SUSPENDED', 'SUBSCRIPTION_EXPIRED']);

/**
 * Where the reason for a forced sign-out is left for the login screen to pick
 * up. Deliberately not a query parameter: a link anyone can craft would put
 * arbitrary text on the sign-in page.
 */
export const BLOCKED_REASON_KEY = 'rmc_blocked_reason';

/**
 * A suspended company cannot do anything, so leaving the operator inside an app
 * where every click fails would be worse than signing them out. End the session
 * and carry the reason to the login screen.
 */
function endSessionAsBlocked(message: string): void {
  clearSession();
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(BLOCKED_REASON_KEY, message);
  } catch {
    // Private-browsing modes can refuse storage; the redirect still matters.
  }
  if (window.location.pathname !== '/login') window.location.href = '/login';
}

async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return performFetch<T>(path, opts);

  const key = `${method} ${path} ${typeof opts.body === 'string' ? opts.body : ''}`;
  const existing = inFlightCreates.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = performFetch<T>(path, opts);
  inFlightCreates.set(key, pending);
  // Settle-either-way cleanup. Both handlers are supplied so this derived
  // promise never rejects on its own; the caller still sees the real rejection.
  void pending.then(
    () => inFlightCreates.delete(key),
    () => inFlightCreates.delete(key),
  );
  return pending;
}

async function performFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await request(path, opts, getSession()?.token);
  } catch {
    throw networkError();
  }

  // Access token expired mid-session: refresh once and retry the request. If we
  // have no refresh token (e.g. the login call itself), skip straight to the
  // normal error path so bad credentials surface as-is.
  if (res.status === 401 && getSession()?.refreshToken) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      try {
        res = await request(path, opts, newToken);
      } catch {
        throw networkError();
      }
    } else {
      // Refresh token is gone or expired — end the session cleanly instead of
      // showing a cryptic error, and send the user back to sign in.
      clearSession();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
      throw new ApiError('Your session has expired. Please sign in again.', 401);
    }
  }

  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    const err = json?.error ?? {};
    // A 403 from the permissions guard reads as "Missing required permission";
    // say what that means for the person looking at the screen.
    //
    // The subscription refusals are the exception: they already carry a message
    // written for a plant operator, and replacing it would send someone to their
    // administrator over something only Mix Nova can change.
    // The company itself has been blocked — nothing in the app will work, so
    // sign out rather than let every screen fail one at a time. Not applied to
    // the login call: there is no session to end and the form shows the reason.
    if (res.status === 403 && err.code === 'TENANT_SUSPENDED' && getSession()?.token) {
      const message = String(err.message ?? 'Your company account is not active.');
      endSessionAsBlocked(message);
      throw new ApiError(message, 403, err.code);
    }
    if (res.status === 403 && !PASS_THROUGH_403.has(String(err.code ?? ''))) {
      throw new ApiError(
        'You do not have permission to do that. Ask your administrator to update your role.',
        403,
        err.code,
      );
    }
    if (res.status >= 500) {
      throw new ApiError('The server had a problem completing that. Please try again.', res.status, err.code);
    }
    const message = err.message ?? err.code ?? res.statusText ?? 'Request failed';
    throw new ApiError(Array.isArray(message) ? message.join('; ') : String(message), res.status, err.code);
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
  /** Module keys the company's subscription includes. */
  modules: string[];
}
/** Seats and plants a plan allows, against what the tenant is using. */
export interface PlanUsage {
  planName: string | null;
  /** `limit: null` means no plan is assigned, so nothing is capped. */
  users: { used: number; limit: number | null };
  plants: { used: number; limit: number | null };
}
export interface MeResult {
  user: { email: string; userType: string };
  tenant: { code: string; name: string; status: string } | null;
  permissions: string[];
  roles: string[];
  modules: string[];
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
  /** Change your own password — any signed-in user, no permission required. */
  changePassword: (currentPassword: string, newPassword: string) =>
    apiFetch<{ changed: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),
  /** Who am I, and what does this company's subscription currently include. */
  me: () => apiFetch<MeResult>('/auth/me'),
  tenants: () => apiFetch<TenantRow[]>('/platform/tenants'),
  createTenant: (b: { tenantCode: string; tenantName: string; planId?: string }) =>
    apiFetch<{ id: string }>('/platform/tenants', { method: 'POST', body: JSON.stringify(b) }),
  tenant: (id: string) =>
    apiFetch<TenantRow & { planCode: string | null; usage: PlanUsage }>(`/platform/tenants/${id}`),
  /**
   * Change a tenant's subscription status. Suspending one stops every user of
   * that company signing in, and stops the sessions they already hold.
   */
  updateTenant: (id: string, b: { status?: string; tenantName?: string; legalName?: string }) =>
    apiFetch<TenantRow>(`/platform/tenants/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  assignPlan: (id: string, planId: string) =>
    apiFetch<TenantModuleRow[]>(`/platform/tenants/${id}/assign-plan`, {
      method: 'POST',
      body: JSON.stringify({ planId }),
    }),
  tenantModules: (id: string) => apiFetch<TenantModuleRow[]>(`/platform/tenants/${id}/modules`),
  /** The whole of a tenant's data as one JSON document (offboarding/portability). */
  exportTenant: (id: string) =>
    apiFetch<{ exportedAt: string; tenant: { code: string; name: string }; rowCount: number; tableCount: number }>(
      `/platform/tenants/${id}/export`,
    ),
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
  /** Upload / replace the invoice logo. `data` is base64 (no data-URL prefix). */
  uploadLogo: (mime: string, data: string) =>
    apiFetch<{ hasLogo: boolean; logoMime: string }>('/company/logo', {
      method: 'PUT',
      body: JSON.stringify({ mime, data }),
    }),
  removeLogo: () => apiFetch<{ hasLogo: boolean }>('/company/logo', { method: 'DELETE' }),
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
  update: (id: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
};

/** What the tenant's plan allows, and how much of it is already used. */
export const planUsageApi = {
  get: () => apiFetch<PlanUsage>('/plan-usage'),
};

/** One entry in the audit trail — who did what, and when. */
export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  actorEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  summary: string;
  details: Record<string, unknown> | null;
}

/** Read-only view of the audit trail. */
export const auditApi = {
  list: (params: { search?: string; action?: string; limit?: number; offset?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.search) q.set('search', params.search);
    if (params.action) q.set('action', params.action);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    return apiFetch<AuditEntry[]>(`/audit-logs${qs ? `?${qs}` : ''}`);
  },
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

// ---- Alerts & message templates (no external service required) ----
export interface Alert {
  key: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  detail: string;
  href: string;
  count?: number;
  amount?: number;
}

export interface MessageTemplate {
  key: string;
  name: string;
  description: string;
  channel: 'whatsapp' | 'email' | 'note';
  fields: string[];
  body: string;
}

export const alertsApi = {
  list: () => apiFetch<{ alerts: Alert[]; generatedAt: string }>('/alerts'),
};

export const templatesApi = {
  list: () => apiFetch<{ companyName: string; templates: MessageTemplate[] }>('/message-templates'),
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
  extractPo: (fileBase64: string, mediaType: string) =>
    apiFetch<{ extracted: PoExtract }>('/ai/extract-po', {
      method: 'POST',
      body: JSON.stringify({ fileBase64, mediaType }),
    }),
};

export interface PoExtract {
  customerName: string | null;
  siteName: string | null;
  poNumber: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  contactMobile: string | null;
  items: { grade: string | null; quantityM3: number | null; rate: number | null }[];
  notes: string | null;
}

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
