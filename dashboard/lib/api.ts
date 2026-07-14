// dashboard/lib/api.ts
//
// Single source of truth for the backend base URL plus a thin fetch wrapper that 
// automatically attaches the Authorization header whenever a token exists in localStorage.
//
// apiFetch is a deliberately minimal drop-in replacement for fetch(url, options): it
// returns the raw, unparsed Response, exactly like fetch does. Callers keep their own
// existing res.ok / res.status / res.json() handling, since that varies per call site
// (some alert + rollback optimistic UI, some redirect, some just log) and isn't safe
// to templatize into one shared behavior without changing what any given screen does.
//
// A few call sites intentionally do NOT use apiFetch: routes that never send an auth
// header today, even when the user is logged in (e.g. GET /api/search, GET comments).
// Routing those through apiFetch would start attaching a harmless-but-new header for
// logged-in users - inert server-side, but not byte-for-byte identical to today's
// request. Those call sites import just API_BASE_URL and call fetch() directly.

export const API_BASE_URL = 'https://glide-sports.onrender.com';

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem('glide_token');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
}
