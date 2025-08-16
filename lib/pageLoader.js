import { logger } from '../utils/logger.js'
import { setupPageAntiDetection, randomDelay, simulateHumanBehavior, detectAntiBot } from '../utils/antiDetection.js'

/**
 * @description 加载页面并滚动到底部以触发懒加载（带重试与反检测）。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} url - 要加载的页面 URL。
 * @param {object} config - 配置对象，包含反检测与稳定性设置。
 * @returns {Promise<string>} 页面标题。
 */
export async function loadAndScrollPage(page, url, config = {}) {
  const maxRetries = config.stability?.maxPageRetries || 3
  let retryCount = 0

  while (retryCount < maxRetries) {
    try {
      // 检查页面是否已关闭
      if (page.isClosed()) {
        throw new Error('页面已关闭，无法继续操作')
      }

      // 设置页面反检测功能
      if (config.antiDetection) {
        await setupPageAntiDetection(page, config.antiDetection)
      }

      logger.info(`正在导航到: ${url}${retryCount > 0 ? ` (重试 ${retryCount}/${maxRetries})` : ''}`)

      // 添加随机延迟，模拟人类行为
      await randomDelay(1000, 2000)

      // 使用更稳定的页面导航选项
      await page.goto(url, {
        // // 导航到您想要获取HTML的网址 ['load', 'domcontentloaded', 'networkidle0', 'networkidle2']
        waitUntil: 'networkidle0',
        timeout: 60 * 1000,
      })

      // 等待页面稳定
      await randomDelay(2000, 2000)

      // 检测是否被反爬虫系统拦截
      const isBlocked = await detectAntiBot(page)
      if (isBlocked) {
        logger.warn('页面可能被反爬虫系统拦截，请检查页面内容')
      }

      const title = await page.title()
      logger.info(`页面标题: "${title}"`)

      // 模拟人类行为
      await simulateHumanBehavior(page)

      // 如果成功到达这里，跳出重试循环
      break
    } catch (error) {
      retryCount++
      logger.error(`页面加载失败 (${retryCount}/${maxRetries}): ${error.message}`)

      if (retryCount >= maxRetries) {
        throw new Error(`页面加载失败，已重试 ${maxRetries} 次: ${error.message}`)
      }

      // 等待一段时间后重试
      await randomDelay(config.stability?.retryDelay || 2000, (config.stability?.retryDelay || 2000) * 2)
    }
  }

  logger.info('向下滚动以加载所有图片...')

  try {
    // 使用更稳定的滚动方式
    await page.evaluate(async () => {
      return new Promise((resolve) => {
        let totalHeight = 0
        const distance = 500 // 减少滚动距离
        let scrollAttempts = 0
        const maxScrollAttempts = 100 // 限制最大滚动次数

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight
          window.scrollBy(0, distance)
          totalHeight += distance
          scrollAttempts++

          // 检查是否到达底部或超过最大尝试次数
          if (totalHeight >= scrollHeight || scrollAttempts >= maxScrollAttempts) {
            clearInterval(timer)
            resolve()
          }
        }, 800) // 增加滚动间隔
      })
    })

    // 等待页面稳定
    await randomDelay(2000, 2000)

    // 滚动完成后再次模拟人类行为
    await simulateHumanBehavior(page)

    logger.debug('滚动完成。')
  } catch (error) {
    logger.error(`滚动过程中发生错误: ${error.message}`)
    // 即使滚动失败，也尝试获取页面标题
  }

  // 获取最终的页面标题
  let finalTitle
  try {
    finalTitle = await page.title()
  } catch (error) {
    logger.error(`获取页面标题失败: ${error.message}`)
    finalTitle = 'Unknown Title'
  }

  return finalTitle
}


