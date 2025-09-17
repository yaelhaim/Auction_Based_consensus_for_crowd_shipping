// app/lib/api.ts
// Unified API client for BidDrop (Expo).
// - Strong logging for every request (method, URL, body, status).
// - Typed responses for sender / courier / rider dashboards.
// - Consistent auth headers via helper.
// - Small, readable surface area.

// --------------------------- Base URL & bootstrap ---------------------------

import Constants from "expo-constants";

export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_POBA_API ??
  (Constants.expoConfig?.extra as any)?.apiUrl ??
  "";

if (!BASE_URL) {
  console.log(
    "[API] Missing BASE_URL: set EXPO_PUBLIC_API_URL or EXPO_PUBLIC_POBA_API"
  );
  throw new Error(
    "Missing API base URL. Set EXPO_PUBLIC_API_URL (or EXPO_PUBLIC_POBA_API) in your env."
  );
}

console.log("[API] BASE_URL →", BASE_URL);

// ------------------------------- Common types -------------------------------

export interface NonceResponse {
  wallet_address: string;
  nonce: string;
  message_to_sign: string;
  expires_at: string;
}

export interface VerifyResponse {
  token: string; // normalized: prefer access_token/token
  is_new_user?: boolean;
  access_token?: string;
  token_type?: string;
  user?: any;
}

