import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ZodError} from 'zod';
import {curveActivateInput,curveArchiveInput,curveCreateInput,curveListInput,curvePreviewInput} from '../src/residual-market/curve-types';
import {ResidualCurvesService} from '../src/residual-market/curves';
import {curveFinance,curveOperator,residualCurveFixture} from './residual-curves-fixture';

test('curve DTO rejects NUL before database lookup/write without narrowing the existing 500-character ID contract',()=>{
 const preview={modelDefinitionId:'m',modelRevision:0,name:'曲线'},command={revision:0,idempotencyKey:'command-key',reason:'审核原因'};
 for(const change of [{modelDefinitionId:'a\0b'},{name:'a\0b'},{trim:'a\0b'}])assert.equal(curvePreviewInput.safeParse({...preview,...change}).success,false);
 assert.equal(curveCreateInput.safeParse({...preview,revision:0,idempotencyKey:'key-with\0nul',previewHash:'a'.repeat(64)}).success,false);
 for(const schema of [curveActivateInput,curveArchiveInput])assert.equal(schema.safeParse({...command,reason:'a\0b',...(schema===curveActivateInput?{effectiveFrom:'2026-10-31'}:{})}).success,false);
 assert.equal(curveListInput.safeParse({modelDefinitionId:'a\0b'}).success,false);assert.equal(curvePreviewInput.safeParse({...preview,modelDefinitionId:'m'.repeat(500)}).success,true);
});

test('curve pagination rejects unsafe PostgreSQL offsets while keeping the last valid Int offset',()=>{
 assert.equal(curveListInput.safeParse({page:2147483648,pageSize:1}).success,false);assert.equal(curveListInput.safeParse({page:21474838,pageSize:100}).success,false);assert.equal(curveListInput.safeParse({page:21474837,pageSize:100}).success,true);
});

test('curve detail and mutations reject NUL path IDs before any resource lookup',async()=>{
 const f=residualCurveFixture(),service=new ResidualCurvesService();await assert.rejects(service.detail(f.tx,curveFinance,'bad\0id'),error=>error instanceof ZodError);
 for(const action of ['activate','archive'] as const)await assert.rejects(f.serial(tx=>service[action](tx,curveOperator,'bad\0id',{revision:0,idempotencyKey:'test-command',reason:'核对编号',...(action==='activate'?{effectiveFrom:'2026-10-31'}:{})})),error=>error instanceof ZodError);
});
