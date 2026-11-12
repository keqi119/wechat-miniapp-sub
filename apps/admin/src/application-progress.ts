import type { Entity } from './core.ts';
import type { CreditReview } from './credit.ts';

export type ApplicationProgressInput = { application: Entity; credit?: CreditReview & { verificationCurrent?: boolean }; qualification?: Record<string, unknown>; risk?: Record<string, unknown>; loadState: 'loading' | 'ready' | 'error'; actorId?: string };
export type ApplicationStageKey = 'acceptance' | 'preparation' | 'risk' | 'confirmation' | 'order';
export type ApplicationProgressState = 'done' | 'current' | 'pending' | 'blocked' | 'unknown';
export type ApplicationProgressTarget = 'accept' | 'profile' | 'credit' | 'plan' | 'risk' | 'customer' | 'order' | 'refresh';
export type ApplicationProgressTask = { key: string; title: string; state: ApplicationProgressState; description: string; target: ApplicationProgressTarget; actionLabel: string };
export type ApplicationProgressBlocker = Omit<ApplicationProgressTask, 'state'>;
export type ApplicationProgress = {
  current: { key: ApplicationStageKey; title: string; description: string };
  stages: { key: ApplicationStageKey; label: string; state: ApplicationProgressState }[];
  tasks: ApplicationProgressTask[]; blockers: ApplicationProgressBlocker[]; completed: string[];
  next?: { target: ApplicationProgressTarget; label: string; description: string };
  terminal: 'cancelled' | 'rejected' | 'confirmed' | null;
  canGeneratePlan: boolean; showAccept: boolean; planCurrent: boolean;
};
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const stages: [ApplicationStageKey, string][] = [['acceptance', '受理'], ['preparation', '审核准备'], ['risk', '本单风控'], ['confirmation', '客户确认'], ['order', '正式订单']];
const task = (key: string, title: string, state: ApplicationProgressState, description: string, target: ApplicationProgressTarget, actionLabel: string): ApplicationProgressTask => ({ key, title, state, description, target, actionLabel });
const blocker = ({ state: _state, ...value }: ApplicationProgressTask): ApplicationProgressBlocker => value;
const next = (value: ApplicationProgressBlocker) => ({ target: value.target, label: value.actionLabel, description: value.description });
function base(key: ApplicationStageKey, title: string, description: string): ApplicationProgress {
  const index = stages.findIndex(([value]) => value === key);
  return { current: { key, title, description }, stages: stages.map(([value, label], i) => ({ key: value, label, state: i < index ? 'done' : i === index ? 'current' : 'pending' })), tasks: [], blockers: [], completed: [], terminal: null, canGeneratePlan: false, showAccept: false, planCurrent: false };
}
function unknown(description: string, loading = false): ApplicationProgress {
  const result = base('preparation', loading ? '正在读取申请进度' : '申请进度待核对', description);
  result.stages = result.stages.map(stage => ({ ...stage, state: 'unknown' }));
  const issue = blocker(task('progress', loading ? '读取中' : '当前进度无法确认', 'unknown', description, 'refresh', '刷新进度'));
  result.blockers = [issue]; result.next = next(issue); return result;
}

