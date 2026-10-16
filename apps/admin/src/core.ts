export type Entity = Record<string, unknown> & { id: string };
export type Page<T = Entity> = { items: T[]; total: number; page: number; pageSize: number };
export type Session = { user: { id: string; username: string; name?: string; role?: string; permissions: string[] }; csrfToken: string };

export function moneyToCents(value: string): number {
  const text = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('请输入非负金额，最多两位小数');
  const [integer, fraction = ''] = text.split('.');
  const cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > 2147483647n) throw new Error('金额不可超过 21,474,836.47 元');
  return Number(cents);
}
export function can(permissions: string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}
export function money(value: unknown): string {
  return typeof value === 'number' && Number.isSafeInteger(value) ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value / 100) : '—';
}
export function date(value: unknown, onlyDate = false): string {
  if (!value || !['string', 'number'].includes(typeof value)) return '—';
  const parsed = new Date(value as string);
  return Number.isNaN(parsed.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', ...(onlyDate ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }) }).format(parsed);
}
export class ApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  details?: unknown;
  constructor(message: string, status = 0, code = 'NETWORK_ERROR', requestId?: string, details?: unknown) {
    super(message); this.name = 'ApiError'; this.status = status; this.code = code; this.requestId = requestId; this.details = details;
  }
}
type Options = Omit<RequestInit, 'body'> & { body?: unknown; permission?: string };
export class ApiClient {
  session: Session | null = null;
  onExpired: (() => void) | undefined;
  private fetcher: typeof fetch;
  private base: string;
  constructor(fetcher: typeof fetch = fetch, base = '/api') { this.fetcher = fetcher; this.base = base; }
  fileUrl(id: string): string { return `${this.base}/admin/files/${encodeURIComponent(id)}`; }
  setSession(value: Session | null) { this.session = value; }
  async request<T = Entity>(path: string, options: Options = {}): Promise<T> {
    const { body, permission, ...init } = options;
    const method = init.method ?? 'GET';
    const mutating = !['GET', 'HEAD'].includes(method);
    if (permission && !can(this.session?.user.permissions ?? [], permission)) throw new ApiError('当前账号没有此操作权限', 403, 'FORBIDDEN');
    if (mutating && path !== '/admin/auth/login' && !this.session?.csrfToken) throw new ApiError('登录会话已失效，请重新登录', 401, 'UNAUTHORIZED');
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (mutating && this.session?.csrfToken) headers.set('X-CSRF-Token', this.session.csrfToken);
    if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let response: Response;
    try { const fetcher = this.fetcher; response = await fetcher(this.base + path, { ...init, method, credentials: 'include', headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }); }
    catch (error) { if (error instanceof Error && error.name === 'AbortError') throw error; throw new ApiError('暂时无法连接服务，请检查网络后重试'); }
    if (response.status === 204) return undefined as T;
    let data: unknown;
    try { data = await response.json(); } catch { throw new ApiError('服务返回了无效响应，请稍后重试', response.status, 'INVALID_RESPONSE'); }
    if (!response.ok) {
      const failure = data as { error?: { message?: string; code?: string; details?: unknown }; requestId?: string };
      if (response.status === 401 && path !== '/admin/auth/login') { const hadSession = !!this.session; this.session = null; if (hadSession) this.onExpired?.(); }
      throw new ApiError(failure.error?.message ?? '请求失败，请稍后重试', response.status, failure.error?.code ?? 'REQUEST_FAILED', failure.requestId, failure.error?.details);
    }
    return data as T;
  }
}
export const api = new ApiClient(fetch, import.meta.env?.VITE_API_BASE_URL || (import.meta.env?.PROD ? 'https://mini-api.subauto.keybox.cloud/api' : '/api'));
export function isPrivateField(key: string): boolean { return /password|token|secret|csrf|ciphertext|privateKey|credential/i.test(key); }
