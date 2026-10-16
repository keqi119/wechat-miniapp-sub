export class ApiError extends Error { status: number; code: string; constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; } }
export class Client {
  private csrf = '';
  private transport: typeof fetch;
  constructor(transport: typeof fetch = (...args) => fetch(...args)) { this.transport = transport; }
  setCsrf(value: string) { this.csrf = value; }
  clear() { this.csrf = ''; }
  async request<T>(path: string, body?: unknown): Promise<T> {
    if (!/^\/(config|legal|auth\/(sms\/request|login|logout|me)|records(?:\/(SUBSCRIPTION|HANDOVER|AMENDMENT)\/[A-Za-z0-9_-]+(?:\/(sign|sync))?)?|account\/(readiness|register|verify|refresh))$/.test(path)) throw new ApiError(400,'PATH_DENIED','请求地址不允许');
    const headers: Record<string,string> = {Accept:'application/json'};
    if (body !== undefined) { headers['Content-Type']='application/json'; if (this.csrf) headers['X-CSRF-Token']=this.csrf; }
    let response: Response;
    try { response = await this.transport(`/miniapp-sign/api${path}`, {method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(20000),headers,...(body!==undefined?{body:JSON.stringify(body)}:{})}); }
    catch { throw new ApiError(0,'OFFLINE','暂时无法连接签约服务，请检查网络后重试。'); }
    let data: any;
    try { data=await response.json(); } catch { throw new ApiError(response.status,'INVALID_RESPONSE','签约服务响应格式异常，请稍后重试。'); }
    if (!response.ok) {
      if (response.status===401) this.clear();
      const failure=data.error&&typeof data.error==='object'?data.error:data;
      throw new ApiError(response.status,typeof failure.code==='string'?failure.code:'REQUEST_FAILED', typeof failure.message==='string'?failure.message:response.status===401?'登录已过期，请重新登录。':response.status===403?'当前操作校验未通过，请刷新后重试。':'操作未完成，请稍后重试。');
    }
    return data as T;
  }
}
