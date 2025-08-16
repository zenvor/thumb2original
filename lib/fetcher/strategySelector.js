/**
 * @description 根据站点配置决定获取策略顺序（axios | puppeteer）。
 * @param {object} siteConfig 站点配置（可含 downloadStrategy: 'axios'|'puppeteer'）
 * @returns {('axios'|'puppeteer')[]} 策略顺序
 */
export function decideDownloadOrder(siteConfig = {}) {
  // 中文注释：基于枚举字符串的配置；未设置或非法值时默认 axios 优先
  const strategy = siteConfig.downloadStrategy
  if (strategy === 'puppeteer') return ['puppeteer', 'axios']
  return ['axios', 'puppeteer']
}
