import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { scraperConfig } from './config/config.js'
import { logger } from './utils/logger.js'
import { defaultLogConfig } from './config/logConfig.js'

// 根据配置决定是否使用 stealth 插件
if (scraperConfig.antiDetection?.enableStealth !== false) {
  puppeteer.use(StealthPlugin())
  logger.info('已启用 Stealth 插件进行反检测')
}
import { downloadManager } from './lib/downloadManager.js'
import { 
  loadAndScrollPage, 
  extractImageUrls, 
  processUrlsByImageMode, 
  processLocalHtmlMode 
} from './lib/htmlProcessor.js'
import { scrapeUrl } from './lib/downloadManager.js'
import fs from 'fs/promises'
import path from 'path'

/**
 * @description 主函数，根据配置启动图片抓取器。
 * @param {object} config - 爬虫的配置对象。
 */
async function runImageScraper(config) {
  // 初始化日志配置
  logger.initConfig(defaultLogConfig);
  logger.info('日志系统已初始化', 'system');
  // 检查输出目录可写性，不可写则回退到 ./download
  try {
    const outputDir = config.outputDirectory || path.join(process.cwd(), 'download')
    await fs.mkdir(outputDir, { recursive: true })
    await fs.access(outputDir)
    logger.info(`输出目录可用: ${outputDir}`)
  } catch (e) {
    const fallback = path.join(process.cwd(), 'download')
    logger.warn(`输出目录不可用，将回退到: ${fallback}`)
    config.outputDirectory = fallback
    await fs.mkdir(fallback, { recursive: true })
  }
  // 构建浏览器启动参数
  const launchOptions = {
    headless: 'new',          // 使用 new Cloudflare 对旧 headless 标记更敏感 
    timeout: 300 * 1000,
    protocolTimeout: 300 * 1000,  // 协议超时时间
    slowMo: 100,              // 减慢操作速度，提高稳定性
    args: [
      '--disable-dev-shm-usage',    // 解决共享内存问题
      '--disable-gpu',              // 禁用GPU加速
      '--no-first-run',             // 跳过首次运行设置
      '--disable-default-apps',     // 禁用默认应用
      '--disable-extensions',       // 禁用扩展
      '--disable-background-timer-throttling',  // 禁用后台定时器限制
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection'
    ]
  }

  // 根据配置添加反检测参数
  if (config.antiDetection?.enableAdvancedArgs !== false) {
    launchOptions.args.push(
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${config.antiDetection?.windowSize || '1366,768'}`,
      '--disable-features=IsolateOrigins,site-per-process', // 禁用 DNS 预取
      '--disable-blink-features=AutomationControlled',      // 隐藏自动化控制标识
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    )
    logger.info('已启用高级反检测浏览器参数')
  }

  // 设置自定义 User Agent
  if (config.antiDetection?.userAgent) {
    launchOptions.args.push(`--user-agent=${config.antiDetection.userAgent}`)
    logger.info(`已设置自定义 User Agent: ${config.antiDetection.userAgent}`)
  }

  let browser
  let connectionMonitor
  
  try {
    browser = await puppeteer.launch(launchOptions)
    logger.info('浏览器已启动。')
    
    // 监听浏览器断开连接事件
    browser.on('disconnected', () => {
      logger.warn('浏览器连接已断开')
      if (connectionMonitor) {
        clearInterval(connectionMonitor)
      }
    })
    
    // 设置浏览器进程错误处理
    browser.process()?.on('error', (error) => {
      logger.error(`浏览器进程错误: ${error.message}`)
    })
    
    // 启用连接监控
    if (config.stability?.enableErrorRecovery !== false) {
      connectionMonitor = setInterval(() => {
        if (!browser.isConnected()) {
          logger.error('检测到浏览器连接断开，程序将退出')
          process.exit(1)
        }
      }, config.stability?.connectionCheckInterval || 30000)
      
      logger.info('已启用浏览器连接监控')
    }
    
  } catch (error) {
    logger.error(`浏览器启动失败: ${error.message}`)
    throw error
  }

  const startTime = Date.now()
  
  // 根据配置决定是否启动进度模式
  const logConfig = logger.getConfig();
  if (logConfig.showDownloadProgress) {
    logger.info('启动进度显示模式', 'system');
    logger.startProgress();
  } else {
    logger.info('进度显示已禁用，使用普通日志模式', 'system');
  }

  try {
    if (config.scrapeMode === 'local_html') {
      // 本地HTML爬虫模式
      logger.header('\n=================== 启动本地HTML爬虫模式 ===================')
      await processLocalHtmlMode(browser, config, downloadManager)
      logger.header('=================== 本地HTML爬虫模式完成 ===================')
    } else {
      // 网络爬虫模式
      const urlsToScrape = config.scrapeMode === 'single_page' ? [config.targetUrl] : config.targetUrls

      for (const url of urlsToScrape) {
        if (!url) continue
        logger.header(`\n------------------- 开始抓取: ${url} -------------------`)
        await scrapeUrl(url, browser, config, loadAndScrollPage, extractImageUrls, processUrlsByImageMode)
        logger.header(`------------------- 抓取完成: ${url} -------------------\n`)
      }
    }
  } catch (error) {
    logger.error(`发生了一个严重错误: ${error.message}`)
  } finally {
    // 根据配置决定是否停止进度模式
    const logConfig = logger.getConfig();
    if (logConfig.showDownloadProgress) {
      logger.stopProgress();
    }
    // 清理连接监控器
    if (connectionMonitor) {
      clearInterval(connectionMonitor)
      logger.info('连接监控器已清理')
    }
    
    if (browser) {
      try {
        await browser.close()
        logger.info('浏览器已关闭。')
      } catch (closeError) {
        logger.error(`关闭浏览器时发生错误: ${closeError.message}`)
      }
    }
    const duration = (Date.now() - startTime) / 1000
    logger.header(`总执行时间: ${duration.toFixed(2)} 秒。`)
  }
}

// ===================================================================================
// 启动爬虫
// ===================================================================================
runImageScraper(scraperConfig)