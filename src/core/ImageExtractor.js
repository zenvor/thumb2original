import { validateAndModifyFileName } from '../utils/file/validateAndModifyFileName.js'
import path from 'path'
import fs from 'fs'

/**
 * 图片提取器
 * 负责页面加载、滚动、图片查找（保留原有逻辑）
 */
export class ImageExtractor {
  constructor(config, logger) {
    this.config = config
    this.logger = logger
    this.browser = null
    this.title = ''
    this.currentUrl = ''
    this.targetDownloadFolderPath = ''
    // 用于控制下载行为设置日志的显示
    this._downloadBehaviorLogged = false
  }

  /**
   * 设置浏览器实例
   * @param {Object} browser Puppeteer浏览器实例
   */
  setBrowser(browser) {
    this.browser = browser
  }

  /**
   * 创建并配置新的浏览器页面
   * @param {Object} options - 页面配置选项
   * @param {boolean} options.setReferer - 是否设置空的 Referer 头
   * @returns {Promise<Page>} 配置好的页面实例
   */
  async createPage(options = {}) {
    const { setReferer = false } = options

    try {
      // 创建新页面
      const page = await this.browser.newPage()

      // 设置标准视口大小
      await page.setViewport(this.config.browser?.viewport || { width: 1920, height: 1080 })

      // 根据需要设置请求头
      if (setReferer) {
        await page.setExtraHTTPHeaders({
          Referer: '',
        })
      }

      // 🛡️ 三层防护体系第二层：页面级防下载设置
      try {
        // 使用Chrome DevTools Protocol正确设置页面下载行为
        const client = await page.target().createCDPSession()
        await client.send('Page.setDownloadBehavior', {
          behavior: 'deny',
        })
        // 只在第一次设置时显示信息，避免重复日志
        if (!this._downloadBehaviorLogged) {
          this.logger.info('🛡️ 页面下载行为已设置为拒绝（后续页面创建将静默设置）')
          this._downloadBehaviorLogged = true
        }
      } catch (error) {
        // 如果设置失败，记录debug信息但不影响程序继续执行
        this.logger.debug('设置页面下载行为失败（可能浏览器版本不支持）:', error.message)
      }

      // 🔥 关键修复：启用请求拦截以阻止直接下载
      await page.setRequestInterception(true)
      page.on('request', (request) => {
        const url = request.url()
        const resourceType = request.resourceType()

        // 允许图片请求，但阻止可能触发下载的请求
        if (resourceType === 'image') {
          // 检查是否是直接触发下载的图片请求
          const headers = request.headers()
          if (headers['content-disposition'] && headers['content-disposition'].includes('attachment')) {
            this.logger.debug('阻止下载触发的图片请求:', url)
            request.abort()
            return
          }
          // 正常的图片请求继续
          request.continue()
        } else if (resourceType === 'document' && url.match(/\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i)) {
          // 阻止作为文档加载的图片（这通常会触发下载）
          this.logger.debug('阻止作为文档的图片请求:', url)
          request.abort()
        } else {
          // 其他请求正常继续
          request.continue()
        }
      })

      // 🛡️ 三层防护体系第三层：文档级防下载脚本
      await page.evaluateOnNewDocument(() => {
        // 阻止默认的下载行为，但不影响图片加载
        Object.defineProperty(HTMLAnchorElement.prototype, 'download', {
          get() {
            return ''
          },
          set() {
            return false
          },
        })

        // 阻止location.href的下载触发
        const originalHref = Object.getOwnPropertyDescriptor(Location.prototype, 'href')
        Object.defineProperty(Location.prototype, 'href', {
          get: originalHref.get,
          set: function (value) {
            // 检查是否是下载链接
            if (
              typeof value === 'string' &&
              (value.startsWith('blob:') ||
                value.includes('download=') ||
                value.match(/\.(zip|rar|exe|msi|dmg|pkg|tar|gz|7z|pdf|doc|docx|xls|xlsx)$/i))
            ) {
              console.warn('阻止下载链接:', value)
              return false
            }
            return originalHref.set.call(this, value)
          },
          configurable: true,
        })

        // 阻止文件下载确认对话框
        window
          .addEventListener('beforeunload', (e) => {
            e.preventDefault()
            e.returnValue = ''
          })

          [
            // 阻止下载相关事件
            ('click', 'contextmenu')
          ].forEach((eventType) => {
            document.addEventListener(
              eventType,
              (e) => {
                const target = e.target
                if (target && target.tagName === 'A') {
                  const href = target.getAttribute('href')
                  const download = target.getAttribute('download')

                  // 如果是下载链接，阻止默认行为
                  if (
                    download !== null ||
                    (href &&
                      (href.startsWith('blob:') ||
                        href.includes('download=') ||
                        href.match(/\.(zip|rar|exe|msi|dmg|pkg|tar|gz|7z|pdf|doc|docx|xls|xlsx)$/i)))
                  ) {
                    e.preventDefault()
                    e.stopPropagation()
                    console.warn('阻止下载链接点击:', href)
                    return false
                  }
                }
              },
              true
            )
          })
      })

      return page
    } catch (error) {
      this.logger.debug('创建页面失败', error) // 改为debug级别，避免与Crawler层重复记录
      throw error
    }
  }

