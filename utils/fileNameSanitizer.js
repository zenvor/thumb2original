/**
 * @fileoverview
 * 提供一个函数，用于清理文件名，使其符合 Windows 文件系统的规则。
 * 该工具通过删除无效字符、处理保留名称、修剪空白以及确保名称不超过长度限制来清理文件名。
 */

// 匹配 Windows 文件名中无效字符的正则表达式。
const INVALID_CHARS_REGEX = /[\\/:*?"<>|]/g

// Windows 中的保留文件名集（不区分大小写）。
// 使用 Set 提供比数组更快的查找速度。
const RESERVED_FILENAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

// Windows 中文件名的最大长度通常为 255 个字符。
const MAX_FILENAME_LENGTH = 255

/**
 * 清理文件名，使其符合 Windows 文件系统的命名规则。
 *
 * 清理过程包括：
 * 1. 将 Windows 文件名中的无效字符替换为下划线。
 * 2. 对于 Windows 保留的名称（例如 'CON', 'LPT1'），在前面添加下划线。
 * 3. 从文件名的基本部分删除任何尾随的空格或句点。
 * 4. 如果总长度超过最大允许长度，则截断文件名的基本部分，同时保留扩展名。
 *
 * @param {string} fileName 要清理的原始文件名。
 * @returns {string} 清理后的安全文件名。如果输入不是有效字符串，则返回空字符串。
 */
export function sanitizeFileName(fileName) {
  if (typeof fileName !== 'string' || fileName.length === 0) {
    return ''
  }

  // 1. 将所有无效字符替换为下划线。
  const sanitized = fileName.replace(INVALID_CHARS_REGEX, '_')

  // 2. 稳健地将基本名称与扩展名分开。
  const lastDotIndex = sanitized.lastIndexOf('.')
  let baseName = lastDotIndex === -1 ? sanitized : sanitized.slice(0, lastDotIndex)
  const extension = lastDotIndex === -1 ? '' : sanitized.slice(lastDotIndex)

  // 3. 从基本名称中删除任何尾随的空格或句点。
  baseName = baseName.replace(/[ .]+$/, '')

  // 处理基本名称变为空的情况（例如，文件名为 ".txt" 或 ".."）。
  if (baseName.length === 0) {
    baseName = '_'
  }

  // 4. 检查是否与保留文件名冲突（不区分大小写）。
  if (RESERVED_FILENAMES.has(baseName.toUpperCase())) {
    baseName = `_${baseName}`
  }

  // 5. 如果组合长度超过最大限制，则截断基本名称。
  const availableLength = MAX_FILENAME_LENGTH - extension.length
  if (baseName.length > availableLength) {
    baseName = baseName.slice(0, availableLength)
  }

  // 重新组装清理后的文件名并返回。
  return baseName + extension
}
