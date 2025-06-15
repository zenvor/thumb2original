/**
 * 图片提取策略基类和具体实现
 * 使用策略模式处理不同网站的原图提取逻辑
 */

/**
 * 图片提取策略基类
 */
class BaseImageExtractionStrategy {
  /**
   * 提取原图URL
   * @param {Object} page Puppeteer页面对象
   * @param {Array} thumbnailImages 缩略图URL数组
   * @param {string} currentUrl 当前页面URL
   * @returns {Promise<Array>} 原图URL数组
   */
  async extract(page, thumbnailImages, currentUrl) {
    throw new Error('子类必须实现extract方法')
  }
}

/**
 * EroticBeauties网站策略
 */
export class EroticBeautiesStrategy extends BaseImageExtractionStrategy {
  async extract(page) {
    return await page.evaluate(() => {
      const spans = Array.from(document.querySelectorAll('span.jpg'))
      return spans
        .map(span => span.getAttribute('data-src'))
        .filter(url => url)
    })
  }
}

/**
 * AlsasianPorn网站策略
 */
export class AlsasianPornStrategy extends BaseImageExtractionStrategy {
  async extract(page) {
    return await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[data-fancybox="gallery"]'))
      return links
        .map(link => link.getAttribute('href'))
        .filter(url => url)
    })
  }
}

/**
 * Target="_blank"链接策略 (适用于多个网站)
 */
export class TargetBlankStrategy extends BaseImageExtractionStrategy {
  async extract(page) {
    return await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[target="_blank"]'))
      return links
        .map(link => link.getAttribute('href'))
        .filter(url => url)
    })
  }
}

/**
 * ChpicSu网站策略
 */
export class ChpicSuStrategy extends BaseImageExtractionStrategy {
  async extract(page, thumbnailImages) {
    const { generateOriginalImageUrl } = await import('./generateOriginalImageUrl.js')
    
    // 处理transparent类型
    const transparentUrls = thumbnailImages
      .map(imageUrl => generateOriginalImageUrl(imageUrl, 'transparent'))
      .filter(url => url)
    
    // 处理white类型
    const whiteUrls = thumbnailImages
      .map(imageUrl => generateOriginalImageUrl(imageUrl, 'white'))
      .filter(url => url)
    
    return [...transparentUrls, ...whiteUrls]
  }
}

/**
 * 受限网站策略
 */
export class RestrictedSiteStrategy extends BaseImageExtractionStrategy {
  async extract(page, thumbnailImages, currentUrl) {
    return await page.evaluate((currentUrl) => {
      const images = Array.from(document.querySelectorAll('img'))
      const baseUrl = currentUrl.split('?')[0]
      
      return images
        .map(img => {
          const srcValue = img.getAttribute('src')
          if (!srcValue || !srcValue.includes('tn_')) return ''
          return baseUrl + srcValue.replace('tn_', '')
        })
        .filter(url => url)
    }, currentUrl)
  }
}

/**
 * 默认图片提取策略
 */
export class DefaultImageStrategy extends BaseImageExtractionStrategy {
  async extract(page, thumbnailImages) {
    const { generateOriginalImageUrl } = await import('./generateOriginalImageUrl.js')
    
    return thumbnailImages
      .map(imageUrl => generateOriginalImageUrl(imageUrl))
      .filter(url => url)
  }
} 