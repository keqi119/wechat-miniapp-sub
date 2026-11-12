export interface LegalSession {
    mode: 'ELECTRONIC_LEGAL';
    readonlyAvailable?:boolean;
 sessionBinding:string;
    csrfToken: string;
    expiresAt: string;
    owners: {
        ownerId: string;
    }[];
    viewer: {
        maskedMobile: string;
    };
}
export interface LegalTask {
    signaturePolicy?: 'MANUAL_ONLY' | null;
    signingPolicyLabel?: string | null;
    id: string;
    orderId: string | null;
    kind: string;
    status: string;
    revision: number;
    sourceSha256: string;
    parties: {
        role: string;
        mode: string;
        status: string;
        signedAt: string | null;
    }[];
    nextAction: {
        kind: string;
        role?: string;
        code?: string;
    };
    stopStatus: string;
    evidenceReviewStatus: string;
    legalCompletedAt: string | null;
    archivedAt: string | null;
    filingStatus: string;
    finalFileAvailable: boolean;
    lastErrorCode?: string | null;
    grant: null | {
        id: string;
        revision: number;
        sourceHash: string;
        revokedAt: string | null;
        archivedAt: string | null;
    };
    frozenSources: {
        parties: Record<string, {
            id: string;
        } | null>;
    };
}
export interface BusinessAuthority {
    id: string;
    revision: number;
    enabled: boolean;
    scopeHash: string;
    reviewed: boolean;
    basisKind: string;
    sourceHash: string;
    grantId: string;
    internalEvidence: {
        fileId: string;
        sha256: string;
    } | null;
    internalApplicability: {
        sourceHash: string;
        signingValidFrom: string;
        signingValidUntil: string;
    } | null;
    readinessReasons: string[];
}
const segment = '[A-Za-z0-9_-]+';
const owner = `/owners/${segment}`;
const reads = new RegExp(`^${owner}(?:$|/electronic-documents(?:$|/authorities/list$|/${segment}(?:$|/files/(?:source|signed)$|/dependencies(?:/${segment})?$))|/seals/${segment}/image$|/authority-options$|/authorities(?:/${segment}/document/(?:source|signed))?$|/electronic-authorities(?:/${segment})?$|/internal-evidence/${segment}$)`);
const writes = new RegExp(`^${owner}/(?:verification|refresh|seal|authorities|authorities/${segment}/(?:refresh|resume|switch|revoke)|electronic-documents/(?:authorities/confirm|authorities/${segment}/switch|${segment}/(?:sign|sync|accept|revoke-grant)))$`);
export class LegalClient {
    private csrf = '';
    private epoch = 0;
    private pending = new Set<AbortController>();
    private transport: typeof fetch;
    constructor(transport: typeof fetch = (...args) => fetch(...args)) { this.transport = transport; }
    cancelPending() { this.epoch++; for (const controller of this.pending) controller.abort(); this.pending.clear(); }
    clear() { this.csrf = ''; this.cancelPending(); }
    setCsrf(value: string) { this.clear(); this.csrf = value; }
    async request<T>(path: string, body?: unknown, options?: {signal?: AbortSignal}): Promise<T> {
        const [pathname, query] = path.split('?'), write = body !== undefined;
        const auth = ['/auth/sms/request', '/auth/login', '/auth/logout'];
        if (/[\\%#\s]/.test(pathname) || path.split('?').length > 2 || !(write ? (auth.includes(path) || writes.test(pathname)) : (['/auth/me', '/owners', '/legal', '/legal-signing'].includes(path) || reads.test(pathname))))
            throw Error('签署入口不支持此操作');
        if (query && (!pathname.endsWith('/electronic-documents') || ![...new URLSearchParams(query)].every(([k, v]) => ['page', 'pageSize'].includes(k) && /^[1-9]\d*$/.test(v))))
            throw Error('列表条件不允许');
        const epoch = this.epoch;
        const controller=new AbortController(),abort=()=>controller.abort();
        options?.signal?.addEventListener('abort',abort,{once:true});
        if(options?.signal?.aborted)controller.abort();
        this.pending.add(controller);
        const timeout=setTimeout(()=>controller.abort(new Error('读取超时，请重试')),20000);
        try {
        controller.signal.throwIfAborted();
        const response = await this.transport(`/owner/api${path}`, { method: write ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json,application/pdf', ...(write ? { 'Content-Type': 'application/json', 'X-CSRF-Token': this.csrf } : {}) }, ...(write ? { body: JSON.stringify(body) } : {}), signal: controller.signal });
        if (epoch !== this.epoch)
            throw Error('登录范围已变化，请重新读取');
        if (response.status === 401) {
            this.clear();
            const error=new Error('签署登录已失效，请重新登录');error.name='LEGAL_SESSION_EXPIRED';throw error;
        }
        controller.signal.throwIfAborted();
        if(response.ok && /\/(?:files|document)\/(source|signed)$/.test(pathname) && response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/pdf')
            throw Error('文件响应异常，请重新读取原记录');
        if (response.ok && ['application/pdf', 'image/png', 'image/jpeg'].includes(response.headers.get('Content-Type')?.split(';')[0] || '')) {
            const blob = await response.blob();
            controller.signal.throwIfAborted();
            if (epoch !== this.epoch)
                throw Error('登录范围已变化');
            return blob as T;
        }
        const result = await response.json();
        if (epoch !== this.epoch)
            throw Error('登录范围已变化');
        if (!response.ok || result.error)
            throw Error(result.error?.message || result.message || '办理未完成，请重新读取');
        return (result.data ?? result) as T;
        } finally {clearTimeout(timeout);options?.signal?.removeEventListener('abort',abort);this.pending.delete(controller);}
    }
}
export function shanghaiSigningInstant(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
        throw Error('请明确输入北京时间签发有效期');
    return new Date(value + ':00+08:00').toISOString();
}
export function authorityConfirmation(task: LegalTask, providerAuthorityId: string, internal?: {
    fileId: string;
    hash: string;
    sourceHash: string;
    from: string;
    until: string;
}) {
    if (task.signaturePolicy==='MANUAL_ONLY') throw Error('自动用印未启用（本轮逐份确认）');
    if (!task.grant?.archivedAt || task.grant.revokedAt || !providerAuthorityId)
        throw Error('请先读取独立授权归档与本企业渠道授权');
    return { grantId: task.grant.id, revision: task.grant.revision, sourceHash: task.grant.sourceHash, providerAuthorityId, idempotencyKey: crypto.randomUUID(), ...(internal ? { internalEvidenceFileId: internal.fileId, internalEvidenceHash: internal.hash, internalApplicability: { kind: 'EXACT_FROZEN_SCOPE', sourceHash: internal.sourceHash, signingValidFrom: shanghaiSigningInstant(internal.from), signingValidUntil: shanghaiSigningInstant(internal.until) } } : {}) };
}
export interface TechnicalAuthorityRecord {id:string;revision:number;scopeHash:string;enabled:boolean;status:string}
export function technicalAuthoritySwitch(ownerId:string,record:TechnicalAuthorityRecord){
 return {path:`/owners/${ownerId}/authorities/${record.id}/switch`,body:{enabled:!record.enabled,revision:record.revision,scopeHash:record.scopeHash}};
}
