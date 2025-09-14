// app/lib/api.ts
// Adds strong logging so we can see *exactly* what URL and body are used.
// Exposes BASE_URL for showing on-screen in the login screen.

import Constants from "expo-constants";

export const BASE_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  process.env.EXPO_PUBLIC_POBA_API ??
  (Constants.expoConfig?.extra as any)?.apiUrl ??
  "";

if (!BASE_URL) {
  // Important: this will show in Metro logs *and* throw so the UI knows
  console.log(
    "[API] Missing BASE_URL: set EXPO_PUBLIC_API_URL or EXPO_PUBLIC_POBA_API"
  );
  throw new Error(
    "Missing API base URL. Set EXPO_PUBLIC_API_URL (or EXPO_PUBLIC_POBA_API) in your env."
  );
}

console.log("[API] BASE_URL →", BASE_URL);

export interface NonceResponse {
  wallet_address: string;
  nonce: string;
  message_to_sign: string;
  expires_at: string;
}

export interface VerifyResponse {
  token: string;
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
  } catch (e) {
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

/** Get the current user using the JWT (server resolves wallet via JWT 'sub'). */
export async function getMyProfile(token: string): Promise<UserRow> {
  return jsonFetch<UserRow>(`${BASE_URL}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs: 10000,
  });
}

/** Alias for screens that import getMe. */
export const getMe = getMyProfile;

/** Upsert the current user's profile. */
export async function upsertProfile(
  input: {
    token: string;
  } & ProfileInput
): Promise<UserRow> {
  const { token, ...payload } = input;
  return jsonFetch<UserRow>(`${BASE_URL}/users/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    timeoutMs: 12000,
    body: JSON.stringify(payload),
  });
}
