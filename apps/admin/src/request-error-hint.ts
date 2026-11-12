export function requestErrorHint(error: { status: number; code: string }): string | undefined {
  if (error.status !== 409) return;
  if (['REVISION_CONFLICT', 'VERSION_CONFLICT'].includes(error.code)) {
    return '记录已经发生变化，请关闭表单并刷新详情后重新核对。';
  }
  if (error.code === 'OWNER_NOT_READY') {
    return '请实际车主的法人本人进入服务号“企业与印章”，按缺项提示更新核验或选择印章；完成后回到后台重试。';
  }
}
