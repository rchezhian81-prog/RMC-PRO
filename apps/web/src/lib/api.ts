import { clearSession, getSession, updateAccessToken } from './session';

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
    /** Per-field validation messages from a VALIDATION_ERROR, if any. */
    readonly fields?: Record<string, string>,
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
 * token, or null if the refresh cookie is missing/expired.
 *
 * The refresh token is never in JavaScript's hands: it rides in the httpOnly
 * `rmc_rt` cookie, which the browser attaches automatically because this call
 * sends `credentials: 'include'`. We send no body token — the cookie IS the
 * credential. The server rotates the cookie and returns only a new access token.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) return null;
        const { access_token } = json.data as { access_token: string };
        updateAccessToken(access_token);
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

  // Access token expired mid-session: refresh once (via the httpOnly cookie) and
  // retry. With no session at all (e.g. the login call itself) skip straight to
  // the normal error path so bad credentials surface as-is.
  if (res.status === 401 && getSession()) {
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
    const fields =
      err.fields && typeof err.fields === 'object' ? (err.fields as Record<string, string>) : undefined;
    throw new ApiError(Array.isArray(message) ? message.join('; ') : String(message), res.status, err.code, fields);
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
/** A single plan with its enabled module keys — for the edit form. */
export interface PlanDetail {
  id: string;
  code: string;
  name: string;
  monthlyPrice: number;
  yearlyPrice: number;
  maxPlants: number;
  maxUsers: number;
  isActive: boolean;
  modules: string[];
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
      // Let the browser store the httpOnly refresh cookie the server sets.
      credentials: 'include',
    }),
  /**
   * End the session: tell the server to clear the httpOnly refresh cookie, so it
   * cannot be used again. `credentials: 'include'` sends the cookie so the
   * server can match and clear it. Best-effort — the caller clears the local
   * session regardless (see the layout Logout buttons).
   */
  logout: () =>
    apiFetch<{ loggedOut: boolean }>('/auth/logout', { method: 'POST', credentials: 'include' }),
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
  getPlan: (id: string) => apiFetch<PlanDetail>(`/platform/plans/${id}`),
  updatePlan: (
    id: string,
    b: { planName?: string; monthlyPrice?: number; yearlyPrice?: number; maxPlants?: number; maxUsers?: number; isActive?: boolean },
  ) => apiFetch<{ id: string }>(`/platform/plans/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  createPlan: (b: {
    planCode: string;
    planName: string;
    monthlyPrice?: number;
    yearlyPrice?: number;
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
    // Pass { active: true } to fetch only active rows (pick-lists); default = all.
    list: (params?: { active?: boolean }) => apiFetch<Row[]>(`/${path}${params?.active ? '?active=true' : ''}`),
    create: (b: Record<string, unknown>) =>
      apiFetch<Row>(`/${path}`, { method: 'POST', body: JSON.stringify(b) }),
    update: (id: string, b: Record<string, unknown>) =>
      apiFetch<Row>(`/${path}/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
    remove: (id: string) => apiFetch<Row>(`/${path}/${id}`, { method: 'DELETE' }),
    reactivate: (id: string) => apiFetch<Row>(`/${path}/${id}/reactivate`, { method: 'PATCH' }),
  };
}

/** A customer's live credit exposure breakdown (single source of truth). */
export type CustomerExposure = {
  openingBalance: number;
  unInvoicedOrderValue: number;
  invoiceOutstanding: number;
  advanceCredit: number;
  exposure: number;
  creditLimit: number;
  /** credit_limit − exposure, or null when no limit is configured (unlimited). */
  availableCredit: number | null;
};

export const customersApi = {
  exposure: (id: string) => apiFetch<CustomerExposure>(`/customers/${id}/exposure`),
};

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

