#!/usr/bin/env node
/**
 * CLI 模式入口 - 保持原有的命令行工具功能
 */

import { scraperConfig } from './config/config.js'
import { logger } from './utils/logger.js'
import { defaultLogConfig } from './config/logConfig.js'
import { ScraperEngine } from './lib/core/ScraperEngine.js'

/**
 * CLI 进度显示
 */
function startProgressIfEnabled() {
  const logConfig = logger.getConfig()
  if (logConfig.showDownloadProgress) {
    logger.info('启动进度显示模式', 'system')
    logger.startProgress()
  } else {
    logger.info('进度显示已禁用，使用普通日志模式', 'system')
  }
}

function stopProgressIfEnabled() {
  const logConfig = logger.getConfig()
  if (logConfig.showDownloadProgress) {
    logger.stopProgress()
  }
}

/**
 * CLI 主函数
 */
async function runCLI(config) {
  // 初始化日志
  logger.initConfig(defaultLogConfig)
  logger.info('日志系统已初始化', 'system')

  // 启动进度显示
  startProgressIfEnabled()

  // 创建引擎实例
  const engine = new ScraperEngine(config, {
    onProgress: (progress) => {
      // CLI 模式下的进度处理（可选）
      if (progress.currentUrl) {
        logger.info(`正在处理: ${progress.currentUrl}`, 'progress')
      }
    },
    onComplete: (summary) => {
      stopProgressIfEnabled()
      logger.header('\n=================== 爬取完成 ===================')
      logger.info(`总耗时: ${summary.duration.toFixed(2)} 秒`)
      logger.info(`成功: ${summary.successCount || 0}, 失败: ${summary.errorCount || 0}`)

      // 输出 twoPhaseApi 结果（如果有）
      if (config?.analysis?.mode === 'twoPhaseApi' && summary.outputs) {
        const payload = {
          mode: 'twoPhaseApi',
          pages: summary.outputs
        }
        console.log(JSON.stringify(payload, null, 2))
      }
    },
    onError: (error) => {
      stopProgressIfEnabled()
      logger.error(`爬取失败: ${error.error}`, 'system')
    }
  })

  try {
    await engine.run()
  } catch (error) {
    logger.error(`发生严重错误: ${error.message}`, 'system')
    process.exit(1)
  }
}

// 启动 CLI
runCLI(scraperConfig)
