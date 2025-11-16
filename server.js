#!/usr/bin/env node
/**
 * API 服务器模式入口
 */

import { ScraperServer } from './server/index.js'
import { logger } from './utils/logger.js'

// 从环境变量或命令行参数获取配置
const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3', 10)
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*'

// 创建服务器实例
const server = new ScraperServer({
  port: PORT,
  host: HOST,
  maxConcurrent: MAX_CONCURRENT,
  corsOrigin: CORS_ORIGIN
})

// 启动服务器
server.start().catch(error => {
  logger.error(`服务器启动失败: ${error.message}`)
  process.exit(1)
})

// 优雅退出
process.on('SIGTERM', async () => {
  logger.info('收到 SIGTERM 信号，准备关闭...')
  await server.stop()
  process.exit(0)
})

process.on('SIGINT', async () => {
  logger.info('收到 SIGINT 信号，准备关闭...')
  await server.stop()
  process.exit(0)
})

// 未捕获异常处理
process.on('uncaughtException', (error) => {
  logger.error(`未捕获异常: ${error.message}`, 'system')
  console.error(error.stack)
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`未处理的 Promise 拒绝: ${reason}`, 'system')
  console.error('Promise:', promise)
})