export interface SettingRow {
  key: string;
  label: string;
  description: string;
  type: 'string' | 'number' | 'boolean' | 'enum';
  options: { value: string; label: string }[] | null;
  value: string;
}
export const settings = {
  list: () => apiFetch<SettingRow[]>('/settings'),
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
  updateItem: (id: string, itemId: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/quotations/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(b) }),
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
  update: (id: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/rate-contracts/${id}`, { method: 'PATCH', body: JSON.stringify(b) }),
  addItem: (id: string, b: Record<string, unknown>) => post(`/rate-contracts/${id}/items`, b),
  updateItem: (id: string, itemId: string, b: Record<string, unknown>) =>
    apiFetch<Row>(`/rate-contracts/${id}/items/${itemId}`, { method: 'PATCH', body: JSON.stringify(b) }),
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
  addPourSlot: (id: string, b: Record<string, unknown>) => post(`/orders/${id}/pour-slots`, b),
  removePourSlot: (id: string, slotId: string) =>
    apiFetch<Row>(`/orders/${id}/pour-slots/${slotId}`, { method: 'DELETE' }),
  setLineSlump: (id: string, itemId: string, slump: string) => post(`/orders/${id}/items/${itemId}/slump`, { slump }),
  setReturnBilling: (id: string, policy: string, feePerM3?: number) => post(`/orders/${id}/return-billing`, { policy, feePerM3 }),
  orderBook: () => apiFetch<{ rows: Row[]; totals: Row }>('/orders/order-book'),
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
  removeItem: (id: string, itemId: string) =>
    apiFetch<Row>(`/production-plans/${id}/items/${itemId}`, { method: 'DELETE' }),
  setStatus: (id: string, status: string) => post(`/production-plans/${id}/status`, { status }),
  enqueue: (id: string) => post(`/production-plans/${id}/enqueue`),
};

export const batchQueueApi = {
  list: (status?: string) => apiFetch<Row[]>(`/batch-queue${status ? `?status=${status}` : ''}`),
  enqueueFromOrder: (orderId: string) => post(`/batch-queue/from-order/${orderId}`),
  setStatus: (id: string, status: string) => post(`/batch-queue/${id}/status`, { status }),
};

export const batchTicketsApi = {
  list: (status?: string) => apiFetch<Row[]>(`/batch-tickets${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/batch-tickets/${id}`),
  createFromQueue: (queueId: string, b: Record<string, unknown>) => post(`/batch-tickets/from-queue/${queueId}`, b),
  updateActuals: (id: string, materials: Record<string, unknown>[]) => post(`/batch-tickets/${id}/actuals`, { materials }),
  confirm: (id: string, overrideVariance?: boolean) => post(`/batch-tickets/${id}/confirm`, { overrideVariance }),
  cancel: (id: string) => post(`/batch-tickets/${id}/cancel`),
};

// A4 batching integration: controller registry + ingest actuals into a ticket.
export interface BatchIngestResult {
  batchTicketId: string;
  controllerId: string;
  controllerName: string;
  source: string;
  varianceExceeded: boolean;
  reconciliation: {
    matchedCount: number;
    varianceExceeded: boolean;
    unmatchedLog: { material: string; actual: number }[];
    lines: { materialLabel: string | null; matched: boolean; actual: number; variancePercentage: number; withinTolerance: boolean }[];
  };
}
export const batchingControllerApi = {
  list: () => apiFetch<Row[]>(`/batching-controllers`),
  create: (b: Record<string, unknown>) => post('/batching-controllers', b),
  update: (id: string, b: Record<string, unknown>) => post(`/batching-controllers/${id}`, b),
  ingest: (id: string, batchTicketId: string, rawLog?: string, batchRef?: string) =>
    apiFetch<BatchIngestResult>(`/batching-controllers/${id}/ingest`, {
      method: 'POST',
      body: JSON.stringify({ batchTicketId, ...(rawLog ? { rawLog } : {}), ...(batchRef ? { batchRef } : {}) }),
    }),
};

export const stockApi = {
  balances: () => apiFetch<Row[]>('/stock/balances'),
  ledger: (materialId?: string) => apiFetch<Row[]>(`/stock/ledger${materialId ? `?materialId=${materialId}` : ''}`),
  setOpening: (b: Record<string, unknown>) => post('/stock/opening', b),
};

const dateQs = (from?: string, to?: string) => {
  const parts = [from ? `from=${from}` : '', to ? `to=${to}` : ''].filter(Boolean);
  return parts.length ? `?${parts.join('&')}` : '';
};

export const productionReportsApi = {
  summary: (from?: string, to?: string) => apiFetch<{ byGrade: Row[]; totals: Row }>(`/production-reports/summary${dateQs(from, to)}`),
  variance: () => apiFetch<Row[]>('/production-reports/variance'),
  consumption: (from?: string, to?: string) => apiFetch<Row[]>(`/production-reports/material-consumption${dateQs(from, to)}`),
  batchRegister: (from?: string, to?: string) => apiFetch<{ rows: Row[]; totalM3: number; count: number }>(`/production-reports/batch-register${dateQs(from, to)}`),
  planVsActual: (from?: string, to?: string) => apiFetch<{ rows: Row[]; totals: Row }>(`/production-reports/plan-vs-actual${dateQs(from, to)}`),
};

// ---- Dispatch & delivery challan (Sprint 7) ----
export const dispatchApi = {
  list: (status?: string) => apiFetch<Row[]>(`/dispatches${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/dispatches/${id}`),
  createFromBatch: (batchTicketId: string, b: Record<string, unknown>) => post(`/dispatches/from-batch-ticket/${batchTicketId}`, b),
  setStatus: (id: string, status: string, extra: Record<string, unknown> = {}) => post(`/dispatches/${id}/status`, { status, ...extra }),
  cycleTimes: (from?: string, to?: string) =>
    apiFetch<{ rows: Row[]; averages: Row; count: number }>(`/dispatches/report/cycle-times${dateQs(from, to)}`),
  fleetUtilization: (from?: string, to?: string) =>
    apiFetch<{ rows: Row[]; totals: Row }>(`/dispatches/report/fleet-utilization${dateQs(from, to)}`),
};

export const challansApi = {
  list: (status?: string) => apiFetch<Row[]>(`/delivery-challans${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/delivery-challans/${id}`),
  createFromDispatch: (dispatchId: string, b: Record<string, unknown>) => post(`/delivery-challans/from-dispatch/${dispatchId}`, b),
  issue: (id: string) => post(`/delivery-challans/${id}/issue`),
  deliver: (id: string, b: Record<string, unknown>) => post(`/delivery-challans/${id}/deliver`, b),
  cancel: (id: string, reason: string) => post(`/delivery-challans/${id}/cancel`, { reason }),
  share: (id: string, mobile: string) => post(`/delivery-challans/${id}/share`, { mobile }),
  // Returned / short-load concrete wastage report (Plan B3).
  wastageReport: (params: { from?: string; to?: string; plantId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.plantId) qs.set('plantId', params.plantId);
    const s = qs.toString();
    return apiFetch<Row>(`/delivery-challans/report/wastage${s ? `?${s}` : ''}`);
  },
  deliveryRegister: (params: { from?: string; to?: string; plantId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.plantId) qs.set('plantId', params.plantId);
    const s = qs.toString();
    return apiFetch<{ rows: Row[]; totalM3: number; count: number }>(`/delivery-challans/report/delivery-register${s ? `?${s}` : ''}`);
  },
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

// E1 weighbridge hardware bridge: indicator devices + the live "Get weight" read.
export interface WeighbridgeReading {
  indicatorId: string;
  indicatorName: string;
  connectionType: string;
  stable: boolean;
  type: string;
  unit: string;
  weight: number;
  weightKg: number;
  capturedAt: string;
  raw: string;
}
export const weighbridgeIndicatorApi = {
  list: () => apiFetch<Row[]>(`/weighbridge-indicators`),
  create: (b: Record<string, unknown>) => post('/weighbridge-indicators', b),
  update: (id: string, b: Record<string, unknown>) => post(`/weighbridge-indicators/${id}`, b),
  read: (id: string, rawFrames?: string[]) =>
    apiFetch<WeighbridgeReading>(`/weighbridge-indicators/${id}/read`, {
      method: 'POST',
      body: JSON.stringify(rawFrames ? { rawFrames } : {}),
    }),
};

export const stockAdjustApi = {
  list: () => apiFetch<Row[]>('/stock-adjustments'),
  adjust: (b: Record<string, unknown>) => post('/stock-adjustments', b),
};

// ---- Notification / WhatsApp send log ----
export const notificationsApi = {
  history: () => apiFetch<Row[]>('/notifications'),
};

// ---- Agent governor (the multi-agent substrate control surface) ----
export interface AgentControls { automationPaused: boolean; maxStepsPerRun: number; maxActionsPerRun: number }
export const agentsApi = {
  controls: () => apiFetch<AgentControls>('/agents/controls'),
  setControls: (b: Partial<AgentControls>) => apiFetch<AgentControls>('/agents/controls', { method: 'PUT', body: JSON.stringify(b) }),
  pauses: () => apiFetch<Record<string, boolean>>('/agents/pauses'),
  setPause: (name: string, paused: boolean) => apiFetch<{ agentName: string; paused: boolean }>(`/agents/pauses/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify({ paused }) }),
  catalog: () => apiFetch<Array<{ name: string; description: string; tools: string[] }>>('/agents/catalog'),
  llm: () => apiFetch<{ configured: boolean; provider: string; model: string; askEnabledAgents: string[] }>('/agents/llm'),
  runs: (limit = 50) => apiFetch<Row[]>(`/agents/runs?limit=${limit}`),
  // The following require the higher-trust agents.approve permission.
  approvals: (status = 'pending') => apiFetch<Row[]>(`/agents/approvals?status=${encodeURIComponent(status)}`),
  decide: (id: string, decision: 'approved' | 'rejected', reason?: string) => post(`/agents/approvals/${id}/decide`, { decision, reason }),
  gstStatus: () => apiFetch<{ configured: boolean; provider: string }>('/agents/gst'),
  gstJobs: () => apiFetch<Row[]>('/agents/gst/jobs'),
  drainGstJobs: () => post('/agents/gst/jobs/drain', {}),
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
  movement: (from?: string, to?: string) => apiFetch<Row[]>(`/inventory-reports/movement${dateQs(from, to)}`),
};

// ---- Billing & payments (Sprint 9) ----
export const invoicesApi = {
  list: (status?: string) => apiFetch<Row[]>(`/invoices${status ? `?status=${status}` : ''}`),
  get: (id: string) => apiFetch<Row>(`/invoices/${id}`),
  billableChallans: (customerId: string) => apiFetch<Row[]>(`/invoices/billable-challans?customerId=${customerId}`),
  fromChallans: (b: Record<string, unknown>) => post('/invoices/from-challans', b),
  issue: (id: string) => post(`/invoices/${id}/issue`),
  cancel: (id: string, reason: string) => post(`/invoices/${id}/cancel`, { reason }),
  writeoff: (id: string, amount: number, reason: string) => post(`/invoices/${id}/writeoff`, { amount, reason }),
  share: (id: string, mobile: string) => post(`/invoices/${id}/share`, { mobile }),
  // e-way transport details (transporter, vehicle, mode, distance) — feed the e-way bill.
  setTransport: (id: string, b: Record<string, unknown>) => apiFetch<Row>(`/invoices/${id}/transport`, { method: 'PATCH', body: JSON.stringify(b) }),
};

// ---- GST live compliance (IRP / e-way) — prepare → approve → execute ----
export interface GstStatus {
  configured: boolean;
  provider: string;
}
export interface GstOutcome {
  status: string;
  reference?: string;
  errors?: string[];
  detail?: Record<string, unknown>;
}

/**
 * Drive one approved GST action end to end: PREPARE it (the automation agent files
 * a pending approval), APPROVE it (this operator's click is the human decision),
 * then EXECUTE it. Returns the execution outcome; a 'failed'/'skipped' outcome is
 * surfaced as an error so the caller shows it instead of a false success.
 */
async function runCompliance(
  invoiceId: string,
  compliance: 'einvoice' | 'eway' | 'einvoice_cancel' | 'eway_cancel',
  extra: Record<string, unknown> = {},
): Promise<GstOutcome> {
  const run = await apiFetch<{ outcome?: { result?: { prepared?: { approvalId?: string } } } }>(
    '/agents/automation/run',
    { method: 'POST', body: JSON.stringify({ compliance, invoiceId, ...extra }) },
  );
  const approvalId = run?.outcome?.result?.prepared?.approvalId;
  if (!approvalId) throw new ApiError('Could not prepare the GST action.');
  await apiFetch(`/agents/approvals/${approvalId}/decide`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'approved' }),
  });
  const out = await apiFetch<GstOutcome>(`/agents/approvals/${approvalId}/execute`, { method: 'POST' });
  if (out?.status === 'failed') throw new ApiError((out.errors ?? []).join('; ') || 'The GST action failed.');
  if (out?.status === 'skipped') throw new ApiError('GST transmission is not enabled (prepare-only mode).');
  return out;
}

