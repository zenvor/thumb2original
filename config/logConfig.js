/**
 * @description 日志配置文件，用于自定义日志显示选项
 */

// 默认日志配置
export const defaultLogConfig = {
  // 日志级别: 'DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'
  logLevel: 'INFO',
  
  // 启用的日志分类
  enabledCategories: ['system', 'download', 'process', 'network'],
  
  // 是否显示时间戳
  showTimestamp: false,
  
  // 是否显示详细的网络请求信息
  showDetailedNetworkInfo: false,
  
  // 是否显示下载进度
  showDownloadProgress: false,
  
  // 是否在下载完成后显示统计信息
  showStatistics: true
}

/**
 * @description 初始化日志配置
 * @param {object} logger - 日志记录器实例
 * @param {object} userConfig - 用户自定义配置
 */
export function initLogConfig(logger, userConfig = {}) {
  // 合并用户配置与默认配置
  const config = { ...defaultLogConfig, ...userConfig }
  
  // 设置日志级别
  logger.setLevel(config.logLevel)
  
  // 设置启用的日志分类
  logger.enableCategories(config.enabledCategories)
  
  // 如果不显示详细的网络请求信息，禁用网络分类
  if (!config.showDetailedNetworkInfo && config.enabledCategories.includes('network')) {
    logger.disableCategory('network')
  }
  
  return config
}
