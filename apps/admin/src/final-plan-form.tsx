import { useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, type Entity } from './core';
import { creditPlanInitial, type CreditReview } from './credit';
import { commercialTermLabels } from './business-terms';
import { finalPlanInitial, finalPlanMissingFields, loadFinalPlanDefaults, type FinalPlanDefaults } from './final-plan-defaults';
import type { Field } from './resources';
import { ErrorNotice, Loading, RecordForm } from './ui';
import './final-plan-form.css';
import {electronicPlanFields,electronicPlanBody} from './electronic-source-model';

type Prepared = { defaults: FinalPlanDefaults; initial: Record<string, unknown>; sequence: number };

export function FinalPlanForm({ entity, review, fields, warning, onSubmit, onCancel, submitDisabled=false }: {
  submitDisabled?:boolean; entity: Entity; review?: CreditReview; fields: Field[]; warning?: string;
  onSubmit: (body: Record<string, unknown>) => Promise<void>; onCancel: () => void;
}) {
  const [prepared, setPrepared] = useState<Prepared>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const latest = useRef({ entity, review });
  latest.current = { entity, review };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(undefined);
    loadFinalPlanDefaults((path, options) => api.request(path, options), entity.id, controller.signal)
      .then(defaults => {
        if (controller.signal.aborted) return;
        const current = latest.current;
        if (defaults.revision !== Number(current.entity.revision ?? 0)) throw new Error('申请版本已更新，请刷新申请详情后重新读取产品；当前输入不会被覆盖');
        const initial = finalPlanInitial(current.entity, current.review, defaults);
        setPrepared(previous => ({ defaults, initial, sequence: (previous?.sequence ?? 0) + 1 }));
      })
      .catch(cause => { if (!controller.signal.aborted) setError(cause); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [entity.id, reload]);

  const retry = () => setReload(value => value + 1);
  if (!prepared || prepared.defaults.applicationId !== entity.id) return <div className="final-plan-loading">{loading ? <Loading label="正在读取产品与默认条款"/> : <><ErrorNotice error={error} retry={retry}/><button className="button" onClick={onCancel}>取消</button></>}</div>;

  // Only transaction/credit metadata follows a detail refresh. User text remains in RecordForm.
  const credit = creditPlanInitial(entity, review);
  const initial = { ...prepared.initial, ...Object.fromEntries(['revision', 'creditVerificationId', 'creditBand', 'creditRevision', 'creditRuleVersion', 'acceptancePricingScope'].map(key => [key, credit[key]])) };
  const electronic=prepared.defaults.contractMode==='ELECTRONIC';
  const missing = finalPlanMissingFields(prepared.defaults, initial.commercialTerms as Record<string, string>);

  return <div className="final-plan-form">
    <div className="final-plan-source" role="note">
      <div><strong>产品来源：{prepared.defaults.source.name} · 第 {prepared.defaults.source.version} 版</strong><p>{electronic?'按发布产品核对实际月数、约定费用组成与本单事实；固定法律正文由审定模板提供。':'价格、期限、里程及产品说明已从关联产品读取。14项条款可逐项修改；已有人工条款优先保留。'}</p></div>
      <button type="button" className="text-button" disabled={loading} onClick={retry}><RefreshCw size={14} className={loading ? 'spin' : undefined}/>{loading ? '正在读取产品' : '重新读取产品'}</button>
      <small>重新读取仅更新未修改的默认内容；人工修改及已填写日期会保留。</small>
      {missing.length ? <p className="final-plan-missing">请补充本单资料：{missing.map(key => commercialTermLabels[key] ?? key).join('、')}。</p> : null}
      {error ? <ErrorNotice error={error} retry={retry}/> : null}
    </div>
    <RecordForm fields={electronic?electronicPlanFields(fields):fields} initial={initial} commercialDefaults={prepared.defaults.values.commercialTerms} defaultsRevision={prepared.sequence} submitDisabled={loading||submitDisabled||prepared.defaults.revision!==Number(entity.revision??0)} warning={warning} submitLabel="生成待审方案" onSubmit={body => onSubmit({ ...(electronic?electronicPlanBody(body):body), productSourceHash: prepared.defaults.source.hash })} onCancel={onCancel}/>
  </div>;
}
