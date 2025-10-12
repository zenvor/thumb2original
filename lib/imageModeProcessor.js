import { logger } from '../utils/logger.js'
import { convertThumbnailToOriginalUrl } from '../utils/imageUrlConverter.js'
import { scraperConfig } from '../config/config.js'

// 限制词配置 - 外置配置提升可维护性
const RESTRICTED_DOMAINS = [
  'theasianpics', 'asiansexphotos', 'asianmatureporn', 'asianamateurgirls',
  'hotasianamateurs', 'amateurchinesepics', 'asiannudistpictures', 'filipinahotties',
  'chinesesexphotos', 'japaneseteenpics', 'hotnudefilipinas', 'asianteenpictures',
  'asianteenphotos', 'chineseteenpics', 'cuteasians', 'amateurasianpictures',
  'chinesexxxpics', 'sexyasians', 'allasiansphotos', 'chinese-girlfriends',
  'chinesegirlspictures', 'chinese-sex.xyz', 'asian-cuties-online', 'japaneseamateurpics',
  'asiangalleries', 'filipinapornpictures', 'japanesenudities', 'koreanpornpics',
  'filipinanudes', 'chinesepornpics', 'asianamatures', 'nudehotasians',
  'asianpornpictures', 'orientgirlspictures'
]

/**
 * 检查 URL 是否包含限制域名
 */
function hasRestrictedDomain(url) {
  return RESTRICTED_DOMAINS.some(domain => url.includes(domain))
}

/**
 * 处理 EroticBeauties 站点的原图提取
 */
async function extractEroticBeautiesImages(page) {
  return page.evaluate(() => 
    Array.from(document.querySelectorAll('span.jpg[data-src]'))
      .map(span => span.getAttribute('data-src'))
  )
}

/**
 * 处理 AlsAsianPorn 站点的原图提取
 */
async function extractAlsAsianPornImages(page) {
  return page.evaluate(() => 
    Array.from(document.querySelectorAll('a[data-fancybox="gallery"]'))
      .map(a => a.getAttribute('href'))
  )
}

/**
 * 处理 JapaneseSexPic/AsianPussyPic 站点的原图提取
 */
async function extractJapaneseAsianImages(page) {
  return page.evaluate(() => 
    Array.from(document.querySelectorAll('a[target="_blank"]'))
      .map(a => a.getAttribute('href'))
  )
}

/**
 * 处理 chpic.su 站点的原图提取
 */
function extractChpicImages(images) {
  const transparentUrls = images
    .map(url => convertThumbnailToOriginalUrl(url, 'transparent'))
    .filter(Boolean)
  const whiteUrls = images
    .map(url => convertThumbnailToOriginalUrl(url, 'white'))
    .filter(Boolean)
  return [...transparentUrls, ...whiteUrls]
}

/**
 * 处理限制域名站点的原图提取
 */
async function extractRestrictedDomainImages(page, pageUrl) {
  const baseUrl = pageUrl.split('?')[0]
  return page.evaluate((baseUrl) => {
    return Array.from(document.querySelectorAll('img[src*="tn_"]'))
      .map((img) => {
        const rawSrc = img.getAttribute('src')
        if (!rawSrc) return null
        try {
          const resolved = new URL(rawSrc, baseUrl)
          resolved.pathname = resolved.pathname.replace('tn_', '')
          return resolved.href
        } catch {
          return null
        }
      })
      .filter(Boolean)
  }, baseUrl)
}

/**
 * @description 根据下载模式处理 URL，例如从缩略图生成原图 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string[]} images - 提取到的图像 URL 列表。
 * @param {string} pageUrl - 当前页面 URL。
 * @param {string} imageMode - 下载模式: 'all' | 'originals_only'。
 * @param {object} [runtimeConfig] - 运行时配置（用于读取 debug 配置）
 * @returns {Promise<string[]>} 处理后的图像 URL 列表。
 */
export async function processUrlsByImageMode(page, images, pageUrl, imageMode, runtimeConfig = undefined) {
  if (imageMode === 'all') {
    return images
  }
  if (imageMode !== 'originals_only') {
    return []
  }

  logger.info('正在从缩略图生成原始图片 URL...')

  const originalUrls = await extractOriginalImageUrls(page, images, pageUrl)
  return finalizeImageUrls(originalUrls, images, runtimeConfig)
}

/**
 * 根据站点策略提取原图 URL
 */
async function extractOriginalImageUrls(page, images, pageUrl) {
  // EroticBeauties 站点
  if (pageUrl.includes('www.eroticbeauties.net')) {
    return extractEroticBeautiesImages(page)
  }
  
  // AlsAsianPorn 站点  
  if (pageUrl.includes('www.alsasianporn.com')) {
    return extractAlsAsianPornImages(page)
  }
  
  // JapaneseSexPic/AsianPussyPic 站点
  if (pageUrl.includes('www.japanesesexpic.me') || pageUrl.includes('www.asianpussypic.me')) {
    return extractJapaneseAsianImages(page)
  }
  
  // Chpic 站点
  if (pageUrl.includes('chpic.su')) {
    return extractChpicImages(images)
  }
  
  // 限制域名站点
  if (hasRestrictedDomain(pageUrl)) {
    return extractRestrictedDomainImages(page, pageUrl)
  }
  
  // 通用规则
  return images
    .map(url => convertThumbnailToOriginalUrl(url))
    .filter(Boolean)
}

/**
 * 处理最终的图片 URL 列表
 */
function finalizeImageUrls(originalUrls, fallbackUrls, runtimeConfig) {
  const uniqueUrls = Array.from(new Set(originalUrls.filter(Boolean)))
  
  if (uniqueUrls.length === 0) {
    logger.warn('根据缩略图未找到任何原始图片。将回退到所有图片。')
    return fallbackUrls
  }
  
  logger.debug(`已生成 ${uniqueUrls.length} 个原始图片 URL。`)
  
  // 根据配置决定是否打印所有原图链接
  const debugConfig = runtimeConfig?.debug || scraperConfig.debug || {}
  if (debugConfig.logImageUrls) {
    try {
      const header = `原始图片链接（共 ${uniqueUrls.length} 个）：`
      const body = uniqueUrls.map(u => ` - ${u}`).join('\n')
      logger.info(`${header}\n${body}`)
    } catch {}
  }
  return uniqueUrls
}
