/**
 * API 服务器入口文件
 */

import { createApp } from './server/app.js'
import { logger } from './utils/logger.js'

const PORT = process.env.PORT || 3000
const HOST = process.env.HOST || '0.0.0.0'

async function start() {
  try {
    const app = createApp()

    app.listen(PORT, HOST, () => {
      logger.info(`🚀 thumb2original API server started`)
      logger.info(`   Address: http://${HOST}:${PORT}`)
      logger.info(`   Health check: http://${HOST}:${PORT}/health`)
      logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    })

    // 优雅关闭
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received, shutting down gracefully...')
      process.exit(0)
    })

    process.on('SIGINT', () => {
      logger.info('SIGINT received, shutting down gracefully...')
      process.exit(0)
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

start()
