// app/lib/api.ts
// API helpers for the wallet-auth flow (POST-only) + basic profile endpoints.
// - POST /auth/nonce       -> { wallet_address, nonce, message_to_sign, expires_at }
// - POST /auth/verify      -> { user, access_token, token_type, is_new_user? }
// - GET  /users/me         -> { first_name?, last_name?, phone?, email?, city?, ... }
// - POST /users/profile    -> upsert basic profile fields
//
// We also expose a legacy { token } alias so existing UI code can keep using "token".

import Constants from "expo-constants";

const BASE_URL =
  process.env.EXPO_PUBLIC_POBA_API ??
  (Constants.expoConfig?.extra as any)?.apiUrl ??
  "";

if (!BASE_URL) {
  throw new Error("חסר EXPO_PUBLIC_POBA_API (כתובת שרת ה-PoBA)");
}
console.log("API URL →", BASE_URL);

// ---------- Types ----------
export type NonceResponse = {
  wallet_address: string;
  nonce: string;
  message_to_sign: string;
  expires_at: string; // ISO string
};

export type VerifyResponse = {
  // Keep legacy 'token' for compatibility with your screen Alert:
  token: string;
  // Canonical fields returned by backend:
  access_token: string;
  token_type: string; // "bearer"
  user: any;
  // Optional flag (recommended): server can return this when the wallet logs in for the first time.
  is_new_user?: boolean;
};

// Basic profile shape (extend as needed)
export type UserProfile = {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string;
  city?: string;
  // ...add fields your API returns
};

export type ProfileUpsertRequest = {
  token: string; // bearer token from /auth/verify
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  city: string;
};

// ---------- Internal JSON fetch helpers ----------
async function jsonFetch(input: string, init?: RequestInit) {
  const res = await fetch(input, init);
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    // if response isn't JSON, keep null and handle as text below if needed
  }
  if (!res.ok) {
    // Try to surface a meaningful error message
    const detail =
      (data && (data.detail || data.error)) ??
      (await res.text().catch(() => `HTTP ${res.status}`));
    throw new Error(
      typeof detail === "string" ? detail : JSON.stringify(detail)
    );
  }
  return data;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

// ---------- Public API ----------

/**
 * Request a login nonce (POST).
 * Server expects: { wallet_address: "<SS58>" }
 * Returns: { wallet_address, nonce, message_to_sign, expires_at }
 */
export async function getNonce(address: string): Promise<NonceResponse> {
  return jsonFetch(`${BASE_URL}/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet_address: address }),
  });
}

/**
 * Verify signature (POST).
 * Client provides { address, message, signature }.
 * Server expects { wallet_address, signed_message, signature } and returns
 * { user, access_token, token_type, is_new_user? }. We also return { token } as an alias.
 */
export async function verifySignature(params: {
  address: string;
  message: string; // must be EXACTLY the message that server asked to sign
  signature: string; // hex "0x..."
}): Promise<VerifyResponse> {
  const payload = {
    wallet_address: params.address,
    signed_message: params.message,
    signature: params.signature,
  };

  const data = await jsonFetch(`${BASE_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Normalize shape for the UI (keep legacy 'token'):
  return {
    token: data.access_token,
    access_token: data.access_token,
    token_type: data.token_type ?? "bearer",
    user: data.user,
    is_new_user: data.is_new_user, // may be undefined if server doesn't send it
  };
}

/**
 * Fetch current user's profile using bearer token.
 * GET /users/me -> { first_name?, last_name?, phone?, email?, city?, ... }
 */
export async function getMyProfile(token: string): Promise<UserProfile> {
  const data = await jsonFetch(`${BASE_URL}/users/me`, {
    headers: {
      ...authHeaders(token),
    },
  });
  return data as UserProfile;
}

/**
 * Create/update (upsert) profile fields after first login.
 * POST /users/profile with JSON body (adjust path/method if your backend differs).
 */
export async function upsertProfile(
  req: ProfileUpsertRequest
): Promise<UserProfile> {
  const data = await jsonFetch(`${BASE_URL}/users/profile`, {
    method: "POST",
    headers: {
      ...authHeaders(req.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      first_name: req.first_name,
      last_name: req.last_name,
      phone: req.phone,
      email: req.email,
      city: req.city,
    }),
  });
  return data as UserProfile;
}
