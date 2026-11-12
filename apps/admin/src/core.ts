export type Entity = Record<string, unknown> & { id: string };
export type Page<T = Entity> = { items: T[]; total: number; page: number; pageSize: number };
export type Session = { user: { id: string; username: string; name?: string; role?: string; permissions: string[]; partnerCapabilities?: string[]; staffPersonId?: string | null }; csrfToken: string };

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
export function contractSigningFlow(entity: Entity): 'OWNER' | 'PLATFORM' | 'UNKNOWN' {
  if (entity.signingFlow === 'OWNER' && typeof entity.ownerId === 'string' && entity.ownerId.trim()) return 'OWNER';
  if (entity.signingFlow === 'PLATFORM') return 'PLATFORM';
  return 'UNKNOWN';
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
  private sessionGeneration = 0;
  constructor(fetcher: typeof fetch = fetch, base = '/api') { this.fetcher = fetcher; this.base = base; }
  fileUrl(id: string): string { return `${this.base}/admin/files/${encodeURIComponent(id)}`; }
  vehicleDocumentOpenUrl(vehicleId:string,fileId:string):string {
    if(!this.session)throw new ApiError('请先登录后台',401,'UNAUTHENTICATED');
    if(!['ADMIN','OPERATIONS'].includes(this.session.user.role||''))throw new ApiError('当前岗位无权读取车辆原件',403,'FORBIDDEN');
    if(!/^[A-Za-z0-9_-]+$/.test(vehicleId)||!/^[A-Za-z0-9_-]+$/.test(fileId))throw new ApiError('车辆原件打开路径无效',0,'INVALID_FILE_PATH');
    return `${this.base}/admin/vehicles/${encodeURIComponent(vehicleId)}/documents/${encodeURIComponent(fileId)}/open`;
  }
  setSession(value: Session | null) { this.session = value; this.sessionGeneration++; if(typeof window!=='undefined')window.dispatchEvent(new Event('admin-session-change')); }
  async downloadPrivateFile(path:string,expectedType:string,signal?:AbortSignal):Promise<Blob>{
    const session=this.session,generation=this.sessionGeneration;
    const current=()=>{if(this.session!==session||this.sessionGeneration!==generation)throw new ApiError('登录会话已变化，请重新读取原件',0,'SESSION_CHANGED');};
    if(!session)throw new ApiError('请先登录后台',401,'UNAUTHENTICATED');
    if(!['ADMIN','OPERATIONS'].includes(session.user.role||''))throw new ApiError('当前岗位无权读取车辆原件',403,'FORBIDDEN');
    if(!/^\/admin\/vehicles\/[A-Za-z0-9_-]+\/documents\/[A-Za-z0-9_-]+$/.test(path))throw new ApiError('车辆原件下载路径无效',0,'INVALID_FILE_PATH');
    if(!['application/pdf','image/jpeg','image/png','application/vnd.openxmlformats-officedocument.wordprocessingml.document','video/mp4'].includes(expectedType))throw new ApiError('原件格式不受支持',0,'UNSUPPORTED_FILE_TYPE');
    let response:Response;
    try{const fetcher=this.fetcher;response=await fetcher(this.base+path,{method:'GET',credentials:'include',signal,cache:'no-store',headers:{Accept:expectedType}});}catch(error){current();throw error;}
    current();
    if(!response.ok){
      const result=await response.json().catch(()=>null) as {error?:{message?:string;code?:string}}|null;current();
      if(response.status===401){this.setSession(null);this.onExpired?.();}
      throw new ApiError(result?.error?.message||'原件下载失败，请核对权限后重试',response.status,result?.error?.code||'PRIVATE_FILE_FAILED');
    }
    if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==expectedType)throw new ApiError('原件格式与登记信息不一致，已停止下载',0,'FILE_TYPE_MISMATCH');
    const limit=32*1024*1024;
    if(Number(response.headers.get('Content-Length'))>limit)throw new ApiError('原件超过32MiB限制',0,'FILE_TOO_LARGE');
    const blob=await response.blob();current();
    if(blob.size>limit)throw new ApiError('原件超过32MiB限制',0,'FILE_TOO_LARGE');
    return blob;
  }
  async readPrivateFile(path:string,expectedType:string,signal?:AbortSignal):Promise<Blob>{
    const session=this.session,generation=this.sessionGeneration;
    const current=()=>{if(this.session!==session||this.sessionGeneration!==generation)throw new ApiError('登录会话已变化，请重新读取证件',0,'SESSION_CHANGED');};
    if(!session)throw new ApiError('请先登录后台',401,'UNAUTHENTICATED');
    if(!['image/jpeg','image/png','application/pdf'].includes(expectedType))throw new ApiError('此文件格式不支持安全预览',0,'UNSUPPORTED_FILE_TYPE');
    let response:Response;
    try{const fetcher=this.fetcher;response=await fetcher(this.base+path,{method:'GET',credentials:'include',signal,headers:{Accept:expectedType}});}catch(error){current();throw error;}
    current();
    if(!response.ok){
      const result=await response.json().catch(()=>null) as {error?:{message?:string;code?:string}}|null;current();
      if(response.status===401){this.setSession(null);this.onExpired?.();}
      throw new ApiError(result?.error?.message||'无法读取此证件，请核对权限或刷新资料',response.status,result?.error?.code||'PRIVATE_FILE_FAILED');
    }
    if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!==expectedType)throw new ApiError('文件格式与登记信息不一致，已停止预览',0,'FILE_TYPE_MISMATCH');
    if(Number(response.headers.get('Content-Length'))>10*1024*1024)throw new ApiError('附件超过安全预览大小',0,'FILE_TOO_LARGE');
    const blob=await response.blob();current();
    if(blob.size>10*1024*1024)throw new ApiError('附件超过安全预览大小',0,'FILE_TOO_LARGE');
    return blob;
  }
  async request<T = Entity>(path: string, options: Options = {}): Promise<T> {
    const { body, permission, ...init } = options;
    const method = init.method ?? 'GET';
    const session = this.session, generation = this.sessionGeneration;
    const assertSession = () => { if (this.session !== session || this.sessionGeneration !== generation) throw new ApiError('登录会话已变化，请在当前账号重新核对原记录', 0, 'SESSION_CHANGED'); };
    const mutating = !['GET', 'HEAD'].includes(method);
    if (permission && !can(this.session?.user.permissions ?? [], permission)) throw new ApiError('当前账号没有此操作权限', 403, 'FORBIDDEN');
    if (mutating && path !== '/admin/auth/login' && !this.session?.csrfToken) throw new ApiError('登录会话已失效，请重新登录', 401, 'UNAUTHORIZED');
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (mutating && this.session?.csrfToken) headers.set('X-CSRF-Token', this.session.csrfToken);
    if (body !== undefined && !(body instanceof FormData)) headers.set('Content-Type', 'application/json');
    let response: Response;
    try { const fetcher = this.fetcher; response = await fetcher(this.base + path, { ...init, method, credentials: 'include', headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) }); }
    catch (error) { assertSession(); if (error instanceof Error && error.name === 'AbortError') throw error; throw new ApiError('暂时无法连接服务，请检查网络后重试'); }
    assertSession();
    if (response.status === 204) return undefined as T;
    let data: unknown;
    try { data = await response.json(); } catch { assertSession(); throw new ApiError('服务返回了无效响应，请稍后重试', response.status, 'INVALID_RESPONSE'); }
    assertSession();
    if (!response.ok) {
      const failure = data as { error?: { message?: string; code?: string; details?: unknown }; requestId?: string };
      if (response.status === 401 && path !== '/admin/auth/login') { const hadSession = !!this.session; this.setSession(null); if (hadSession) this.onExpired?.(); }
      throw new ApiError(failure.error?.message ?? '请求失败，请稍后重试', response.status, failure.error?.code ?? 'REQUEST_FAILED', failure.requestId, failure.error?.details);
    }
    return data as T;
  }
}
export const api = new ApiClient(fetch, import.meta.env?.VITE_API_BASE_URL || (import.meta.env?.PROD ? 'https://api.evsub.ndacar.com/api' : '/api'));
export function isPrivateField(key: string): boolean { return /password|token|secret|csrf|ciphertext|privateKey|credential/i.test(key); }
