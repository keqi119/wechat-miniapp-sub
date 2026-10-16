import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
export function fail(status: number, code: string, message: string): never { throw new HttpException({ error: { code, message } }, status); }
export function ensure(value: unknown, status = 400, code = 'VALIDATION', message = '请求参数无效'): asserts value { if (!value) fail(status, code, message); }
@Catch()
export class Errors implements ExceptionFilter {
  catch(error: any, host: ArgumentsHost) {
    let status = 500;
    let body: any = { error: { code: 'INTERNAL', message: '服务暂时不可用' } };
    if (error instanceof HttpException) { status = error.getStatus(); const response = error.getResponse(); body = typeof response === 'object' && 'error' in response ? response : { error: { code: 'REQUEST_FAILED', message: typeof response === 'string' ? response : (response as any).message } }; }
    else if (error?.name === 'ZodError') { status = 400; body = { error: { code: 'VALIDATION', message: '请求参数无效', details: error.issues.map((i: any) => ({ path: i.path, message: i.message })) } }; }
    else if (error?.code === 'P2002' || error?.code === 'P2034') { status = 409; body = { error: { code: 'CONFLICT', message: '数据已变更或重复，请刷新后重试' } }; }
    else if (error?.code === 'P2025') { status = 404; body = { error: { code: 'NOT_FOUND', message: '记录不存在' } }; }
    host.switchToHttp().getResponse().status(status).json({ ...body, requestId: randomUUID() });
  }
}