/** Presentation only. Existing API permissions and transaction gates remain authoritative. */
export function applicationProgress(input: ApplicationProgressInput): ApplicationProgress {
  const { application: app, credit, qualification, risk, loadState, actorId } = input;
  if (!text(app.id)) return unknown('申请信息不完整，请重新读取。');
  if (app.status === 'CANCELLED' || app.status === 'REJECTED') {
    const rejected = app.status === 'REJECTED';
    const result = base('acceptance', rejected ? '申请已拒绝' : '申请已取消', text(app.note) ? app.note : rejected ? '本次申请已结束，不再进入方案确认或订单办理。' : '客户已取消本次申请，不再继续审核。');
    result.terminal = rejected ? 'rejected' : 'cancelled';
    result.stages = result.stages.map(stage => ({ ...stage, state: 'pending' }));
    return result;
  }
  if (app.status === 'FINAL_PLAN_CONFIRMED') {
    const order = object(app.order);
    if (!text(order.id) || order.applicationId !== app.id) return unknown('客户方案已确认，但关联订单信息尚未完整读取，请刷新后进入正式订单。');
    const result = base('order', '已形成正式订单', '客户已确认方案。合同归档、付款和交还车请在正式订单中继续办理。');
    result.stages = result.stages.map(stage => ({ ...stage, state: 'done' }));
    result.terminal = 'confirmed'; result.completed = ['申请已受理', '审核准备已完成', '本单风控已通过', '客户已确认方案', '正式订单已建立'];
    result.next = { target: 'order', label: '进入正式订单', description: '继续办理线下合同、支付与车辆交接。' }; return result;
  }
  if (loadState === 'loading') return unknown('正在读取当前信用、客户资格及本单风控结果，读取完成后显示下一步。', true);
  if (loadState === 'error') return unknown('进度读取失败或当前账户无权读取；不能据此判断审核已完成，请重试并核对权限。');
  if (!['SUBMITTED', 'IN_REVIEW', 'NEEDS_INFO', 'AWAITING_CONFIRMATION'].includes(String(app.status)) || !Number.isSafeInteger(app.revision) || !text(app.customerId)) return unknown('申请状态或版本无法识别，请刷新进度。');
  const plan = object(app.finalPlan), hasPlan = text(plan.id);
  const q = object(qualification), qCurrent = object(q.current), qItems = Array.isArray(q.items) ? q.items : [], currentQ = object(qItems[0]);
  const r = object(risk), rCurrent = object(r.current), review = object(r.review);
  if (!credit || credit.applicationId !== app.id || !Number.isSafeInteger(credit.creditRevision) || typeof credit.verificationCurrent !== 'boolean' || typeof credit.consentRequirementsMet !== 'boolean' || !text(credit.ruleVersion) || !['VERIFIED', 'CONSENT_REQUIRED', 'AWAITING_VERIFICATION', 'MANUAL_REVIEW', 'HISTORICAL'].includes(credit.status)) return unknown('当前申请信用信息缺失、未完整读取或归属不符，请刷新。');
  if (q.customerId !== app.customerId || !Array.isArray(q.items) || !['PENDING', 'SUBMITTED', 'APPROVED', 'NEEDS_INFO', 'REJECTED', 'RECHECK_REQUIRED'].includes(qCurrent.status)) return unknown('客户资格信息缺失、状态未知或归属不符，请刷新。');
  if (hasPlan && (r.applicationId !== app.id || !['PENDING', 'APPROVED', 'NEEDS_INFO', 'REJECTED', 'RECHECK_REQUIRED'].includes(rCurrent.status))) return unknown('本次候选方案的风险审核结果未完整读取，请刷新。');
  if (hasPlan && (!['OFFLINE','ELECTRONIC'].includes(plan.contractMode) || !['DRAFT', 'APPROVED', 'NEEDS_INFO', 'REJECTED'].includes(plan.reviewStatus))) return unknown('当前方案办理路线或审核状态待核对，请刷新。');
  if (qCurrent.status === 'APPROVED' && (!text(currentQ.id) || currentQ.status !== 'APPROVED')) return unknown('客户资格当前结论与版本信息不一致，请刷新后办理。');
  const verified = credit.status === 'VERIFIED' && credit.verificationCurrent === true && credit.consentRequirementsMet === true && text(credit.verification?.id) && ['GE750', 'B700_749', 'B650_699'].includes(credit.verification!.band) && credit.verification!.consentId === credit.consent?.id && credit.consent?.status === 'ACCEPTED' && !credit.consent.withdrawnAt && credit.document?.id === credit.consent.documentId && credit.document?.version === credit.consent.version;
  const planCurrent = hasPlan && verified && plan.revision === app.revision && text(plan.commercialHash) && plan.creditRevision === credit.creditRevision && plan.creditRuleVersion === credit.ruleVersion && plan.creditVerificationId === credit.verification?.id && plan.creditBand === credit.verification?.band;
  const qualified = qCurrent.status === 'APPROVED';
  const qualificationDescription = qualified ? '当前身份与驾驶资格审核有效。' : qCurrent.status === 'SUBMITTED' ? currentQ.submittedBy === actorId ? '资格资料已提交；请由其他具备权限的人员独立审核。' : '资格资料已提交，等待独立审核。' : qCurrent.status === 'RECHECK_REQUIRED' ? '资料、证据或有效期已变化，需重新提交并审核客户资格。' : qCurrent.status === 'NEEDS_INFO' ? text(qCurrent.supplementaryInstructions) ? `资格材料待补充：${qCurrent.supplementaryInstructions}` : '资格材料待补充，补齐后重新提交审核。' : qCurrent.status === 'REJECTED' ? '当前资格未通过；请核对原因并提交新的材料版本。' : '尚未提交客户身份与驾驶资格审核资料。';
  const qualificationTask = task('qualification', '身份与驾驶资格', qualified ? 'done' : qCurrent.status === 'PENDING' || qCurrent.status === 'SUBMITTED' ? 'pending' : 'blocked', qualificationDescription, 'profile', qualified ? '查看客户资料' : qCurrent.status === 'SUBMITTED' ? '办理资格审核' : '完善客户资格');
  const creditDescription = verified ? '本申请当前信用授权与人工核验有效；信用档位用于计算押金。' : credit.consentRequirementsMet !== true ? '客户需先确认当前用户协议与隐私政策，再继续本申请信用核验。' : credit.status === 'MANUAL_REVIEW' ? '当前信用档位或授权需人工处理，暂不能生成正式方案。' : credit.status === 'AWAITING_VERIFICATION' ? '客户已授权，等待运营录入本申请信用档位。' : credit.status === 'HISTORICAL' ? '当前读取的是历史信用记录，请核对申请状态。' : '等待客户本人授权或重新核验本申请信用；已有旧核验不代表当前有效。';
  const creditTask = task('credit', '信用授权与核验', verified ? 'done' : 'blocked', creditDescription, 'credit', verified ? '查看信用核验' : '办理信用核验');
  const planDescription = planCurrent ? `第 ${plan.revision} 版候选与本申请当前信用一致；生成候选不代表风险审核通过。` : hasPlan ? '候选方案与当前申请或信用版本不一致，请在有效信用核验后重新生成候选。' : verified ? '信用已有效，可先生成候选方案，不必等待客户资格审核完成。' : '先完成受理和有效信用核验，再生成本申请候选方案。';
  const planTask = task('plan', '候选方案', planCurrent ? 'done' : hasPlan ? 'blocked' : 'pending', planDescription, 'plan', hasPlan ? '重新生成候选方案' : '生成待审方案');
  const preparation = [qualificationTask, creditTask, planTask];
  const result = base('preparation', '审核准备', '身份与驾驶资格审核可与信用核验并行；信用有效后即可生成候选，三项齐备后进行本单风控。');
  result.tasks = preparation; result.planCurrent = planCurrent;
  result.canGeneratePlan = credit.canFinalize === true && verified && ['IN_REVIEW', 'AWAITING_CONFIRMATION'].includes(String(app.status));
  result.showAccept = ['SUBMITTED', 'NEEDS_INFO'].includes(String(app.status));
  result.completed = [app.status !== 'SUBMITTED' ? '申请已受理' : '', ...preparation.filter(item => item.state === 'done').map(item => item.title + '已完成')].filter(Boolean);
  result.blockers = preparation.filter(item => item.state !== 'done').map(blocker);
  if (app.status === 'SUBMITTED') {
    result.current = { key: 'acceptance', title: '等待受理', description: '申请已提交。受理只表示开始办理，不代表审核通过。' };
    result.stages = base('acceptance', '', '').stages;
    result.next = { target: 'accept', label: '受理申请', description: '开始办理后继续核对客户资格、信用与候选方案。' }; return result;
  }
  if (app.status === 'NEEDS_INFO') {
    result.current.title = '等待补充资料';
    result.current.description = text(app.note) ? `本次申请待补充：${app.note}` : '申请已退回补件；请核对所需资料，客户补件后继续审核。';
    result.next = { target: 'profile', label: '查看需补充的客户资料', description: result.current.description };
    if (!result.blockers.length) result.blockers = [blocker(task('supplement', '申请待补件', 'blocked', result.current.description, 'profile', '查看客户资料'))];
    return result;
  }
  if (result.blockers.length) {
    result.current.description = result.blockers.map(item => item.description).join(' ');
    result.next = next(result.blockers[0]); return result;
  }
  result.current = { key: 'risk', title: rCurrent.status === 'RECHECK_REQUIRED' ? '本单风控需重新审核' : '等待本单风控审核', description: '资格、信用与候选方案已准备齐全。请审核本次候选，审核通过后才开放给客户确认。' };
  result.stages = base('risk', '', '').stages;
  if (rCurrent.status === 'APPROVED') {
    const riskMatches = plan.reviewStatus === 'APPROVED' && review.decision === 'APPROVED' && text(review.id) && review.planRevision === plan.revision && review.commercialHash === plan.commercialHash && review.qualificationId === currentQ.id;
    if (!riskMatches || app.status !== 'AWAITING_CONFIRMATION') return unknown('风险通过记录与当前候选或申请状态不一致，请刷新并重新核对。');
    result.current = { key: 'confirmation', title: '等待客户确认方案', description: '本单风控已通过，客户需在小程序核对并确认当前方案；确认成功后才建立正式订单。' };
    result.stages = base('confirmation', '', '').stages;
    result.completed.push('本单风控已通过');
    result.next = { target: 'customer', label: '等待客户本人确认', description: '由客户本人确认；系统将在确认时再次核对车辆、产品、合作资料及客户资料。' }; return result;
  }
  const riskDescription = rCurrent.status === 'RECHECK_REQUIRED' ? '之前的风险结论因资料、车辆、信用或方案变化已失效，请重新审核本次候选。' : rCurrent.status === 'NEEDS_INFO' ? text(rCurrent.supplementaryInstructions) ? `本单风控要求补件：${rCurrent.supplementaryInstructions}` : '本单风控要求补充资料，补齐后重新审核。' : rCurrent.status === 'REJECTED' ? '本次候选未通过风险审核，请核对处理结论。' : result.current.description;
  const riskBlocker = blocker(task('risk', result.current.title, 'blocked', riskDescription, 'risk', '审核本次候选方案'));
  result.blockers = [riskBlocker]; result.next = next(riskBlocker); return result;
}

