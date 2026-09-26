/**
 * Where the access token lives.
 *
 * localStorage is the pragmatic choice for a development scaffold: it survives
 * a refresh and needs no cookie or CSRF handling. Before the platform handles
 * real student data, move this to an httpOnly cookie issued by the gateway,
 * which is the only change needed outside this file.
 */
const TOKEN_KEY = 'adaptlearn.access_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}
