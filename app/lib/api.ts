import Constants from 'expo-constants';

const BASE_URL =
  process.env.EXPO_PUBLIC_POBA_API ??
  (Constants.expoConfig?.extra as any)?.apiUrl ??
  '';

if (!BASE_URL) {
  throw new Error('חסר EXPO_PUBLIC_POBA_API (כתובת שרת ה-PoBA)');
}
console.log('API URL →', BASE_URL); 

export type NonceResponse = { nonce: string };
export type VerifyResponse = { token: string; user?: any };

export async function getNonce(address: string): Promise<NonceResponse> {
  const res = await fetch(`${BASE_URL}/auth/nonce?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`נכשלה בקשת nonce (${res.status})`);
  return res.json();
}

export async function verifySignature(params: {
  address: string;
  message: string;
  signature: string;
}): Promise<VerifyResponse> {
  const res = await fetch(`${BASE_URL}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
