import { logger } from '../utils/logger.js'
import { convertThumbnailToOriginalUrl } from '../utils/imageUrlConverter.js'

/**
 * @description 根据下载模式处理 URL，例如从缩略图生成原图 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string[]} images - 提取到的图像 URL 列表。
 * @param {string} pageUrl - 当前页面 URL。
 * @param {string} imageMode - 下载模式: 'all' | 'originals_only'。
 * @returns {Promise<string[]>} 处理后的图像 URL 列表。
 */
export async function processUrlsByImageMode(page, images, pageUrl, imageMode) {
  if (imageMode === 'all') {
    return images
  }
  if (imageMode !== 'originals_only') {
    return []
  }

  logger.info('正在从缩略图生成原始图片 URL...')

  const containsRestrictedWords = (str) => {
    const restrictedWords = [
      'theasianpics',
      'asiansexphotos',
      'asianmatureporn',
      'asianamateurgirls',
      'hotasianamateurs',
      'amateurchinesepics',
      'asiannudistpictures',
      'filipinahotties',
      'chinesesexphotos',
      'japaneseteenpics',
      'hotnudefilipinas',
      'asianteenpictures',
      'asianteenphotos',
      'chineseteenpics',
      'cuteasians',
      'amateurasianpictures',
      'chinesexxxpics',
      'sexyasians',
      'allasiansphotos',
      'chinese-girlfriends',
      'chinesegirlspictures',
      'chinese-sex.xyz',
      'asian-cuties-online',
      'japaneseamateurpics',
      'asiangalleries',
      'filipinapornpictures',
      'japanesenudities',
      'koreanpornpics',
      'filipinanudes',
      'chinesepornpics',
      'asianamatures',
      'nudehotasians',
      'asianpornpictures',
      'orientgirlspictures',
    ]
    return restrictedWords.some((word) => str.includes(word))
  }

  let originalImageUrls = []

  // 特定网站的原图链接提取逻辑
  if (pageUrl.includes('www.eroticbeauties.net')) {
    originalImageUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('span.jpg[data-src]')).map((span) => span.getAttribute('data-src'))
    )
  } else if (pageUrl.includes('www.alsasianporn.com')) {
    originalImageUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[data-fancybox="gallery"]')).map((a) => a.getAttribute('href'))
    )
  } else if (pageUrl.includes('www.japanesesexpic.me') || pageUrl.includes('www.asianpussypic.me')) {
    originalImageUrls = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[target="_blank"]')).map((a) => a.getAttribute('href'))
    )
  } else if (pageUrl.includes('chpic.su')) {
    const transparentUrls = images.map((url) => convertThumbnailToOriginalUrl(url, 'transparent')).filter(Boolean)
    const whiteUrls = images.map((url) => convertThumbnailToOriginalUrl(url, 'white')).filter(Boolean)
    originalImageUrls = [...transparentUrls, ...whiteUrls]
  } else if (containsRestrictedWords(pageUrl)) {
    originalImageUrls = await page.evaluate((baseUrl) => {
      return Array.from(document.querySelectorAll('img[src*="tn_"]'))
        .map((img) => baseUrl + img.getAttribute('src').replace('tn_', ''))
        .filter(Boolean)
    }, pageUrl.split('?')[0])
  } else {
    // 通用规则
    originalImageUrls = images.map((url) => convertThumbnailToOriginalUrl(url)).filter(Boolean)
  }

  const uniqueUrls = Array.from(new Set(originalImageUrls.filter(Boolean)))
  if (uniqueUrls.length === 0) {
    logger.warn('根据缩略图未找到任何原始图片。将回退到所有图片。')
    return images
  }
  logger.debug(`已生成 ${uniqueUrls.length} 个原始图片 URL。`)
  return uniqueUrls
}


