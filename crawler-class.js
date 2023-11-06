import fs from 'fs'
import path from 'path'
import axios from 'axios'
import puppeteer from 'puppeteer'
// 检验并生成一个符合 Windows 文件命名规则的文件名
import { validateAndModifyFileName } from './utils/validate-and-modify-file-name.js'
// 根据缩略图获取原图
import { generateOriginalImageUrl } from './utils/generate-original-image-url.js'
// 解析链接
import { parseLink } from './utils/parse-link.js'

export default class ImageExtractor {
  constructor(config) {
    this.config = config
    this.retryInterval = this.config.retryInterval
    this.retriesCount = this.config.retriesCount
    this.extractMode = this.config.extractMode
    this.downloadMode = this.config.downloadMode
    this.downloadFolderPath = this.config.downloadFolderPath
    this.targetCrawlingWebPageLink = this.config.targetCrawlingWebPageLink
    this.targetCrawlingWebPageLinks = this.config.targetCrawlingWebPageLinks
    this.maxConcurrentRequests = this.config.maxConcurrentRequests
    this.maxIntervalMs = this.config.maxIntervalMs
    this.minIntervalMs = this.config.minIntervalMs
    // 全局浏览器实例
    this.globalBrowser = null
    // 导航浏览器
    this.navigationBrowser = null
    // resolve 函数
    this.globalResolveHandler = null
    // 网页标题
    this.title = ''
    // 当前访问的链接
    this.currentLink = ''
    // 下载的文件夹路径
    this.targetDownloadFolderPath = ''
    // 全部图片
    this.images = []
    // 请求失败的照片集合
    this.requestFailedImages = []
    // 全部照片数
    this.imageCount = 0
    // 触发重试的次数
    this.triggeringRetriesCount = 0
    // 下载成功的照片数量
    this.downloadSuccessfullyCount = 0
    // 下载失败的照片数量
    this.downloadFailedCount = 0
    // 请求成功的照片数量
    this.requestSuccessfullyCount = 0
    // 请求失败的照片数量
    this.requestFailedCount = 0
  }

  async start() {
    // 启动一个全局浏览器实例
    this.globalBrowser = await puppeteer.launch({ headless: false, timeout: 300 * 1000 })
    // 启动一个新的浏览器实例
    this.navigationBrowser = await puppeteer.launch({ headless: false, timeout: 300 * 1000 })

    switch (this.extractMode) {
      case 'singleSite':
        console.log('\x1b[36m%s\x1b[0m', '开始计时')
        console.time('download time')

        await this.extractImages(this.navigationBrowser, this.targetCrawlingWebPageLink)
        // 关闭浏览器
        this.globalBrowser.close()
        this.navigationBrowser.close()
        console.log('this.targetCrawlingWebPageLink: ', this.targetCrawlingWebPageLink)
        break
      case 'multipleSites':
        for (const link of this.targetCrawlingWebPageLinks) {
          if (link) {
            console.log('\x1b[36m%s\x1b[0m', '开始计时')
            console.time('download time')

            await this.extractImages(this.navigationBrowser, link)
            console.log('link: ', link)
          }
        }
        // 关闭浏览器
        this.globalBrowser.close()
        this.navigationBrowser.close()
        break
    }
  }