/** Server 'users' row. */
export interface UserRow {
  id: string;
  wallet_address: string;
  role: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  first_name: string | null;
  last_name: string | null;
  rating: number | null;
  first_login_completed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfileInput {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  city: string;
}

/** Common list options (offset pagination). */
export type ListOpts = { limit?: number; offset?: number };

// ------------------------------ Fetch helpers ------------------------------

function authHeaders(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit & { timeoutMs?: number } = {}
) {
  const { timeoutMs = 12000, ...rest } = init;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  console.log("[API] →", rest.method || "GET", input);
  if (rest.body) {
    try {
      console.log(
        "[API]   body:",
        typeof rest.body === "string" ? rest.body : "(non-string)"
      );
    } catch {}
  }

  try {
    const res = await fetch(input, { ...rest, signal: ctrl.signal });
    console.log("[API] ←", res.status, res.statusText);
    return res;
  } catch (err: any) {
    console.log("[API] ✖ fetch error:", err?.name, err?.message || err);
    if (err?.name === "AbortError") {
      throw new Error("Request timeout. Check API URL / connectivity / CORS.");
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function jsonFetch<T = any>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T> {
  const res = await fetchWithTimeout(url, init);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    try {
      const txt = await res.text();
      console.log("[API] non-JSON response:", txt.slice(0, 200));
    } catch {}
  }
  if (!res.ok) {
    const detail =
      (data && (data.detail || data.error)) ??
      (data && JSON.stringify(data)) ??
      `HTTP ${res.status}`;
    console.log("[API] error payload:", detail);
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail)
    );
  }
  return data as T;
}

// --------------------------------- Auth ------------------------------------

export async function getNonce(address: string): Promise<NonceResponse> {
  return jsonFetch(`${BASE_URL}/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs: 12000,
    body: JSON.stringify({ wallet_address: address }),
  });
}

export async function verifySignature(params: {
  address: string;
  message: string;
  signature: string;
}): Promise<VerifyResponse> {
  const data = await jsonFetch(`${BASE_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs: 12000,
    body: JSON.stringify({
      wallet_address: params.address,
      signed_message: params.message,
      signature: params.signature,
    }),
  });

  return {
    token: data.access_token ?? data.token,
    is_new_user: data.is_new_user,
    access_token: data.access_token,
    token_type: data.token_type,
    user: data.user,
  };
}

// --------------------------------- Users -----------------------------------

/** Get the current user using the JWT (server resolves wallet via JWT 'sub'). */
export async function getMyProfile(token: string): Promise<UserRow> {
  return jsonFetch<UserRow>(`${BASE_URL}/users/me`, {
    headers: { ...authHeaders(token) },
    timeoutMs: 10000,
  });
}

/** Alias for screens that import getMe. */
export const getMe = getMyProfile;

/** Upsert the current user's profile. */
export async function upsertProfile(
  input: { token: string } & ProfileInput
): Promise<UserRow> {
  const { token, ...payload } = input;
  return jsonFetch<UserRow>(`${BASE_URL}/users/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    timeoutMs: 12000,
    body: JSON.stringify(payload),
  });
}

// --------------------------- Sender (package/ride) --------------------------

/** A generic request created by a sender (package or passenger). */
export type RequestRow = {
  id: string;
  owner_user_id: string;
  type: "passenger" | "package";
  from_address: string;
  from_lat?: number | null;
  from_lon?: number | null;
  to_address: string;
  to_lat?: number | null;
  to_lon?: number | null;
  passengers?: number | null; // default 1 for 'passenger'
  notes?: string | null;
  window_start?: string | null; // ISO string
  window_end?: string | null; // ISO string
  status: "open" | "assigned" | "in_transit" | "completed" | "cancelled";
  created_at: string; // ISO
  updated_at: string; // ISO
};

export type SenderMetrics = {
  open_count: number;
  active_count: number;
  delivered_count: number;
  cancelled_count?: number;
};

// UI buckets exposed by the API
export type SenderBucket = "open" | "active" | "delivered";

export async function getSenderMetrics(token: string): Promise<SenderMetrics> {
  return jsonFetch<SenderMetrics>(`${BASE_URL}/sender/metrics`, {
    headers: { ...authHeaders(token) },
  });
}

export async function listSenderRequests(
  token: string,
  bucket: SenderBucket,
  opts: ListOpts = {}
): Promise<RequestRow[]> {
  const q = new URLSearchParams({
    status: bucket,
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  return jsonFetch<RequestRow[]>(
    `${BASE_URL}/sender/requests?${q.toString()}`,
    { headers: { ...authHeaders(token) } }
  );
}

// ------------------------------ Courier (driver) ----------------------------

/** Courier job row shown to drivers (may originate from sender requests). */
export type CourierJobRow = {
  id: string;
  type: "package" | "passenger";
  status: "open" | "assigned" | "in_transit" | "completed" | "cancelled";
  from_address: string;
  to_address: string;
  window_start?: string | null;
  window_end?: string | null;
  distance_km?: number | null;
  suggested_pay?: string | number | null;
  notes?: string | null;
  created_at: string; // ISO
};

/** KPIs for courier dashboard. */
export type CourierMetrics = {
  available_count: number; // jobs you can pick
  active_count: number; // currently delivering
  delivered_count: number; // completed by you
};

/** Tabs for courier list. */
export type CourierBucket = "available" | "active" | "delivered";

/** GET KPIs for courier. */
export async function getCourierMetrics(
  token: string
): Promise<CourierMetrics> {
  return jsonFetch<CourierMetrics>(`${BASE_URL}/courier/metrics`, {
    headers: { ...authHeaders(token) },
  });
}

/** List courier jobs by bucket (server should filter by status/assignment). */
export async function listCourierJobs(
  token: string,
  bucket: CourierBucket,
  opts: ListOpts = {}
): Promise<CourierJobRow[]> {
  const q = new URLSearchParams({
    status: bucket, // "available" | "active" | "delivered"
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  return jsonFetch<CourierJobRow[]>(
    `${BASE_URL}/courier/jobs?${q.toString()}`,
    { headers: { ...authHeaders(token) } }
  );
}

/** Optional: actions for courier lifecycle (wire when screens are ready). */
export async function courierAcceptJob(token: string, jobId: string) {
  return jsonFetch<{ ok: true; job_id: string }>(
    `${BASE_URL}/courier/jobs/${encodeURIComponent(jobId)}/accept`,
    { method: "POST", headers: { ...authHeaders(token) } }
  );
}
export async function courierStartJob(token: string, jobId: string) {
  return jsonFetch<{ ok: true; job_id: string }>(
    `${BASE_URL}/courier/jobs/${encodeURIComponent(jobId)}/start`,
    { method: "POST", headers: { ...authHeaders(token) } }
  );
}
export async function courierMarkDelivered(token: string, jobId: string) {
  return jsonFetch<{ ok: true; job_id: string }>(
    `${BASE_URL}/courier/jobs/${encodeURIComponent(jobId)}/delivered`,
    { method: "POST", headers: { ...authHeaders(token) } }
  );
}

// ------------------------------- Rider (rides) ------------------------------

/** Rider requests (a rider looking to join a ride). */
export type RiderRequestRow = {
  id: string;
  status: "open" | "matched" | "in_transit" | "completed" | "cancelled";
  from_address: string;
  to_address: string;
  window_start?: string | null;
  window_end?: string | null;
  seats?: number | null; // requested seats
  notes?: string | null;
  created_at: string; // ISO
};

export type RiderMetrics = {
  open_count: number;
  active_count: number;
  completed_count: number;
};

/** Tabs for rider list. */
export type RiderBucket = "open" | "active" | "completed";

export async function getRiderMetrics(token: string): Promise<RiderMetrics> {
  return jsonFetch<RiderMetrics>(`${BASE_URL}/rider/metrics`, {
    headers: { ...authHeaders(token) },
  });
}

export async function listRiderRequests(
  token: string,
  bucket: RiderBucket,
  opts: ListOpts = {}
): Promise<RiderRequestRow[]> {
  const q = new URLSearchParams({
    status: bucket, // "open" | "active" | "completed"
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  return jsonFetch<RiderRequestRow[]>(
    `${BASE_URL}/rider/requests?${q.toString()}`,
    { headers: { ...authHeaders(token) } }
  );
}

/** Optional: rider actions (e.g., create/join/cancel) – wire when needed. */
export async function riderCreateRequest(
  token: string,
  payload: {
    from_address: string;
    to_address: string;
    window_start?: string | null;
    window_end?: string | null;
    seats?: number | null;
    notes?: string | null;
  }
) {
  return jsonFetch<RiderRequestRow>(`${BASE_URL}/rider/requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(payload),
  });
}

