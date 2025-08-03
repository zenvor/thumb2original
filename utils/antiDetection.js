/**
 * @description 反检测工具函数
 * 提供各种反检测和隐身功能
 */

import { logger } from './logger.js'

/**
 * @description 为页面设置随机化的浏览器指纹
 * @param {object} page - Puppeteer 页面实例
 * @param {object} config - 反检测配置
 */
export async function setupPageAntiDetection(page, config = {}) {
  try {
    // 隐藏 webdriver 属性
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      })
    })

    // 模拟真实的浏览器环境
    await page.evaluateOnNewDocument(() => {
      // 覆盖 plugins 属性
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      })

      // 覆盖 languages 属性
      Object.defineProperty(navigator, 'languages', {
        get: () => ['zh-CN', 'zh', 'en'],
      })

      // 覆盖 permissions 查询
      const originalQuery = window.navigator.permissions.query
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      )
    })

    // 设置随机的视口大小（如果启用）
    if (config.randomizeFingerprint) {
      const viewports = [
        { width: 1366, height: 768 },
        { width: 1920, height: 1080 },
        { width: 1440, height: 900 },
        { width: 1280, height: 720 }
      ]
      const randomViewport = viewports[Math.floor(Math.random() * viewports.length)]
      await page.setViewport(randomViewport)
      logger.info(`已设置随机视口大小: ${randomViewport.width}x${randomViewport.height}`)
    }

    // 设置随机的用户代理（如果启用且未手动指定）
    if (config.randomizeFingerprint && !config.userAgent) {
      const userAgents = [
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      ]
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)]
      await page.setUserAgent(randomUA)
      logger.info(`已设置随机 User Agent: ${randomUA.substring(0, 50)}...`)
    }

    logger.info('页面反检测设置完成')
  } catch (error) {
    logger.error(`设置页面反检测失败: ${error.message}`)
  }
}

/**
 * @description 添加随机延迟，模拟人类行为
 * @param {number} minMs - 最小延迟毫秒数
 * @param {number} maxMs - 最大延迟毫秒数
 */
export async function randomDelay(minMs = 1000, maxMs = 3000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  await new Promise(resolve => setTimeout(resolve, delay))
}

/**
 * @description 模拟人类鼠标移动
 * @param {object} page - Puppeteer 页面实例
 */
export async function simulateHumanBehavior(page) {
  try {
    // 随机移动鼠标
    const viewport = page.viewport()
    const x = Math.floor(Math.random() * viewport.width)
    const y = Math.floor(Math.random() * viewport.height)
    
    await page.mouse.move(x, y, { steps: 10 })
    await randomDelay(500, 1500)
    
    logger.debug(`模拟鼠标移动到: (${x}, ${y})`)
  } catch (error) {
    logger.error(`模拟人类行为失败: ${error.message}`)
  }
}

/**
 * @description 检测页面是否被反爬虫系统拦截
 * @param {object} page - Puppeteer 页面实例
 * @returns {Promise<boolean>} 是否被拦截
 */
export async function detectAntiBot(page) {
  try {
    const title = await page.title()
    const content = await page.content()
    
    // 检测常见的反爬虫页面特征
    const antiPatterns = [
      /cloudflare/i,
      /challenge/i,
      /captcha/i,
      /bot.*detected/i,
      /access.*denied/i,
      /请稍候/i,
      /验证中/i
    ]
    
    const isBlocked = antiPatterns.some(pattern => 
      pattern.test(title) || pattern.test(content)
    )
    
    if (isBlocked) {
      logger.warn('检测到可能的反爬虫拦截页面')
    }
    
    return isBlocked
  } catch (error) {
    logger.error(`检测反爬虫系统失败: ${error.message}`)
    return false
  }
}