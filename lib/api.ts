// app/lib/api.ts
// Unified API client for BidDrop (Expo).
// - One BASE_URL for all calls
// - Strong logging (method, URL, body, status)
// - Timeouts + better error messages
// - Types aligned with DB (requests incl. max_price & pickup_contact_*)

import Constants from "expo-constants";

// --------------------------- Base URL & bootstrap ---------------------------

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

/** Unified status type across app. */
export type CommonStatus =
  | "open"
  | "assigned" // we use 'assigned' instead of legacy 'matched'
  | "in_transit"
  | "completed"
  | "cancelled";

function normalizeStatus(s: string): CommonStatus {
  return s === "matched" ? "assigned" : (s as CommonStatus);
}

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

/** Get the current user using the JWT. */
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

// --------------------------- Sender (packages) ------------------------------

/** A request created by a sender. */
export type RequestRow = {
  id: string;
  owner_user_id: string;
  type: "package" | "ride"; // keep 'ride' for compatibility where screens check it
  from_address: string;
  from_lat?: number | null;
  from_lon?: number | null;
  to_address: string;
  to_lat?: number | null;
  to_lon?: number | null;
  passengers?: number | null; // present if came from rider flow
  notes?: string | null;
  window_start?: string | null; // ISO string
  window_end?: string | null; // ISO string
  status: CommonStatus;
  created_at: string; // ISO
  updated_at: string; // ISO

  // Columns often used in UI:
  max_price?: number | null; // NUMERIC(10,2) → number in JSON
  pickup_contact_name?: string | null; // VARCHAR(100)
  pickup_contact_phone?: string | null; // VARCHAR(32)
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
  const rows = await jsonFetch<any[]>(
    `${BASE_URL}/sender/requests?${q.toString()}`,
    { headers: { ...authHeaders(token) } }
  );
  // normalize status just in case
  return rows.map((r) => ({
    ...r,
    status: normalizeStatus(r.status),
  })) as RequestRow[];
}

// ------------------------------ Courier (driver) ----------------------------

/** Courier job row shown to drivers (may originate from sender/rider requests). */
export type CourierJobRow = {
  id: string;
  type: "package" | "passenger";
  status: CommonStatus;
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
  const rows = await jsonFetch<any[]>(
    `${BASE_URL}/courier/jobs?${q.toString()}`,
    { headers: { ...authHeaders(token) } }
  );
  return rows.map((r) => ({
    ...r,
    status: normalizeStatus(r.status),
  })) as CourierJobRow[];
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

export async function createCourierOffer(
  token: string,
  body: {
    from_address: string;
    to_address?: string | null; // null = כל היעדים
    window_start: string; // ISO
    window_end: string; // ISO
    min_price: number;
    types: ("package" | "passenger")[];
    notes?: string | null;
  }
) {
  return jsonFetch<{ id: string; status: string; created_at: string }>(
    `${BASE_URL}/courier/offers`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      timeoutMs: 12000,
    }
  );
}

// ---------------------------- Courier Offers (driver availability) ----------------------------

export type CourierOfferRow = {
  id: string;
  driver_user_id?: string;
  from_address: string;
  to_address?: string | null;
  window_start?: string | null; // ISO
  window_end?: string | null; // ISO
  min_price: string; // מגיע כטקסט מה-API (NUMERIC), תרצי -> parseFloat
  types: ("package" | "passenger")[];
  notes?: string | null;
  // ⬅ הוספתי 'assigned' כדי לשקף את DB בפועל
  status: "active" | "assigned" | "paused" | "completed" | "cancelled";
  created_at: string; // ISO
  updated_at: string; // ISO
};

export async function listMyCourierOffers(
  token: string,
  opts: { status?: string; limit?: number; offset?: number } = {}
): Promise<CourierOfferRow[]> {
  const q = new URLSearchParams({
    ...(opts.status ? { status: opts.status } : {}),
    limit: String(opts.limit ?? 50),
    offset: String(opts.offset ?? 0),
  });
  return jsonFetch<CourierOfferRow[]>(
    `${BASE_URL}/courier/offers?${q.toString()}`,
    {
      headers: { ...authHeaders(token) },
      timeoutMs: 12000,
    }
  );
}

// ------------------------------- Rider (rides) ------------------------------

/** Rider requests (a rider looking to join a ride). */
export type RiderRequestRow = {
  id: string;
  status: CommonStatus; // normalized; legacy 'matched' → 'assigned'
  from_address: string;
  to_address: string;
  window_start?: string | null;
  window_end?: string | null;
  passengers?: number | null; // requested seats
  notes?: string | null;
  max_price?: number | null;
  created_at: string; // ISO
};

