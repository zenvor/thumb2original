import { logger } from '../utils/logger.js'
import { setupPageAntiDetection, randomDelay, simulateHumanBehavior, detectAntiBot } from '../utils/antiDetection.js'

/**
 * @description 带重试机制的页面导航
 * @param {object} page - Puppeteer 页面实例
 * @param {string} url - 目标 URL
 * @param {object} config - 配置对象
 * @returns {Promise<void>}
 */
async function retryPageNavigation(page, url, config) {
  const maxRetries = config.stability?.maxPageRetries || 3
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      if (page.isClosed()) {
        throw new Error('页面已关闭，无法继续操作')
      }

      if (config.antiDetection) {
        await setupPageAntiDetection(page, config.antiDetection)
      }

      logger.info(`正在导航到: ${url}${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ''}`)
      
      await randomDelay(1000, 2000)
      
      await page.goto(url, {
        waitUntil: 'networkidle0',
        timeout: 60 * 1000,
      })

      await randomDelay(2000, 2000)

      const isBlocked = await detectAntiBot(page)
      if (isBlocked) {
        logger.warn('页面可能被反爬虫系统拦截，请检查页面内容')
      }

      const title = await page.title()
      logger.info(`页面标题: "${title}"`)
      
      await simulateHumanBehavior(page)
      return // 成功则退出

    } catch (error) {
      retryCount++
      logger.error(`页面加载失败 (${retryCount}/${maxRetries}): ${error.message}`)

      if (retryCount >= maxRetries) {
        throw new Error(`页面加载失败，已重试 ${maxRetries} 次: ${error.message}`)
      }

      const retryDelay = config.stability?.retryDelay || 2000
      await randomDelay(retryDelay, retryDelay * 2)
    }
  }
}

/**
 * @description 滚动页面到底部以触发懒加载
 * @param {object} page - Puppeteer 页面实例
 * @returns {Promise<void>}
 */
async function scrollToBottomWithLazyLoad(page) {
  logger.info('向下滚动以加载所有图片...')

  try {
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        let totalHeight = 0
        const distance = 500
        let scrollAttempts = 0
        const maxScrollAttempts = 100

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance
          scrollAttempts++

          if (totalHeight >= scrollHeight || scrollAttempts >= maxScrollAttempts) {
            clearInterval(timer)
            resolve()
          }
        }, 800)
      })
    })

    await randomDelay(2000, 2000)
    await simulateHumanBehavior(page)
    logger.debug('滚动完成。')

  } catch (error) {
    logger.error(`滚动过程中发生错误: ${error.message}`)
  }
}

/**
 * @description 安全获取页面标题
 * @param {object} page - Puppeteer 页面实例
 * @returns {Promise<string>} 页面标题
 */
async function getPageTitleSafely(page) {
  try {
    return await page.title()
  } catch (error) {
    logger.error(`获取页面标题失败: ${error.message}`)
    return 'Unknown Title'
  }
}

/**
 * @description 加载页面并滚动到底部以触发懒加载（带重试与反检测）
 * @param {object} page - Puppeteer 页面实例
 * @param {string} url - 要加载的页面 URL
 * @param {object} config - 配置对象，包含反检测与稳定性设置
 * @returns {Promise<string>} 页面标题
 */
export async function loadAndScrollPage(page, url, config = {}) {
  await retryPageNavigation(page, url, config)
  await scrollToBottomWithLazyLoad(page)
  return await getPageTitleSafely(page)
}


