// Windows 设备名（不区分大小写）
const RESERVED_FILENAMES = new Set([
  'CON','PRN','AUX','NUL',
  'COM1','COM2','COM3','COM4','COM5','COM6','COM7','COM8','COM9',
  'LPT1','LPT2','LPT3','LPT4','LPT5','LPT6','LPT7','LPT8','LPT9',
])

// 非法字符模式
const INVALID_WINDOWS = /[\\/:*?"<>|]/g        // 同时包含 / 和 :
const INVALID_MAC = /[:/]/g                    // macOS/Finder 禁用 ":"；POSIX 分隔符 "/"
const CONTROL_CHARS = /[\x00-\x1F]/g;          // 控制字符，跨平台都不安全

/**
 * 跨平台清理文件名（Windows / macOS / universal）。
 *
 * @param {string} fileName
 * @param {{ platform?: 'windows'|'mac'|'universal', normalize?: boolean, maxLength?: number }} [options]
 * @returns {string}
 */
export function sanitizeFileName(fileName, options) {
  const opts = options || {}
  const platform = opts.platform || 'universal'     // 'windows' | 'mac' | 'universal'
  const doNormalize = opts.normalize !== false      // 默认执行 NFC 规范化
  const MAX_LEN = typeof opts.maxLength === 'number' ? opts.maxLength : 255

  if (typeof fileName !== 'string' || fileName.length === 0) return ''

  // 统一做 Unicode 规范化，避免组合字符导致的奇异情况
  let input = doNormalize && String.prototype.normalize
    ? fileName.normalize('NFC')
    : fileName

  // 先去除控制字符
  input = input.replace(CONTROL_CHARS, '_')

  // 选择平台对应的非法字符集合
  let invalidRegex
  switch (platform) {
    case 'windows':
      invalidRegex = INVALID_WINDOWS
      break
    case 'mac':
      invalidRegex = INVALID_MAC
      break
    default: // 'universal'：取并集，直接用 Windows 集合即可覆盖 mac 的 ":" 与 "/"
      invalidRegex = INVALID_WINDOWS
  }

  // 1) 替换非法字符
  let sanitized = input.replace(invalidRegex, '_')

  // 2) 拆分主名与扩展名（保留最后一个点后的部分）
  const lastDot = sanitized.lastIndexOf('.')
  let base = lastDot === -1 ? sanitized : sanitized.slice(0, lastDot)
  const ext = lastDot === -1 ? '' : sanitized.slice(lastDot)

  // 3) 去除主名尾部空格与句点（Windows 要求；在 mac 上也安全）
  base = base.replace(/[ .]+$/, '')

  // 4) 主名为空兜底
  if (!base) base = '_'

  // 5) 处理 Windows 保留名（universal 也规避，确保跨平台移动安全）
  if (platform === 'windows' || platform === 'universal') {
    if (RESERVED_FILENAMES.has(base.toUpperCase())) {
      base = `_${base}`
    }
  }

  // 6) 长度限制（按字符数截断）
  const available = Math.max(0, MAX_LEN - ext.length)
  if (base.length > available) base = base.slice(0, available)

  return base + ext
}