export type RiderMetrics = {
  open_count: number;
  active_count: number;
  completed_count: number;
  cancelled_count?: number;
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
  const rows = await jsonFetch<any[]>(
    `${BASE_URL}/rider/requests?${q.toString()}`,
    { headers: { ...authHeaders(token) } }
  );
  return rows.map((r) => ({
    ...r,
    status: normalizeStatus(r.status),
  })) as RiderRequestRow[];
}

/** Rider – create new ride request. */
export type CreateRiderPayload = {
  from_address: string;
  to_address: string;
  window_start: string; // ISO
  window_end: string; // ISO
  passengers: number;
  notes?: string | null;
  max_price?: number | null;
};

export async function createRiderRequest(
  token: string,
  payload: CreateRiderPayload
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

// ---------------------------- Create Request API -----------------------------
// (Generic sender create remains because you said it works on your server)

export type CreateRequestInput = {
  type: "package" | "ride" | "passenger"; // keep 'passenger' for backward compat
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

export type CreateRequestResponse = {
  id: string;
  status: string;
  created_at: string; // ISO
};

/** Sender generic create (kept as-is since it works in your backend) */
export async function createSenderRequest(
  token: string,
  body: CreateRequestInput
): Promise<CreateRequestResponse> {
  return jsonFetch<CreateRequestResponse>(`${BASE_URL}/requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    timeoutMs: 12000,
    body: JSON.stringify(body),
  });
}

// -------------------------------- Auctions ----------------------------------
// Double auction clearing + optional on-chain close.
// Uses same jsonFetch + logging/timeout flow as rest of the file.

export type AuctionClearRequest = {
  request_ids?: string[]; // UUID strings
  now_ts?: number;
};

export type AuctionClearResponse = {
  ok: boolean;
  assigned: Record<string, string>; // { request_id: driver_user_id }
  count: number;
  message?: string; // "NO_MATCH" etc.
};

export async function clearAuctions(
  payload: AuctionClearRequest
): Promise<AuctionClearResponse> {
  return jsonFetch<AuctionClearResponse>(`${BASE_URL}/auctions/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 12000,
  });
}

export async function closeAuctionOnchain(payload: {
  auction_id: string; // UUID as string
  winner_ss58?: string;
}): Promise<{ ok: boolean; job_id: string }> {
  return jsonFetch<{ ok: boolean; job_id: string }>(
    `${BASE_URL}/auctions/close`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      timeoutMs: 12000,
    }
  );
}

// --------------------------------- Utilities --------------------------------

/** Optional tiny ping you can call from a health screen. */
export async function pingApi(): Promise<{ ok: true }> {
  // Try /healthz first, fallback to /health/db if exists
  try {
    await jsonFetch(`${BASE_URL}/healthz`, { timeoutMs: 6000 });
  } catch {
    try {
      await jsonFetch(`${BASE_URL}/health/db`, { timeoutMs: 6000 });
    } catch {}
  }
  return { ok: true };
}

/** Defer push notifications for a request and return the defer-until timestamp (ISO) */
export async function deferPushForRequest(
  token: string,
  requestId: string,
  seconds = 60
) {
  const url = `${BASE_URL}/requests/${encodeURIComponent(requestId)}/defer_push?seconds=${seconds}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  // השרת מחזיר { ok: true, push_defer_until: "<iso>" }
  if (!res.ok) return null;
  try {
    return (await res.json()) as { ok: boolean; push_defer_until?: string };
  } catch {
    return null;
  }
}

/** Poll match status for a given request (owner side). */
export async function checkMatchStatus(token: string, requestId: string) {
  const url = `${BASE_URL}/requests/${encodeURIComponent(requestId)}/match_status`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { status: "pending" as const };
  try {
    return await res.json();
  } catch {
    return { status: "pending" as const };
  }
}

/** Defer push notifications for an offer and return the defer-until timestamp (ISO) */
export async function deferPushForOffer(
  token: string,
  offerId: string,
  seconds = 60
) {
  const url = `${BASE_URL}/offers/${encodeURIComponent(offerId)}/defer_push?seconds=${seconds}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  try {
    return (await res.json()) as { ok: boolean; push_defer_until?: string };
  } catch {
    return null;
  }
}

/** Poll match status for a given offer (driver side). */
export async function checkOfferMatchStatus(token: string, offerId: string) {
  const url = `${BASE_URL}/offers/${encodeURIComponent(offerId)}/match_status`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { status: "pending" as const };
  try {
    return await res.json();
  } catch {
    return { status: "pending" as const };
  }
}
