/**
 * 标准错误类型定义与工具方法
 * - 目标：统一错误分类，便于上层重试与日志结构化
 * - 分类：可重试/不可重试/用户配置错误/外部依赖错误
 */

/**
 * @typedef {Object} AppErrorOptions
 * @property {string} [code]            错误代码（如 INVALID_CONFIG/NETWORK_TIMEOUT 等）
 * @property {boolean} [retriable]      是否可重试
 * @property {boolean} [isCritical]     是否为关键错误（需要立即终止流程）
 * @property {string} [category]        错误分类（config/dependency/fs/network/runtime）
 * @property {any} [context]            结构化上下文（如 url、filePath、downloadId）
 * @property {Error} [cause]            原始错误
 */

export class BaseAppError extends Error {
  /**
   * @param {string} message 
   * @param {AppErrorOptions} [options]
   */
  constructor(message, options = {}) {
    super(message)
    this.name = this.constructor.name
    this.code = options.code || undefined
    this.retriable = options.retriable ?? false
    this.isCritical = options.isCritical ?? false
    this.category = options.category || 'runtime'
    this.context = options.context || undefined
    if (options.cause) this.cause = options.cause
  }
}

export class RetriableError extends BaseAppError {
  /** @param {string} message @param {AppErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, retriable: true })
  }
}

export class NonRetriableError extends BaseAppError {
  /** @param {string} message @param {AppErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, retriable: false })
  }
}

export class UserConfigError extends BaseAppError {
  /** @param {string} message @param {AppErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, retriable: false, category: 'config', code: options.code || 'INVALID_CONFIG' })
  }
}

export class ExternalDependencyError extends BaseAppError {
  /** @param {string} message @param {AppErrorOptions} [options] */
  constructor(message, options = {}) {
    super(message, { ...options, category: 'dependency' })
  }
}

/**
 * 将错误转换为适合结构化日志的元信息对象
 * @param {Error} error
 */
export function toLogMeta(error) {
  if (!error || typeof error !== 'object') return {}
  return {
    errorType: error.name,
    errorCode: error.code,
    retriable: error.retriable,
    isCritical: error.isCritical,
    category: error.category,
    causeMessage: error.cause?.message,
    context: error.context
  }
}


