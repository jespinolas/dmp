const AUTH_KEY = "wm_auth_v1";

export type AuthState = {
  token: string;
  email: string;
  userId: number;
};

export function loadAuth(): AuthState | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(AUTH_KEY) : null;
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveAuth(auth: AuthState) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
    }
  } catch {}
}

export function clearAuth() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(AUTH_KEY);
    }
  } catch {}
}

export async function apiCall(
  apiBaseUrl: string,
  path: string,
  method: string,
  body?: any,
  token?: string
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `${method} ${path} failed`);
  return data;
}
