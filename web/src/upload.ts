import type { SourceCapability } from './api'

const MB = 1024 * 1024
export const MAX_UPLOAD_BYTES = 10 * MB

export function sizeLabel(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** 选中或粘贴文件后立即检查；返回错误文案，null 表示可以发送。 */
export function checkAttachment(file: { type: string; size: number }, cap: SourceCapability): string | null {
  const image = file.type.startsWith('image/')
  if (cap.max_files < 1 || (!cap.send_images && !cap.send_files)) return '该平台暂不支持发送附件'
  if (image ? !cap.send_images : !cap.send_files) return image ? '该平台暂不支持发送图片' : '该平台暂不支持发送文件，仅可发送图片'
  if (file.size <= 0) return '不能发送空文件'
  const limit = Math.min(MAX_UPLOAD_BYTES, cap.max_attachment_bytes > 0 ? cap.max_attachment_bytes : MAX_UPLOAD_BYTES)
  if (file.size > limit) return `文件超过上限 ${Math.round(limit / MB)} MB（当前 ${sizeLabel(file.size)}）`
  return null
}
