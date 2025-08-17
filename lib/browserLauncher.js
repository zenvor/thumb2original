import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
import { logger } from '../utils/logger.js'

/**
 * @description 构建浏览器启动参数（根据配置启用反检测与稳定性设置）。
 * @param {object} config 用户配置
 * @returns {object} Puppeteer 启动参数
 */
function buildLaunchOptions(config) {
  const launchOptions = {
    headless: 'new',
    timeout: 300 * 1000,
    protocolTimeout: 300 * 1000,
    slowMo: 100,
    args: [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection'
    ]
  }

  if (config.antiDetection?.enableAdvancedArgs !== false) {
    launchOptions.args.push(
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--window-size=${config.antiDetection?.windowSize || '1366,768'}`,
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    )
    logger.info('已启用高级反检测浏览器参数')
  }

  if (config.antiDetection?.userAgent) {
    launchOptions.args.push(`--user-agent=${config.antiDetection.userAgent}`)
    logger.info(`已设置自定义 User Agent: ${config.antiDetection.userAgent}`)
  }

  return launchOptions
}

/**
 * @description 启动 Puppeteer 浏览器并建立基础稳定性监听。
 * @param {object} config 用户配置
 * @returns {Promise<{browser: import('puppeteer').Browser, stopMonitoring: Function}>}
 */
export async function launchBrowser(config) {
  // 根据配置决定是否使用 stealth 插件
  if (config.antiDetection?.enableStealth !== false) {
    puppeteer.use(StealthPlugin())
    logger.info('已启用 Stealth 插件进行反检测')
  }

  const launchOptions = buildLaunchOptions(config)

  let browser
  let connectionMonitor

  try {
    browser = await puppeteer.launch(launchOptions)
    logger.info('浏览器已启动。')

    browser.on('disconnected', () => {
      logger.warn('浏览器连接已断开')
      if (connectionMonitor) clearInterval(connectionMonitor)
    })

    browser.process()?.on('error', (error) => {
      logger.error(`浏览器进程错误: ${error.message}`)
    })

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

  const stopMonitoring = () => {
    if (connectionMonitor) {
      clearInterval(connectionMonitor)
      logger.info('连接监控器已清理')
    }
  }

  return { browser, stopMonitoring }
}