export const gstApi = {
  /** Whether a live GST provider is configured for this deployment. */
  status: () => apiFetch<GstStatus>('/agents/gst'),
  generateIrn: (invoiceId: string) => runCompliance(invoiceId, 'einvoice'),
  cancelIrn: (invoiceId: string, reasonCode: string, remarks?: string) =>
    runCompliance(invoiceId, 'einvoice_cancel', { reasonCode, ...(remarks ? { remarks } : {}) }),
  generateEway: (invoiceId: string) => runCompliance(invoiceId, 'eway'),
  cancelEway: (invoiceId: string, reasonCode: string, remarks?: string) =>
    runCompliance(invoiceId, 'eway_cancel', { reasonCode, ...(remarks ? { remarks } : {}) }),
};

// GST-portal credentials (per GSTIN). The server only ever returns REDACTED
// status — the username/password never come back.
export interface GstCredentialStatus {
  gstin: string;
  configured: boolean;
  lastTestedAt: string | null;
  lastTestSuccess: boolean | null;
  lastTestMessage: string | null;
}
export const gstCredentialsApi = {
  list: () => apiFetch<GstCredentialStatus[]>('/compliance/gst-credentials'),
  set: (gstin: string, username: string, password: string) =>
    post('/compliance/gst-credentials', { gstin, username, password }),
  remove: (gstin: string) =>
    apiFetch<{ deleted: boolean }>(`/compliance/gst-credentials/${encodeURIComponent(gstin)}`, { method: 'DELETE' }),
  test: (gstin: string) => post(`/compliance/gst-credentials/${encodeURIComponent(gstin)}/test`),
};