export async function riderCancelRequest(token: string, requestId: string) {
  return jsonFetch<{ ok: true; id: string }>(
    `${BASE_URL}/rider/requests/${encodeURIComponent(requestId)}/cancel`,
    { method: "POST", headers: { ...authHeaders(token) } }
  );
}

// --------------------------------- Utilities --------------------------------

/** Optional tiny ping you can call from a health screen. */
export async function pingApi(): Promise<{ ok: true }> {
  // If you have /health or /health/db in FastAPI, adjust here.
  await jsonFetch(`${BASE_URL}/health/db`, { timeoutMs: 8000 }).catch(() => {
    // Not all envs expose /health/db; fail silently to avoid breaking UI.
  });
  return { ok: true };
}

// ---------------------------- Create Request API -----------------------------

export type CreateRequestInput = {
  type: "package" | "passenger";
  from_address: string;
  to_address: string;
  window_start: string; // ISO string
  window_end: string; // ISO string
  notes?: string;
  max_price: number;
  pickup_contact_name?: string | null;
  pickup_contact_phone?: string | null;
  from_lat?: number | null;
  from_lon?: number | null;
  to_lat?: number | null;
  to_lon?: number | null;
  passengers?: number | null;
};

export async function createSenderRequest(
  token: string,
  body: CreateRequestInput
) {
  const res = await fetch(`${process.env.EXPO_PUBLIC_API_BASE_URL}/requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`, // assuming JWT
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(txt || "Failed to create request");
  }
  return res.json() as Promise<{
    id: string;
    status: string;
    created_at: string;
  }>;
}
