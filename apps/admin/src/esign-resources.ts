import type { Field, Resource } from './resources';

const status = { key: 'status', label: '状态' };
const created = { key: 'createdAt', label: '创建时间', format: 'date' as const };
export const prepareFields = (kind: 'SUBSCRIPTION' | 'HANDOVER' | 'AMENDMENT'): Field[] => [{ key: 'policyId', label: '签署策略', source: 'signature-policies', sourceFilters: { status: 'ACTIVE', kind }, required: true, hint: '选择已启用、与当前文档类型一致的顺序签署策略' }];
export const esignResources: Resource[] = [
  {
    key: 'enterprise-seals', title: '企业印章', singular: '印章档案', subtitle: '企业身份与供应商印章映射由两名管理员分别建档、核验启用。', create: true,
    columns: [{ key: 'sealName', label: '印章名称' }, { key: 'organizationName', label: '企业主体' }, status, { key: 'confirmedAt', label: '核验时间', format: 'date' }, created],
    fields: [{ key: 'sealName', label: '印章名称', required: true }, { key: 'organizationName', label: '企业主体', required: true, readOnly: true, defaultValue: '上海晓浪网络科技有限公司' }, { key: 'providerCustomerId', label: '供应商企业客户编号', required: true, hint: '使用已核验的法大大企业账号映射编号' }, { key: 'providerSignatureId', label: '供应商印章编号', required: true }, { key: 'evidenceFileId', label: '企业与用印授权证明', type: 'files', uploadPurpose: 'evidence', required: true }],
    actions: [{ label: '核验并启用印章', path: 'activate', fixed: { identityConfirmed: true }, warning: '请核对企业主体、授权证明及供应商印章映射。须由建档人员之外的另一名管理员核验，服务端同时校验已配置的企业与印章映射。', kind: 'primary' }, { label: '停用印章', path: 'disable', warning: '停用后依赖此印章的签署计划将无法通过执行校验。', kind: 'danger' }],
  },
  {
    key: 'seal-authorities', title: '用印授权', singular: '用印授权', subtitle: '申请用印与复核用印分别授权；所有授权始终要求双人审批。', create: true,
    columns: [{ key: 'sealId', label: '印章' }, { key: 'subjectType', label: '授权对象' }, { key: 'subjectId', label: '人员 / 角色' }, { key: 'authorityType', label: '授权类型' }, status, created],
    fields: [{ key: 'sealId', label: '企业印章', source: 'enterprise-seals', sourceFilters: { status: 'ACTIVE' }, required: true }, { key: 'subjectType', label: '授权对象类型', type: 'select', required: true, options: [['USER', '指定人员'], ['ROLE', '后台角色']] }, { key: 'subjectId', label: '授权人员或角色', type: 'select', required: true, sourceWhen: { field: 'subjectType', value: 'USER', source: 'users' }, options: [['ADMIN', '管理员'], ['OPERATIONS', '运营审核']] }, { key: 'authorityType', label: '授权类型', type: 'select', required: true, options: [['REQUEST_USE', '申请用印'], ['APPROVE_USE', '复核用印']] }],
    actions: [{ label: '撤销用印授权', path: 'revoke', warning: '撤销后该对象将不再具备对应印章的申请或复核权限。', kind: 'danger' }],
  },
  {
    key: 'signature-policies', title: '签署策略', singular: '签署策略', subtitle: '配置订阅合同与交接单的印章；按先客户签署、后企业盖章执行。', create: true,
    columns: [{ key: 'policyName', label: '策略名称' }, { key: 'policyCode', label: '策略编码' }, { key: 'kind', label: '文档类型' }, { key: 'sealId', label: '企业印章' }, status, created],
    fields: [{ key: 'policyCode', label: '策略编码', required: true, hint: '仅英文字母、数字、下划线与连字符，最多100位' }, { key: 'policyName', label: '策略名称', required: true }, { key: 'kind', label: '适用文档', type: 'select', required: true, options: [['SUBSCRIPTION', '订阅合同'], ['HANDOVER', '车辆交接单'], ['AMENDMENT', '延期补充协议']] }, { key: 'sealId', label: '企业印章', source: 'enterprise-seals', sourceFilters: { status: 'ACTIVE' }, required: true }, { key: 'executionMode', label: '执行顺序', type: 'select', required: true, defaultValue: 'SEQUENTIAL', options: [['SEQUENTIAL', '先客户签署，再企业盖章']] }],
    actions: [{ label: '启用签署策略', path: 'activate', kind: 'primary' }, { label: '停用签署策略', path: 'disable', warning: '停用后使用该策略的计划将无法发起或继续通过执行校验。', kind: 'danger' }],
  },
  {
    key: 'esign-approvals', title: '签署计划审批', singular: '签署复核计划', subtitle: '复核冻结的合同PDF、文档哈希、签署位置与印章。申请人与审批人必须不同。',
    columns: [{ key: 'id', label: '计划编号' }, { key: 'kind', label: '文档类型' }, { key: 'resourceId', label: '业务对象' }, { key: 'requesterId', label: '申请人' }, status, { key: 'expiresAt', label: '有效期', format: 'date' }],
    actions: [{ label: '同一签署任务重新授权', path: 'renew', fields: prepareFields('SUBSCRIPTION'), warning: '本操作沿用同一签署任务与冻结PDF，生成新的待复核授权计划。请核对原任务、文档哈希与所选策略；新计划仍须另一名有效授权人员复核通过，才可继续原任务。不会重新生成签署任务或替换PDF。', kind: 'primary' }, { label: '复核通过签署计划', path: 'approve', fields: [{ key: 'planHash', label: '当前签署计划哈希', required: true, readOnly: true }], warning: '请先阅读冻结的PDF，核对客户、商业条款、印章、签署位置与计划版本。审批须由拥有有效复核用印授权的另一名人员完成；审批通过后仍以供应商最终签署结果为准。', kind: 'primary' }, { label: '驳回签署计划', path: 'reject', fields: [{ key: 'reason', label: '驳回原因', type: 'textarea', required: true, hint: '最多500字；明确需要修订的文档、印章或签署位置' }], warning: '驳回会保留旧PDF与复核记录。返回合同或交接单重新准备时，服务端生成新的复核记录。', kind: 'danger' }],
  },
];