  /**
   * @description 图片提取
   * @param {string} link
   */
  extractImages(navigationBrowser, link) {
    console.log('link: ', link)
    return new Promise(async (resolve) => {
      this.globalResolveHandler = resolve
      this.currentLink = link
      // 创建一个新的页面
      const page = await navigationBrowser.newPage()
      // 设置视口大小
      await page.setViewport({ width: 1800, height: 1000 })
      // 配置导航超时
      // 设置访问图片的超时时间为 300 秒
      const timeoutMilliseconds = 1000 * 300
      // 导航到您想要获取HTML的网址 ['load', 'domcontentloaded', 'networkidle0', 'networkidle2']
      await page.goto(link, { waitUntil: 'networkidle0', timeout: timeoutMilliseconds })

      // 等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 60000))

      await page.evaluate(async (link) => {
        // 异步滚动函数，接受两个参数：最大已滚动距离和回调函数
        // async function autoScroll(maxScroll, callback) {
        //   return new Promise((resolve, reject) => {
        //     let lastScrollTime = Date.now() // 记录最后一次滚动的时间
        //     // 获取当前页面的高度
        //     let pageHeight = document.documentElement.scrollHeight
        //     // 获取当前已滚动的距离
        //     let currentScroll = window.scrollY
        //     // 设置一个标志，表示是否到达页面底部
        //     let isBottom = false
        //     // 设置一个标志，表示是否停止滚动
        //     let isStop = false
        //     // 设置一个计时器，用于检测滚动停留时间
        //     let timer = null
        //     // 定义一个内部函数，用于执行滚动操作
        //     function scroll() {
        //       // 如果已经到达页面底部或者超过最大已滚动距离或者停止滚动，就停止滚动，并执行回调函数
        //       if (isBottom || currentScroll >= maxScroll || isStop) {
        //         clearInterval(timer)
        //         callback()
        //         resolve()
        //         return
        //       }
        //       // 每次滚动一定的像素
        //       window.scrollBy(0, 200)
        //       // 更新已滚动的距离
        //       currentScroll = window.scrollY
        //       // 检测是否到达页面底部
        //       if (currentScroll + window.innerHeight >= pageHeight) {
        //         // 如果是第一次到达页面底部，就设置一个定时器，等待2秒
        //         if (!isBottom) {
        //           isBottom = true
        //           timer = setTimeout(scroll, 2000)
        //         }
        //       } else {
        //         // 如果不是到达页面底部，就清除定时器，并继续滚动
        //         isBottom = false
        //         clearTimeout(timer)
        //         timer = setTimeout(scroll, 100)
        //       }
        //       // 检测是否停止滚动
        //       if (Date.now() - lastScrollTime > 1000) {
        //         // 如果超过1000ms没有滚动，就设置停止标志为真
        //         isStop = true
        //       } else {
        //         // 如果还在滚动，就更新最后一次滚动的时间，并设置停止标志为假
        //         lastScrollTime = Date.now()
        //         isStop = false
        //       }
        //     }
        //     // 调用内部函数开始滚动
        //     scroll()
        //   })
        // }

        // 异步滚动函数，接受两个参数：最大已滚动距离和回调函数
        async function autoScroll(maxScroll) {
          return new Promise((resolve) => {
            let lastScrollTime = Date.now() // 记录最后一次滚动的时间
            window.onscroll = () => {
              // 监听滚动事件
              lastScrollTime = Date.now() // 更新最后一次滚动的时间
              // 如果还在滚动，就更新最后一次滚动的时间，并设置停止标志为假
              isStop = false
            }
            // 获取当前已滚动的距离
            let currentScroll = window.scrollY
            // 设置一个标志，表示是否停止滚动
            let isStop = false
            // 设置一个计时器，用于检测滚动停留时间
            let timer = null
            // 定义一个内部函数，用于执行滚动操作
            async function scroll() {
              if (link.includes('https://www.pornpics.com')) {
                const element = document.querySelector('div.gallery-info.to-gall-info') // 使用选择器找到元素
                if (element !== null) {
                  console.log('元素已加载')
                  clearInterval(timer)
                  console.log('自动滚动完成！')
                  resolve()
                  return
                }
              }

              // 如果超过最大已滚动距离或者停止滚动，就停止滚动，并执行回调函数
              if (currentScroll >= maxScroll || isStop) {
                clearInterval(timer)
                console.log('自动滚动完成！')
                resolve()
                return
              }
              // 每次滚动一定的像素
              window.scrollBy(0, 300)
              // 更新已滚动的距离
              currentScroll = window.scrollY
              // 检测是否停止滚动
              if (Date.now() - lastScrollTime > 1000) {
                // 如果超过 1000ms 没有滚动，就设置停止标志为真
                isStop = true
              }
              // 设置一个定时器，继续滚动
              timer = setTimeout(scroll, 100)
            }
            // 调用内部函数开始滚动
            scroll()
          })
        }

        // 调用异步函数，传入最大已滚动距离为20000像素，回调函数为打印一条消息
        await autoScroll(100000)
      }, link)

      // 滚动到底部
      async function scrollToEnd(page) {
        return await page.evaluate(async () => {
          return new Promise((resolve) => {
            let lastScrollTime = Date.now() // 记录最后一次滚动的时间
            window.onscroll = () => {
              // 监听滚动事件
              lastScrollTime = Date.now() // 更新最后一次滚动的时间
            }
            let timerId = setInterval(() => {
              // 定时检查是否停止滚动
              if (Date.now() - lastScrollTime > 1000) {
                // 如果超过1000ms没有滚动
                clearInterval(timerId) // 清除定时器
                resolve() // 结束Promise
              } else {
                // 如果还在滚动
                window.scrollBy(0, 500) // 滚动一段距离
              }
            }, 100)
          })
        })
      }

      // 获取页面标题
      this.title = await page.title()

      this.downloadFolderPath
        ? (this.targetDownloadFolderPath = this.downloadFolderPath)
        : (this.targetDownloadFolderPath = `./download/${validateAndModifyFileName(`${this.title}`)}`)

      const { protocolAndDomain } = parseLink(link)

      this.images = await page.evaluate((protocolAndDomain) => {
        const elements = Array.from(document.querySelectorAll('a, img, svg, meta')) // 获取所有的 a 和 img 元素

        return elements
          .map((element) => {
            if (element.tagName === 'A') {
              const url = element.getAttribute('href')
              if (isImageLink(url)) return handleImageLink(url, protocolAndDomain)
              return null
            } else if (element.tagName === 'IMG') {
              let url = element.getAttribute('src')
              if (url) return handleImageLink(url, protocolAndDomain)
              return null
            } else if (element.tagName === 'svg') {
              const svgContent = new XMLSerializer().serializeToString(element)
              // 编码后的SVG内容
              const encodedSvgContent = encodeURIComponent(svgContent)
              console.log('encodedSvgContent: ', encodedSvgContent)
              return `data:image/svg+xml,${encodedSvgContent}`
            } else if (element.tagName === 'META') {
              const content = element.getAttribute('content')
              if (isImageLink(content)) return handleImageLink(content, protocolAndDomain)
              return null
            }
            return null // 返回 null 表示不是图片链接
          })
          .filter((link) => link !== null)
          .concat(extractImagesFromCssStyles())

        function extractImagesFromCssStyles() {
          const elements = document.querySelectorAll('[class]')
          const images = []

          // 遍历每个元素
          for (let element of elements) {
            const style = window.getComputedStyle(element)

            const backgroundImage = style.getPropertyValue('background-image')

            const svg = style.getPropertyValue('--svg')

            if (svg && (svg.startsWith('url("data:') || svg.startsWith('url("http'))) {
              images.push(extractImageLinkFromCssPropertyValue(svg))
            } else if (
              backgroundImage &&
              (backgroundImage.startsWith('url("data:') || backgroundImage.startsWith('url("http'))
            ) {
              images.push(extractImageLinkFromCssPropertyValue(backgroundImage))
            }
          }

          function extractImageLinkFromCssPropertyValue(cssPropertyValue) {
            if (cssPropertyValue.startsWith('url("data:')) {
              // 如果背景图像属性是一个data URL
              // 提取data URL中的图像数据
              const imageData = cssPropertyValue.slice(5, -2)
              const svgUrl = decodeURIComponent(imageData)
              return svgUrl
            } else if (cssPropertyValue.startsWith('url("http')) {
              // 如果背景图像属性是一个有效的链接
              // 提取链接中的图像地址
              const imageUrl = cssPropertyValue.slice(5, -2)
              return imageUrl
            }
          }

          // 返回包含图像数据的数组
          return images
        }

        function handleImageLink(url, protocolAndDomain) {
          url = url.replace(/_webp$/, '')
          if (protocolAndDomain.includes('http://asiantgp.net')) {
            const prefix = 'http://asiantgp.net/gallery/Japanese_cute_young_wife_Haruka'
            return prefix + '/' + url
          } else if (!url.startsWith('http')) {
            return (url = `${protocolAndDomain}` + url)
          } else {
            return url
          }
        }

        /**
         * 是否为图像链接
         * @param {string} url
         * @returns
         */
        function isImageLink(url) {
          // 定义一个正则表达式，匹配以常见图片文件扩展名结尾的字符串
          let regex = /(https?:\/\/).*\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i // 使用不区分大小写的标志 'i'
          // 调用test()方法，检查url是否符合正则表达式
          return regex.test(url)
        }
      }, protocolAndDomain)

      // 使用 Set 去重
      this.images = [...new Set(this.images)]

      console.log('this.images: ', this.images)
      console.log('this.images: ', this.images?.length)

      if (!this.images?.length) return this.finallyHandler()

      switch (this.downloadMode) {
        case 'downloadAllImages':
          this.installImages(link, this.images)
          break
        case 'downloadOriginImagesByThumbnails':
          let originalImageUrls = []
          if (link.includes('https://www.eroticbeauties.net')) {
            // 使用 page.evaluate 方法在页面上下文中执行 JavaScript 代码
            originalImageUrls = await page.evaluate(() => {
              const spans = Array.from(document.querySelectorAll('span.jpg')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

              // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
              const dataSrcValues = spans.map((span) => span.getAttribute('data-src'))

              return dataSrcValues
            })
          } else if (link.includes('http://www.alsasianporn.com')) {
            originalImageUrls = await page.evaluate(() => {
              const as = Array.from(document.querySelectorAll('a[data-fancybox="gallery"]')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

              // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
              const hrefValues = as.map((span) => span.getAttribute('href'))

              return hrefValues
            })
          }
          else if (link.includes('https://www.japanesesexpic.me') || link.includes('http://www.asianpussypic.me')) {
            originalImageUrls = await page.evaluate(() => {
              const as = Array.from(document.querySelectorAll('a[target="_blank"]')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

              // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
              const hrefValues = as.map((span) => span.getAttribute('href'))

              return hrefValues
            })
          }
          else if (link.includes('https://chpic.su')) {
            originalImageUrls = this.images
              .map((imageUrl) => generateOriginalImageUrl(imageUrl, 'transparent'))
              .filter((imageUrl) => imageUrl !== '')
            const originalImageUrlsOtherTypes = this.images
              .map((imageUrl) => generateOriginalImageUrl(imageUrl, 'white'))
              .filter((imageUrl) => imageUrl !== '')

            originalImageUrls.push(...originalImageUrlsOtherTypes)
          } else {
            originalImageUrls = this.images
              .map((imageUrl) => generateOriginalImageUrl(imageUrl))
              .filter((imageUrl) => imageUrl !== '')
          }

          console.log('originalImageUrls: ', originalImageUrls)

          originalImageUrls = originalImageUrls.map(url => {
            if (isImageLink(url)) return handleImageLink(url, protocolAndDomain)
            return null
          }).filter((link) => link !== null)

          if (!originalImageUrls.length) {
            resolve()
            return console.log('没有匹配到原图')
          }

          this.installImages(link, originalImageUrls)

          break
      }

      function handleImageLink(url, protocolAndDomain) {
        url = url.replace(/_webp$/, '')
        if (protocolAndDomain.includes('http://asiantgp.net')) {
          const prefix = 'http://asiantgp.net/gallery/Japanese_cute_young_wife_Haruka'
          return prefix + '/' + url
        } else if (!url.startsWith('http')) {
          return (url = `${protocolAndDomain}` + url)
        } else {
          return url
        }
      }

      /**
       * 是否为图像链接
       * @param {string} url
       * @returns
       */
      function isImageLink(url) {
        // 定义一个正则表达式，匹配以常见图片文件扩展名结尾的字符串
        let regex = /(https?:\/\/).*\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i // 使用不区分大小写的标志 'i'
        // 调用test()方法，检查url是否符合正则表达式
        return regex.test(url)
      }
    })
  }

  /**
   * 下载图片
   * @param {string} link
   * @param {string} imageUrls 图片链接集合
   */
  async installImages(link, imageUrls) {
    if (!fs.existsSync(this.targetDownloadFolderPath)) {
      fs.mkdirSync(this.targetDownloadFolderPath, { recursive: true })
      console.log(`文件夹${this.targetDownloadFolderPath}创建成功`)
    }

    // 已发送请求的图片链接集合
    const requestedImageUrls = []
    // 总照片数(待处理的请求总数)
    this.imageCount = imageUrls.length

    // 随机请求间隔（毫秒）
    let randomInterval = 0
    // 请求的开始时间（每一轮）
    let startTime = 0
    // 请求的结束时间（每一轮）
    let endTime = 0

    /* 随机化请求间隔：为了更好地模拟真实用户的行为，在请求之间添加随机的时间间隔，
      而不是固定的间隔。这可以减少模式化的请求，降低被识别为爬虫的概率。 */
    for (let i = 0; i < imageUrls.length; i += this.maxConcurrentRequests) {
      const batchUrls = imageUrls.slice(i, i + this.maxConcurrentRequests)
      const timeRemaining = randomInterval - (endTime - startTime)
      if (timeRemaining > 0) {
        randomInterval = timeRemaining
        // 设置请求间隔：在发送连续请求之间添加固定的时间间隔，以减缓请求的频率。
        await new Promise((resolve) => setTimeout(resolve, randomInterval))
      }
      // 请求的开始时间（每一轮）
      startTime = Date.now() % 10000
      await Promise.all(
        batchUrls.map(async (imageUrl) => {
          // 创建一个新的页面
          const page = await this.globalBrowser.newPage()
          // 设置请求头
          await page.setExtraHTTPHeaders({
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
            // Referer: link,
          })
          //  生成文件名
          // const fileName = this.addExtension(
          //   validateAndModifyFileName(
          //     `IMG_${requestedImageUrls.length + 1}_${this.extractImageNameAndFileName(imageUrl).fileName}`
          //   )
          // )

          const fileName = validateAndModifyFileName(this.extractImageNameAndFileName(imageUrl).fileName)

          requestedImageUrls.push(imageUrl)

          if (link.includes('https://chpic.su')) {
            return this.axiosDownload(fileName, imageUrl)
          } else {
            return this.download(page, fileName, imageUrl)
          }
        })
      )
      // 请求的结束时间（每一轮）
      endTime = Date.now() % 10000
      // 随机生成请求间隔
      randomInterval = Math.floor(Math.random() * (this.maxIntervalMs - this.minIntervalMs + 1) + this.minIntervalMs)
    }
  }

  /**
   * @description 图片下载
   * @param {string} page
   * @param {string} fileName
   * @param {string} imageUrl
   * @returns
   */
  async download(page, fileName, imageUrl) {
    return new Promise(async (resolve) => {
      // 构造目标文件的完整路径
      const targetFilePath = path.join(this.targetDownloadFolderPath, fileName)

      // 设置访问图片的超时时间为 180 秒
      const timeoutMilliseconds = 1000 * 5000

      // 使用 page.goto 导航到图片的URL
      try {
        const imageBuffer = await page
          .goto(imageUrl, { timeout: timeoutMilliseconds })
          .then((response) => response.buffer())
        await this.successHandler(imageBuffer, targetFilePath, imageUrl)
      } catch (error) {
        await this.errorHandler(error, imageUrl)
      }

      resolve()
    })
  }

  /**
   * @description axios 图片下载
   * @param {string} page
   * @param {string} fileName
   * @param {string} imageUrl
   * @returns
   */
  async axiosDownload(fileName, imageUrl) {
    return new Promise(async (resolve) => {
      // 构造目标文件的完整路径
      const targetFilePath = path.join(this.targetDownloadFolderPath, fileName)

      // 设置访问图片的超时时间为 60 秒
      const timeoutMilliseconds = 1000 * 60

      try {
        const response = await axios({
          url: imageUrl,
          responseType: 'arraybuffer',
          timeout: timeoutMilliseconds,
        })
        const imageBuffer = Buffer.from(response.data, 'binary')
        await this.successHandler(imageBuffer, targetFilePath, imageUrl)
      } catch (error) {
        await this.errorHandler(error, imageUrl)
      }

      resolve()
    })
  }

  /**
   * @description 成功请求处理器
   */
  successHandler(imageBuffer, targetFilePath, imageUrl) {
    return new Promise(async (resolve) => {
      // 请求成功 +1
      this.requestSuccessfullyCount++
      await this.saveFile(imageBuffer, targetFilePath, imageUrl)
      resolve()
    })
  }

  /**
   * @description 错误请求处理器
   */
  errorHandler(error, imageUrl) {
    return new Promise((resolve) => {
      // 请求失败 +1
      this.requestFailedCount++
      console.log('请求失败: ', this.requestFailedCount)
      // 下载失败 +1
      this.downloadFailedCount++
      console.log('请求失败/下载失败: ', this.downloadFailedCount)

      if (!error) {
        console.log('请求发送失败', imageUrl)
      } else {
        this.requestFailedImages.push(imageUrl)
        console.log(`访问图片时发生错误：`, imageUrl)
        console.log('错误请求集合个数: ', this.requestFailedImages.length)
        console.log('error', error)
      }
      // 判断是否已经处理完所有照片
      this.isFinished()

      resolve()
    })
  }

  /**
   * @description 保存文件
   * @param buffer buffer
   */
  saveFile(imageBuffer, targetFilePath, imageUrl) {
    return new Promise(async (resolve) => {
      try {
        await fs.promises.writeFile(targetFilePath, imageBuffer)
        // 下载成功 +1
        this.downloadSuccessfullyCount++
        console.log('下载成功: ', this.downloadSuccessfullyCount)
        console.log('\x1b[32m%s\x1b[0m', `已下载 ${this.downloadSuccessfullyCount} 张`)
      } catch (error) {
        this.requestFailedImages.push(imageUrl)
        // 下载失败 +1
        this.downloadFailedCount++
        console.log('下载失败: ', this.downloadFailedCount)
        console.log('保存失败：', error)
      }

      // 判断是否已经处理完所有照片
      this.isFinished()
      console.log('-----------------------------------------------')
      resolve()
    })
  }

  /**
   * @description 判断是否已经处理完所有照片
   */
  async isFinished() {
    // 如果保存成功的数量 + 保存失败的数量 == 已请求图片的总数量，那就说明本次服务到此可以结束了
    if (this.downloadSuccessfullyCount + this.downloadFailedCount == this.imageCount) {
      console.log(
        'this.downloadSuccessfullyCount + this.downloadFailedCount: ',
        this.downloadSuccessfullyCount + this.downloadFailedCount
      )
      await this.finallyHandler()
      this.globalResolveHandler()
    }
  }

  /**
   * @description 最终处理器
   */
  finallyHandler() {
    console.log('\x1b[34m%s\x1b[0m', `共 ${this.imageCount} 张`)
    console.log('\x1b[32m%s\x1b[0m', `成功访问 ${this.requestSuccessfullyCount} 张`)
    console.log('\x1b[31m%s\x1b[0m', `失败访问 ${this.requestFailedCount} 张`)
    console.log('\x1b[32m%s\x1b[0m', `成功下载 ${this.downloadSuccessfullyCount} 张`)
    console.log('\x1b[31m%s\x1b[0m', `失败访问 ${this.downloadFailedCount} 张`)

    return new Promise((resolve) => {
      if (this.requestFailedImages.length) {
        console.log('this.requestFailedImages: ', this.requestFailedImages)
        this.requestAgain()
      } else {
        // 触发重试的次数
        this.triggeringRetriesCount = 0
        // 总照片数
        this.imageCount = 0
        // 下载成功的照片数量
        this.downloadSuccessfullyCount = 0
        // 下载失败的照片数量
        this.downloadFailedCount = 0
        // 请求成功的照片数量
        this.requestSuccessfullyCount = 0
        // 请求失败的照片数量
        this.requestFailedCount = 0
        // 请求失败的照片集合
        this.requestFailedImages = []
        resolve()

        console.timeEnd('download time')
        console.log('\x1b[36m%s\x1b[0m', '计时结束')
      }
    })
  }

  /**
   * @description 重试机制： 重新下载请求失败的图片，可以确保爬虫能够处理请求失败的情况。
   * @returns
   */
  requestAgain() {
    // 触发重试的次数达到上限
    if (this.triggeringRetriesCount == this.retriesCount) return this.globalResolveHandler()

    console.log('\x1b[36m%s\x1b[0m', `${this.retryInterval}秒后重新下载请求失败的照片`)
    let countdown = this.retryInterval
    const timer = setInterval(() => {
      if (countdown == 0) {
        // 重新发送请求
        this.request()
        clearInterval(timer)
        countdown = this.retryInterval
      } else {
        console.log('\x1b[36m%s\x1b[0m', countdown)
        countdown--
      }
    }, 1000)
  }

  /**
   * @description 发送请求
   */
  async request() {
    // 触发重试
    this.triggeringRetriesCount++
    // 请求成功的照片数量
    this.requestSuccessfullyCount = 0
    // 请求失败的照片数量
    this.requestFailedCount = 0
    // 总照片数
    this.imageCount = 0
    // 下载成功的照片数量
    this.downloadSuccessfullyCount = 0
    // 下载失败的照片数量
    this.downloadFailedCount = 0

    const requestFailedImagesClone = JSON.parse(JSON.stringify(this.requestFailedImages))
    this.requestFailedImages = []

    this.downloadFolderPath
      ? (this.targetDownloadFolderPath = this.downloadFolderPath)
      : (this.targetDownloadFolderPath = `./download/${validateAndModifyFileName(`${this.title}`)}`)

    this.installImages(this.currentLink, requestFailedImagesClone)
  }

  /**
   * 提取链接中的图片名和文件名
   * @param {string} url
   * @returns
   */
  extractImageNameAndFileName(imageUrl) {
    if (isDataUrl(imageUrl)) {
      return getFileNameFromDataUrl(imageUrl)
    } else {
      return getImageNameAndFileName(imageUrl)
    }

    function isDataUrl(url) {
      // 检查链接是否以"data:"开头
      if (url.startsWith('data:')) {
        // 如果是，返回true
        return true
      } else {
        // 如果不是，返回false
        return false
      }
    }

    /**
     * 是否为图像链接
     * @param {string} url
     * @returns
     */
    function isImageLink(url) {
      // 定义一个正则表达式，匹配以常见图片文件扩展名结尾的字符串
      let regex = /(https?:\/\/).*\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i // 使用不区分大小写的标志 'i'
      // 调用test()方法，检查url是否符合正则表达式
      return regex.test(url)
    }

    function getImageNameAndFileName(imageUrl) {
      // 用"/"分割图片链接，得到一个数组
      let parts = imageUrl.split('/')
      // 取数组的最后一个元素，即文件名字
      let fileName = parts[parts.length - 1]
      if (fileName.includes('?')) fileName = fileName.split('?')[0]

      fileName = addExtension(fileName)

      // 用"."分割文件名字，得到一个数组
      let subparts = fileName.split('.')
      // 取数组的第一个元素，即图片名字
      let imageName = subparts[0]
      // 返回一个对象，包含图片名字和文件名字
      return {
        imageName: imageName,
        fileName: fileName,
      }
    }

    function getFileNameFromDataUrl(imageUrl, id) {
      // 用","分割图片链接，得到一个数组
      let parts = imageUrl.split(',')
      // 取数组的第一个元素，即数据URI的前缀
      let prefix = parts[0]
      // 用";"分割前缀，得到一个数组
      let subparts = prefix.split(';')
      // 取数组的第一个元素，即MIME类型
      let mimeType = subparts[0]
      // 去掉"data:"前缀
      mimeType = mimeType.slice(5)
      // 根据MIME类型来判断文件的扩展名
      let extension = ''
      switch (mimeType) {
        case 'image/svg+xml':
          extension = '.svg'
          break
        case 'image/png':
          extension = '.png'
          break
        case 'image/jpeg':
          extension = '.jpg'
          break
        // 其他类型可以自行添加
        default:
          extension = '.unknown'
      }

      let imageName = id
      let fileName = id + extension
      // 返回文件名字
      return {
        imageName,
        fileName,
      }
    }

    /**
     * @description 判断文件名是否有包含文件扩展名，如果没有默认加上.png
     * @param {*} filename
     * @returns
     */
    function addExtension(filename) {
      // 定义一个函数，接受一个文件名作为参数
      let ext = '.png' // 定义一个变量，存储默认的文件扩展名
      let re = /\.\w+$/ // 定义一个正则表达式，匹配以.开头的任意字母或数字结尾的部分
      if (re.test(filename)) {
        // 如果文件名匹配正则表达式，说明已经有文件扩展名
        return filename // 直接返回文件名
      } else {
        // 否则，说明没有文件扩展名
        return filename + ext // 在文件名后面加上默认的文件扩展名，并返回
      }
    }
  }
}
