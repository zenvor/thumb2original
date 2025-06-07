import { Crawler } from './core/Crawler.js'
import { config } from './config.js'

/**
 * 模块化爬虫启动入口
 * 通过配置文件启动爬虫系统
 */
async function main() {
  try {
    console.log('🚀 启动模块化爬虫系统...')
    
    // 使用配置文件创建爬虫（日志级别会自动从配置文件中读取）
    const crawler = new Crawler(config)
    
    // 运行爬虫
    await crawler.run()
    
    console.log('✅ 爬虫任务完成!')
    
  } catch (error) {
    console.error('❌ 爬虫运行失败:', error.message)
    process.exit(1)
  }
}

// 启动爬虫
main()

export { Crawler } 