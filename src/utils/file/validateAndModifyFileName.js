import os from 'os';

/**
 * 跨平台文件名验证和修复工具
 * 支持 Windows、macOS 和 Linux 系统的文件命名规则
 */

// 操作系统规则配置
const OS_RULES = {
  win32: {
    // Windows 系统规则
    invalidChars: /[\\/:*?\"<>|]/g,
    reservedWords: [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ],
    maxLength: 255, // 单个文件名长度限制（不是路径长度）
    trimChars: [' ', '.'], // 不能以这些字符结尾
    replacementChar: '_'
  },
  darwin: {
    // macOS 系统规则
    invalidChars: /[:\x00]/g, // 冒号和NULL字符
    reservedWords: [], // macOS 没有系统级保留字
    maxLength: 255,
    trimChars: [], // macOS 相对宽松
    replacementChar: '_'
  },
  linux: {
    // Linux 系统规则
    invalidChars: /[\/\x00]/g, // 斜杠和NULL字符
    reservedWords: [], // Linux 没有系统级保留字
    maxLength: 255,
    trimChars: [], // Linux 相对宽松
    replacementChar: '_'
  },
  default: {
    // 默认规则（保守策略，适用于所有系统）
    invalidChars: /[\\/:*?\"<>|\x00]/g,
    reservedWords: [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ],
    maxLength: 255,
    trimChars: [' ', '.'],
    replacementChar: '_'
  }
};

/**
 * 获取当前操作系统的文件命名规则
 * @returns {Object} 操作系统规则对象
 */
function getOSRules() {
  const platform = os.platform();
  return OS_RULES[platform] || OS_RULES.default;
}

/**
 * 处理非法字符
 * @param {string} fileName - 原始文件名
 * @param {Object} rules - 操作系统规则
 * @returns {string} 处理后的文件名
 */
function sanitizeInvalidChars(fileName, rules) {
  return fileName.replace(rules.invalidChars, rules.replacementChar);
}

/**
 * 处理结尾字符
 * @param {string} fileName - 文件名
 * @param {Object} rules - 操作系统规则
 * @returns {string} 处理后的文件名
 */
function trimEndingChars(fileName, rules) {
  if (rules.trimChars.length === 0) return fileName;
  
  while (fileName.length > 0 && rules.trimChars.some(char => fileName.endsWith(char))) {
    fileName = fileName.slice(0, -1);
  }
  return fileName;
}

/**
 * 处理保留字
 * @param {string} fileName - 文件名
 * @param {Object} rules - 操作系统规则
 * @returns {string} 处理后的文件名
 */
function handleReservedWords(fileName, rules) {
  if (rules.reservedWords.length === 0) return fileName;
  
  const parts = fileName.split('.');
  const nameWithoutExt = parts[0].toUpperCase();
  const extension = parts.length > 1 ? parts.slice(1).join('.') : '';
  
  // 检查是否为保留字（不区分大小写）
  if (rules.reservedWords.includes(nameWithoutExt)) {
    const newName = rules.replacementChar + parts[0];
    return extension ? `${newName}.${extension}` : newName;
  }
  
  return fileName;
}

/**
 * 处理文件名长度
 * @param {string} fileName - 文件名
 * @param {Object} rules - 操作系统规则
 * @returns {string} 处理后的文件名
 */
function truncateFileName(fileName, rules) {
  if (fileName.length <= rules.maxLength) return fileName;
  
  const parts = fileName.split('.');
  if (parts.length === 1) {
    // 没有扩展名，直接截取
    return fileName.slice(0, rules.maxLength);
  }
  
  // 有扩展名，保留扩展名
  const extension = parts.pop();
  const nameWithoutExt = parts.join('.');
  const maxNameLength = rules.maxLength - extension.length - 1; // -1 for the dot
  
  if (maxNameLength > 0) {
    return `${nameWithoutExt.slice(0, maxNameLength)}.${extension}`;
  } else {
    // 扩展名太长，只保留部分扩展名
    return fileName.slice(0, rules.maxLength);
  }
}

/**
 * 验证并修复文件名，使其符合当前操作系统的文件命名规则
 * @param {string} fileName - 原始文件名
 * @param {string} [targetOS] - 目标操作系统 ('win32', 'darwin', 'linux', 'default')
 * @returns {string} 修复后的文件名
 */
export function validateAndModifyFileName(fileName, targetOS = null) {
  // 输入验证
  if (!fileName || typeof fileName !== 'string') {
    throw new Error('文件名必须是非空字符串');
  }
  
  // 获取规则（如果指定了目标OS，使用指定的规则）
  const rules = targetOS ? (OS_RULES[targetOS] || OS_RULES.default) : getOSRules();
  
  let modifiedFileName = fileName.trim();
  
  // 如果文件名为空或只包含空白字符
  if (!modifiedFileName) {
    return 'unnamed_file';
  }
  
  // 1. 处理非法字符
  modifiedFileName = sanitizeInvalidChars(modifiedFileName, rules);
  
  // 2. 处理结尾字符
  modifiedFileName = trimEndingChars(modifiedFileName, rules);
  
  // 3. 处理保留字
  modifiedFileName = handleReservedWords(modifiedFileName, rules);
  
  // 4. 处理长度限制
  modifiedFileName = truncateFileName(modifiedFileName, rules);
  
  // 5. 最后检查：如果处理后为空，提供默认名称
  if (!modifiedFileName) {
    modifiedFileName = 'unnamed_file';
  }
  
  return modifiedFileName;
}

/**
 * 获取当前系统的文件命名规则信息
 * @returns {Object} 规则信息
 */
export function getFileNamingRules() {
  return {
    platform: os.platform(),
    rules: getOSRules()
  };
}

/**
 * 检查文件名是否符合指定系统的命名规则
 * @param {string} fileName - 文件名
 * @param {string} [targetOS] - 目标操作系统
 * @returns {Object} 检查结果 { isValid: boolean, issues: string[] }
 */
export function validateFileName(fileName, targetOS = null) {
  const rules = targetOS ? (OS_RULES[targetOS] || OS_RULES.default) : getOSRules();
  const issues = [];
  
  if (!fileName || typeof fileName !== 'string') {
    issues.push('文件名必须是非空字符串');
    return { isValid: false, issues };
  }
  
  // 检查非法字符
  if (rules.invalidChars.test(fileName)) {
    issues.push(`包含非法字符: ${fileName.match(rules.invalidChars)?.join(', ')}`);
  }
  
  // 检查长度
  if (fileName.length > rules.maxLength) {
    issues.push(`文件名过长 (${fileName.length} > ${rules.maxLength})`);
  }
  
  // 检查结尾字符
  if (rules.trimChars.some(char => fileName.endsWith(char))) {
    issues.push(`不能以以下字符结尾: ${rules.trimChars.join(', ')}`);
  }
  
  // 检查保留字
  if (rules.reservedWords.length > 0) {
    const nameWithoutExt = fileName.split('.')[0].toUpperCase();
    if (rules.reservedWords.includes(nameWithoutExt)) {
      issues.push(`使用了系统保留字: ${nameWithoutExt}`);
    }
  }
  
  return {
    isValid: issues.length === 0,
    issues
  };
}
