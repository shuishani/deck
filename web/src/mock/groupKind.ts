export type GroupKind = 'test' | 'prod'

// 后端还没有这个字段：先按群名猜，以后换成后端返回的标记。
export function groupKind(name: string): GroupKind {
  return /test|测试/i.test(name) ? 'test' : 'prod'
}
