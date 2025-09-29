// app/lib/api.ts
// Unified API client for BidDrop (Expo).
// - One BASE_URL for all calls
// - Strong logging (method, URL, body, status)
// - Timeouts + better error messages
// - Types aligned with DB & server routes (requests, offers, auction, devices)

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
  | "assigned"
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

/**
 * Register Expo push token for current user.
 * NOTE: server supports BOTH shapes:
 *  - { expo_push_token: string }  (your legacy call)
 *  - { provider: "expo", token: string }  (new unified)
 */
export async function registerPushToken(
  token: string,
  expoPushToken: string
): Promise<void> {
  const res = await fetchWithTimeout(`${BASE_URL}/devices/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(token),
    },
    body: JSON.stringify({ expo_push_token: expoPushToken }),
    timeoutMs: 10000,
  });
  if (!res.ok && res.status !== 204) {
    let txt = "";
    try {
      txt = await res.text();
    } catch {}
    throw new Error(`registerPushToken failed: ${res.status} ${txt}`);
  }
}

// --------------------------- Sender (packages) ------------------------------

/** A request created by a sender or rider. */
export type RequestRow = {
  id: string;
  owner_user_id: string;
  type: "package" | "ride" | "passenger"; // include passenger
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
    `${BASE_URL}/offers`, // <-- routes_offers.py mounts at /offers
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
  min_price: string; // NUMERIC → string from API
  types: ("package" | "passenger")[];
  notes?: string | null;
  status: "active" | "paused" | "completed" | "cancelled" | "assigned";
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
    `${BASE_URL}/offers?${q.toString()}`, // <-- GET /offers for current driver
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

export type CreateRequestInput = {
  type: "package" | "ride" | "passenger";
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

export type AuctionClearResponse = {
  cleared: boolean;
  matches?: { request_id: string; driver_user_id: string }[];
  reason?: string;
  objective?: any;
  debug?: any;
};

/** Call your backend /auction/clear (no auth required by your server design). */
export async function clearAuctionsNow(): Promise<AuctionClearResponse> {
  return jsonFetch<AuctionClearResponse>(`${BASE_URL}/auction/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs: 15000,
  });
}

// --------------------------------- Utilities --------------------------------

/** Optional tiny ping you can call from a health screen. */
export async function pingApi(): Promise<{ ok: true }> {
  try {
    await jsonFetch(`${BASE_URL}/healthz`, { timeoutMs: 6000 });
  } catch {
    try {
      await jsonFetch(`${BASE_URL}/health/db`, { timeoutMs: 6000 });
    } catch {}
  }
  return { ok: true };
}