export function applicationActionReceipt(action: string): { title: string; description: string; nextTarget?: ApplicationProgressTarget } {
  const receipts: Record<string, { title: string; description: string; nextTarget?: ApplicationProgressTarget }> = {
    accept: { title: '申请已受理', description: '受理不代表审核通过。继续准备客户资格、信用核验与候选方案。', nextTarget: 'profile' },
    'request-info': { title: '申请已退回补件', description: '等待客户补充所需资料，再继续本次审核。', nextTarget: 'profile' },
    reject: { title: '本次申请已拒绝', description: '本次申请已结束，请查看最新处理结论。' },
    credit: { title: '信用档位已记录', description: '请核对候选是否使用当前信用版本；已有候选不匹配时需要重新生成。', nextTarget: 'plan' },
    plan: { title: '候选方案已生成', description: '候选仍需本单风险审核；资格有效且审核通过后，客户才能确认方案。', nextTarget: 'risk' },
    'qualification-submit': { title: '资格资料已提交', description: '身份与驾驶资格等待独立审核，当前不代表已通过。', nextTarget: 'profile' },
    'qualification-approve': { title: '客户资格审核已通过', description: '继续核对当前信用及候选方案，完成本单风险审核。', nextTarget: 'risk' },
    'qualification-needs-info': { title: '资格资料待补充', description: '按补件说明补齐资料，再提交新的资格版本。', nextTarget: 'profile' },
    'qualification-reject': { title: '资格审核未通过', description: '请核对原因及客户资料；该结论不等于整笔申请已拒绝。', nextTarget: 'profile' },
    'risk-approve': { title: '本单风险审核已通过', description: '等待客户在小程序确认当前方案，确认成功后建立正式订单。', nextTarget: 'customer' },
    'risk-needs-info': { title: '本次申请已退回补件', description: '补齐资料后，重新核对候选并进行本单风险审核。', nextTarget: 'profile' },
    'risk-reject': { title: '本次申请未通过审核', description: '本次申请已结束，不再进入客户确认或订单办理。' },
  };
  return receipts[action] ?? { title: '操作已提交', description: '请查看刷新后的申请进度和下一步。' };
}