  /**
   * 设置目标下载路径
   * 统一管理下载文件夹路径的设置逻辑
   * @returns {string} 设置后的目标下载路径
   */
  setTargetDownloadPath() {
    try {
      const downloadFolderPath = this.config.downloadFolderPath
      const rootDownloadDir = 'download'

      // 确保根下载目录 'download' 存在
      if (!fs.existsSync(rootDownloadDir)) {
        fs.mkdirSync(rootDownloadDir)
        this.logger.info(`根下载目录 '${rootDownloadDir}' 已创建`)
      }

      if (downloadFolderPath) {
        // 使用用户指定的下载路径
        this.targetDownloadFolderPath = downloadFolderPath
      } else {
        // 根据网页标题生成默认下载路径
        const sanitizedTitle = validateAndModifyFileName(this.title || 'untitled')
        // 使用 path.join 安全地构建路径
        this.targetDownloadFolderPath = path.join(rootDownloadDir, sanitizedTitle)
      }

      this.logger.debug(`设置下载路径: ${this.targetDownloadFolderPath}`)
      return this.targetDownloadFolderPath
    } catch (error) {
      this.logger.error('设置下载路径失败', error)
      // 使用默认路径作为 fallback
      this.targetDownloadFolderPath = path.join('download', 'default')
      return this.targetDownloadFolderPath
    }
  }