export const receiptsApi = {
  list: () => apiFetch<Row[]>('/receipts'),
  get: (id: string) => apiFetch<Row>(`/receipts/${id}`),
  create: (b: Record<string, unknown>) => post('/receipts', b),
  realise: (id: string) => post(`/receipts/${id}/realise`),
  bounce: (id: string, reason: string) => post(`/receipts/${id}/bounce`, { reason }),
  apply: (id: string) => post(`/receipts/${id}/apply`),
  share: (id: string, mobile: string) => post(`/receipts/${id}/share`, { mobile }),
};

export type StatementRow = { date: string | null; type: string; ref: string; particulars: string; debit: number; credit: number; balance: number };
export type CustomerStatement = { customerName: string; opening: number; rows: StatementRow[]; totalDebit: number; totalCredit: number; closing: number; from: string | null; to: string | null };

export type GstBucket = { count: number; taxable: number; total: number };
export type SalesRegister = { rows: Row[]; total: number; taxable: number; count: number; summary: { b2b: GstBucket; b2c: GstBucket } };
export const billingReportsApi = {
  outstanding: () => apiFetch<{ rows: Row[]; totals: Row }>('/billing-reports/outstanding'),
  salesRegister: (from?: string, to?: string) => apiFetch<SalesRegister>(`/billing-reports/sales-register${dateQs(from, to)}`),
  gstSummary: (from?: string, to?: string) => apiFetch<Row>(`/billing-reports/gst-summary${dateQs(from, to)}`),
  hsnSummary: (from?: string, to?: string) => apiFetch<{ rows: Row[]; totals: Row }>(`/billing-reports/hsn-summary${dateQs(from, to)}`),
  receiptsRegister: (from?: string, to?: string) => apiFetch<Row[]>(`/billing-reports/receipts-register${dateQs(from, to)}`),
  gstr3b: (from?: string, to?: string) => apiFetch<{ output: Row; itc: Row; net: Row; from: string | null; to: string | null }>(`/billing-reports/gstr-3b${dateQs(from, to)}`),
  dayBook: (from?: string, to?: string) => apiFetch<{ rows: Row[]; totals: Row; byMode: Row[]; from: string | null; to: string | null }>(`/billing-reports/day-book${dateQs(from, to)}`),
  salesMis: (from?: string, to?: string) => apiFetch<{ byCustomer: Row[]; byPlant: Row[]; byGrade: Row[]; totals: Row; from: string | null; to: string | null }>(`/billing-reports/sales-mis${dateQs(from, to)}`),
  customerStatement: (customerId: string, from?: string, to?: string) =>
    apiFetch<CustomerStatement>(
      `/billing-reports/customer-statement?customerId=${encodeURIComponent(customerId)}` +
        (from ? `&from=${from}` : '') + (to ? `&to=${to}` : ''),
    ),
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

// ---- QC / Lab (Plan A3) ----
export const qcApi = {
  slumpList: () => apiFetch<Row[]>('/qc/slump-tests'),
  slumpCreate: (b: Record<string, unknown>) => post('/qc/slump-tests', b),
  cubeSets: (status?: string) => apiFetch<Row[]>(`/qc/cube-sets${status ? `?status=${status}` : ''}`),
  cubeSet: (id: string) => apiFetch<Row>(`/qc/cube-sets/${id}`),
  cubeSetCreate: (b: Record<string, unknown>) => post('/qc/cube-sets', b),
  recordResults: (id: string, results: Record<string, unknown>[]) =>
    post(`/qc/cube-sets/${id}/results`, { results }),
  cubeRegister: (from?: string, to?: string) => apiFetch<{ rows: Row[]; count: number; accepted: number; rejected: number }>(`/qc/cube-register${dateQs(from, to)}`),
  slumpRegister: (from?: string, to?: string) => apiFetch<{ rows: Row[]; count: number; passed: number; failed: number }>(`/qc/slump-register${dateQs(from, to)}`),
};

// ---- Purchase / AP-lite (Plan D2) ----
export const purchaseApi = {
  orders: (status?: string) => apiFetch<Row[]>(`/purchase-orders${status ? `?status=${status}` : ''}`),
  order: (id: string) => apiFetch<Row>(`/purchase-orders/${id}`),
  createOrder: (b: Record<string, unknown>) => post('/purchase-orders', b),
  issueOrder: (id: string) => post(`/purchase-orders/${id}/issue`),
  cancelOrder: (id: string) => post(`/purchase-orders/${id}/cancel`),
  grns: (status?: string) => apiFetch<Row[]>(`/goods-receipts${status ? `?status=${status}` : ''}`),
  grn: (id: string) => apiFetch<Row>(`/goods-receipts/${id}`),
  createGrn: (b: Record<string, unknown>) => post('/goods-receipts', b),
  postGrn: (id: string) => post(`/goods-receipts/${id}/post`),
  bills: (status?: string) => apiFetch<Row[]>(`/vendor-bills${status ? `?status=${status}` : ''}`),
  bill: (id: string) => apiFetch<Row>(`/vendor-bills/${id}`),
  createBill: (b: Record<string, unknown>) => post('/vendor-bills', b),
  approveBill: (id: string) => post(`/vendor-bills/${id}/approve`),
  cancelBill: (id: string) => post(`/vendor-bills/${id}/cancel`),
  payments: () => apiFetch<Row[]>('/vendor-payments'),
  createPayment: (b: Record<string, unknown>) => post('/vendor-payments', b),
  reversePayment: (id: string, reason?: string) => post(`/vendor-payments/${id}/reverse`, { reason }),
  applyAdvance: (id: string, allocations: { billId: string; amount: number }[]) => post(`/vendor-payments/${id}/apply-advance`, { allocations }),
  itcRegister: (from?: string, to?: string) => apiFetch<{ rows: Row[]; totals: Row }>(`/purchase-reports/itc-register${dateQs(from, to)}`),
};

export type VendorLedger = { supplierName: string; opening: number; rows: Row[]; totalDebit: number; totalCredit: number; closing: number; from: string | null; to: string | null };
export const purchaseReportsApi = {
  payablesAging: () => apiFetch<{ rows: Row[]; totals: Row }>('/purchase-reports/payables-aging'),
  vendorLedger: (supplierId: string, from?: string, to?: string) => {
    const qs = new URLSearchParams({ supplierId });
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    return apiFetch<VendorLedger>(`/purchase-reports/vendor-ledger?${qs.toString()}`);
  },
  purchaseRegister: (from?: string, to?: string) =>
    apiFetch<{ rows: Row[]; byVendor: Row[]; byMaterial: Row[]; totals: Row }>(`/purchase-reports/purchase-register${dateQs(from, to)}`),
};

// ---- Bulk import framework (Plan F1) ----
export interface ImportColumn { key: string; label: string; required?: boolean; type?: string; example?: string }
export interface ImportDef { key: string; label: string; columns: ImportColumn[] }

export const importsApi = {
  definitions: () => apiFetch<ImportDef[]>('/imports/definitions'),
  jobs: () => apiFetch<Row[]>('/imports'),
  job: (id: string) => apiFetch<Row>(`/imports/${id}`),
  run: (entityType: string, content: string, fileName: string) => post(`/imports/${entityType}`, { content, fileName }),
};

/** Download a bulk-import CSV template for an entity type (auth header required). */
export async function downloadImportTemplate(entityType: string): Promise<void> {
  const token = getSession()?.token;
  const res = await fetch(`${BASE}/api/v1/imports/${entityType}/template`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error('Failed to download template');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `${entityType}-import-template.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---- Fleet maintenance & fuel log (Plan D3) ----
export const fleetApi = {
  schedules: (vehicleId?: string) => apiFetch<Row[]>(`/vehicle-service-schedules${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
  createSchedule: (b: Record<string, unknown>) => post('/vehicle-service-schedules', b),
  updateSchedule: (id: string, b: Record<string, unknown>) => apiFetch<Row>(`/vehicle-service-schedules/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  jobs: (vehicleId?: string, status?: string) => {
    const qs = new URLSearchParams();
    if (vehicleId) qs.set('vehicleId', vehicleId);
    if (status) qs.set('status', status);
    const s = qs.toString();
    return apiFetch<Row[]>(`/vehicle-maintenance-jobs${s ? `?${s}` : ''}`);
  },
  createJob: (b: Record<string, unknown>) => post('/vehicle-maintenance-jobs', b),
  completeJob: (id: string, b?: Record<string, unknown>) => post(`/vehicle-maintenance-jobs/${id}/complete`, b),
  cancelJob: (id: string) => post(`/vehicle-maintenance-jobs/${id}/cancel`),
  fuelLogs: (vehicleId?: string) => apiFetch<Row[]>(`/vehicle-fuel-logs${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
  createFuelLog: (b: Record<string, unknown>) => post('/vehicle-fuel-logs', b),
  fuelSummary: (vehicleId: string) => apiFetch<Row>(`/vehicle-fuel-logs/summary/${vehicleId}`),
};

// ---- Expense capture (Plan D4) ----
export const expensesApi = {
  groups: () => apiFetch<Row[]>('/expense-groups'),
  createGroup: (b: Record<string, unknown>) => post('/expense-groups', b),
  updateGroup: (id: string, b: Record<string, unknown>) => apiFetch<Row>(`/expense-groups/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  heads: () => apiFetch<Row[]>('/expense-heads'),
  createHead: (b: Record<string, unknown>) => post('/expense-heads', b),
  updateHead: (id: string, b: Record<string, unknown>) => apiFetch<Row>(`/expense-heads/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  vouchers: (status?: string) => apiFetch<Row[]>(`/expense-vouchers${status ? `?status=${status}` : ''}`),
  voucher: (id: string) => apiFetch<Row>(`/expense-vouchers/${id}`),
  createVoucher: (b: Record<string, unknown>) => post('/expense-vouchers', b),
  postVoucher: (id: string) => post(`/expense-vouchers/${id}/post`),
  cancelVoucher: (id: string) => post(`/expense-vouchers/${id}/cancel`),
  allocationReport: (params: { from?: string; to?: string; plantId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.plantId) qs.set('plantId', params.plantId);
    const s = qs.toString();
    return apiFetch<Row>(`/expense-vouchers/report/allocation${s ? `?${s}` : ''}`);
  },
};

// ---- Dashboard, reports center, sync (Sprint 10) ----
/** One daily activity trend-line: a dense, gap-filled series of points. */
export interface TrendSeries {
  key: string;
  label: string;
  unit: 'count' | 'inr';
  points: { d: string; v: number }[];
}
export interface TrendsResult {
  from: string | null;
  to: string | null;
  days: number;
  series: TrendSeries[];
}

export const dashboardApi = {
  summary: () => apiFetch<Row>('/dashboard/summary'),
  funnel: () => apiFetch<Row>('/dashboard/operations-funnel'),
  /** Daily activity trend-lines (default 30-day window). Read-only. */
  trends: (days = 30) => apiFetch<TrendsResult>(`/dashboard/trends?days=${days}`),
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

// ---- Document numbering — reserved-number pool (Plan F2) ----
export const numberingApi = {
  reservations: () => apiFetch<Row[]>('/sync/number-reservations'),
  reserve: (b: Record<string, unknown>) => post('/sync/number-reservations', b),
};

// ---- GPS tracking (the `gps` module) ----
export const gpsApi = {
  live: () => apiFetch<Row[]>('/gps/live'),
  track: (dispatchId: string) => apiFetch<Row>(`/gps/dispatches/${dispatchId}/track`),
  ping: (dispatchId: string, b: Record<string, unknown>) => post(`/gps/dispatches/${dispatchId}/ping`, b),
};

// ---- Document corrections / amendment trail (Plan F2) ----
export const correctionsApi = {
  list: (documentType?: string, documentId?: string) => {
    const qs = new URLSearchParams();
    if (documentType) qs.set('documentType', documentType);
    if (documentId) qs.set('documentId', documentId);
    const s = qs.toString();
    return apiFetch<Row[]>(`/document-corrections${s ? `?${s}` : ''}`);
  },
  record: (b: Record<string, unknown>) => post('/document-corrections', b),
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