  /**
   * 加载页面
   * @param {object} page Puppeteer页面对象
   * @param {string} url 要加载的URL
   * @returns {Promise<void>}
   */
  async loadPage(page, url) {
    this.currentUrl = url

    try {
      // 设置访问图像的超时时间
      const timeoutMilliseconds = this.config.timeouts?.pageLoad || 30000

      // 导航到您想要获取HTML的网址
      await page.goto(this.currentUrl, {
        // FIXME: 测试阶段，先使用 load，后续再使用domcontentloaded
        // waitUntil: 'networkidle0',
        waitUntil: 'load',
        timeout: timeoutMilliseconds,
      })

      // 获取页面标题
      this.title = await page.title()
      this.logger.info(`网页标题: ${this.title}`)
    } catch (error) {
      this.logger.debug('页面加载失败', error) // 改为debug级别，避免与Crawler层重复记录
      throw error
    }

    // 等待2秒
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  /**
   * 向下滚动页面，支持无限滚动加载 (优化版)
   * @param {object} page Puppeteer页面对象
   * @returns {Promise<void>}
   */
  async scrollPage(page) {
    // 提取滚动配置，并提供合理的默认值
    const {
      stepSize = 100, // 每次滚动的步长（像素）
      interval = 100, // 尝试滚动的间隔（毫秒）
      stopTimeout = 2000, // 滚动停止后，等待新内容加载的超时时间（毫秒）
      maxDistance = Infinity, // 允许滚动的最大距离
    } = this.config.scroll || {}

    await page.evaluate(
      async (options) => {
        await new Promise((resolve) => {
          // 记录最后一次有效滚动的时间戳
          let lastScrollTime = Date.now()

          // 监听'scroll'事件。这是处理"无限滚动"的关键。
          // 只要页面因新内容加载而继续滚动，此时间戳就会被更新。
          window.addEventListener(
            'scroll',
            () => {
              lastScrollTime = Date.now()
            },
            { passive: true }
          ) // 使用 passive 监听器提升滚动性能

          const timer = setInterval(() => {
            // --- 停止条件检查 ---

            // 条件1: 滚动距离已达到设定的最大值
            if (window.scrollY >= options.maxDistance) {
              clearInterval(timer)
              resolve()
              return
            }

            // 条件2: 距离上次有效滚动已经过去太久
            // 当滚动到底部时，'scroll'事件不再触发，lastScrollTime会停止更新。
            // 如果在`stopTimeout`这么长的时间内它都没更新，我们就认为没有新内容加载了，可以结束。
            if (Date.now() - lastScrollTime > options.stopTimeout) {
              clearInterval(timer)
              resolve()
              return
            }

            // --- 执行滚动 ---
            // 持续尝试向下滚动，以触发新内容的加载
            window.scrollBy(0, options.stepSize)
          }, options.interval)
        })
      },
      { stepSize, interval, stopTimeout, maxDistance }
    ) // 将配置项传入页面
  }
  /**
   * 查找页面中的图像
   * @param {object} page Puppeteer页面对象
   * @returns {Promise<Array>} 图像URL数组
   */
  async findImages(page) {
    // 设置下载文件夹路径
    this.setTargetDownloadPath()

    // 使用标准 URL 构造函数提取 origin
    const origin = new URL(this.currentUrl).origin

    // 🔧 优化后的图片提取逻辑
    let images = await page.evaluate((origin, currentUrl) => {
      // 图片文件扩展名正则表达式
      const IMAGE_EXTENSIONS_REGEX = /(https?:\/\/).*\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i
      
      // 特殊网站配置
      const SPECIAL_SITES = {
        'asiantgp.net': {
          prefix: 'http://asiantgp.net/gallery/Japanese_cute_young_wife_Haruka'
        }
      }

      /**
       * 检查是否为图像URL
       * @param {string} url 
       * @returns {boolean}
       */
      function isImageUrl(url) {
        return IMAGE_EXTENSIONS_REGEX.test(url)
      }

      /**
       * 处理图像URL，确保URL格式正确
       * @param {string} url 原始URL
       * @param {string} origin 页面origin
       * @param {string} currentUrl 当前页面URL
       * @returns {string} 处理后的URL
       */
      function handleImageUrl(url, origin, currentUrl) {
        if (!url) return ''

        // 处理特殊网站
        if (origin.includes('asiantgp.net')) {
          return `${SPECIAL_SITES['asiantgp.net'].prefix}/${url}`
        }
        
        // 处理相对路径
        if (!url.startsWith('http')) {
          // 如果是以 / 开头的绝对路径
          if (url.startsWith('/')) {
            return `${origin}${url}`
          }
          // 相对路径，使用当前页面URL构建
          try {
            return new URL(url, currentUrl).href
          } catch (error) {
            // 如果URL构建失败，使用简单拼接
            return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
          }
        }
        
        return url
      }

      /**
       * 从元素中提取图像URL
       * @param {Element} element DOM元素
       * @returns {string|null} 图像URL或null
       */
      function extractImageUrl(element) {
        let url = null
        
        if (element.tagName === 'A') {
          url = element.getAttribute('href')
          if (!url) return null
          
          url = handleImageUrl(url, origin, currentUrl)
          // 对于链接元素，只有当href指向图像时才返回
          return isImageUrl(url) ? url : null
        } 
        
        if (element.tagName === 'IMG') {
          url = element.getAttribute('src')
          if (!url) return null
          
          return handleImageUrl(url, origin, currentUrl)
        }
        
        return null
      }

      // 🔧 修复：同时选择 a 和 img 元素
      const elements = Array.from(document.querySelectorAll('a[href], img[src]'))
      
      return elements
        .map(extractImageUrl)
        .filter(url => url !== null && url !== '')
    }, origin, this.currentUrl)

    // 使用 Set 去重
    images = Array.from(new Set(images))

    this.logger.debug('提取的图像', images)
    this.logger.info(`🖼️ 提取的图像数量: ${images.length}`)

    return images
  }

  /**
   * 获取原图URL (downloadOriginImagesByThumbnails模式)
   * @param {object} page Puppeteer页面对象
   * @param {Array} thumbnailImages 缩略图URL数组
   * @returns {Promise<Array>} 原图URL数组
   */
  async getOriginalImageUrls(page, thumbnailImages) {
    const currentUrl = this.currentUrl
    let originalImageUrls = []

    if (currentUrl.includes('https://www.eroticbeauties.net')) {
      // 使用 page.evaluate 方法在页面上下文中执行 JavaScript 代码
      originalImageUrls = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll('span.jpg')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

        // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
        const dataSrcValues = spans.map((span) => span.getAttribute('data-src'))

        return dataSrcValues
      })
    } else if (currentUrl.includes('http://www.alsasianporn.com')) {
      originalImageUrls = await page.evaluate(() => {
        const as = Array.from(document.querySelectorAll('a[data-fancybox="gallery"]')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

        // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
        const hrefValues = as.map((span) => span.getAttribute('href'))

        return hrefValues
      })
    } else if (
      currentUrl.includes('https://www.japanesesexpic.me') ||
      currentUrl.includes('http://www.asianpussypic.me')
    ) {
      originalImageUrls = await page.evaluate(() => {
        const as = Array.from(document.querySelectorAll('a[target="_blank"]')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

        // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
        const hrefValues = as.map((span) => span.getAttribute('href'))

        return hrefValues
      })
    } else if (currentUrl.includes('https://chpic.su')) {
      // 处理 chpic.su 的情况 - 使用工具函数生成原图URL
      const { generateOriginalImageUrl } = await import('./image/generateOriginalImageUrl.js')

      originalImageUrls = thumbnailImages
        .map((imageUrl) => generateOriginalImageUrl(imageUrl, 'transparent'))
        .filter((imageUrl) => imageUrl !== '')

      const originalImageUrlsOtherTypes = thumbnailImages
        .map((imageUrl) => generateOriginalImageUrl(imageUrl, 'white'))
        .filter((imageUrl) => imageUrl !== '')

      originalImageUrls.push(...originalImageUrlsOtherTypes)
    } else if (this._containsRestrictedWords(currentUrl)) {
      originalImageUrls = await page.evaluate((currentUrl) => {
        const imgEls = Array.from(document.querySelectorAll('img'))

        const srcValues = imgEls.map((el) => {
          const srcValue = el.getAttribute('src')
          if (!srcValue.includes('tn_')) return ''
          return currentUrl.split('?')[0] + srcValue.replace('tn_', '')
        })

        return srcValues
      }, currentUrl)
    } else {
      // 默认情况：使用工具函数生成原图URL
      const { generateOriginalImageUrl } = await import('./image/generateOriginalImageUrl.js')

      originalImageUrls = thumbnailImages
        .map((imageUrl) => generateOriginalImageUrl(imageUrl))
        .filter((imageUrl) => imageUrl !== '')
    }

    originalImageUrls = originalImageUrls.filter((imageUrl) => imageUrl !== '')

    this.logger.debug('originalImageUrls: ', originalImageUrls)
    this.logger.info(`原图 URL 数量: ${originalImageUrls.length}`)

    return originalImageUrls
  }

  /**
   * 检查URL是否包含受限关键词
   * @param {string} str URL字符串
   * @returns {boolean} 是否包含受限关键词
   * @private
   */
  _containsRestrictedWords(str) {
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

  /**
   * 获取页面标题
   * @returns {string} 页面标题
   */
  getTitle() {
    return this.title
  }

  /**
   * 获取当前URL
   * @returns {string} 当前URL
   */
  getCurrentUrl() {
    return this.currentUrl
  }

  /**
   * 获取目标下载路径
   * @returns {string} 目标下载路径
   */
  getTargetDownloadPath() {
    return this.targetDownloadFolderPath
  }
}
