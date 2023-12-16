import fs from 'fs'
import path from 'path'
import axios from 'axios'
import puppeteer from 'puppeteer'
// 检验并生成一个符合 Windows 文件命名规则的文件名
import { validateAndModifyFileName } from './utils/validate-and-modify-file-name.js'
// 根据缩略图获取原图
import { generateOriginalImageUrl } from './utils/generate-original-image-url.js'
// 解析链接
import { parseUrl } from './utils/parse-url.js'

export default class ImageExtractor {
  constructor(config) {
    this.config = config
    this.retryInterval = this.config.retryInterval
    this.retriesCount = this.config.retriesCount
    this.extractMode = this.config.extractMode
    this.downloadMode = this.config.downloadMode
    this.downloadFolderPath = this.config.downloadFolderPath
    this.url = this.config.url
    this.urls = this.config.urls
    this.maxConcurrentRequests = this.config.maxConcurrentRequests
    this.maxIntervalMs = this.config.maxIntervalMs
    this.minIntervalMs = this.config.minIntervalMs
    // 全局浏览器实例
    this.browser = null
    // resolve 函数
    this.globalResolveHandler = null
    // 网页标题
    this.title = ''
    // 当前访问的链接
    this.currentUrl = ''
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

  /**
   * @description 图片提取
   * @param {string} link
   */
  extractImages() {
    const handler = (link) => {
      if (!link) return
      console.log('\x1b[36m%s\x1b[0m', `提取的链接${link}`)

      return new Promise(async (resolve) => {
        this.globalResolveHandler = resolve
        this.currentUrl = link

        // 启动一个全局浏览器实例
        this.browser = await puppeteer.launch({ headless: false, timeout: 300 * 1000 })

        // 创建一个新的页面
        const page = await this.browser.newPage()

        // 设置视口大小
        await page.setViewport({ width: 1800, height: 1000 })

        // 加载页面
        await this.loadingPage(page)

        // 向下滚动
        await this.scrollingDown(page)

        // 查找图像
        await this.findingImages(page)
        
        // 下载图像
        await this.downloadImages(page)
      })
    }

    return new Promise(async (resolve) => {
      switch (this.extractMode) {
        case 'singleSite':
          console.log('\x1b[36m%s\x1b[0m', '开始计时')
          console.time('download time')

          try {
            const result = await handler(this.url)
            resolve(result)
          } catch (error) {
            console.log('error: ', error)
          }

          break
        case 'multipleSites':
          for (const url of this.urls) {
            console.log('\x1b[36m%s\x1b[0m', '开始计时')
            console.time('download time')
            try {
              const result = await handler(url)
              resolve(result)
            } catch (error) {
              console.log('error: ', error)
            }
          }
          break
      }

      // 关闭浏览器
      this.browser.close()
      this.browser = null
    })
  }

  /**
   * @description 加载页面
   * @param {object} page
   * @returns
   */
  loadingPage(page) {
    return new Promise(async (resolve) => {
      try {
        // 设置访问图像的超时时间为 300 秒
        const timeoutMilliseconds = 1000 * 500

        setTimeout(() => {
          console.log('加载页面...')
          console.log('提取进度', '25%')
        }, 200)

        setTimeout(() => {
          console.log('提取进度', '30%')
        }, 500)

        setTimeout(() => {
          console.log('提取进度', '35%')
        }, 1000)

        // 导航到您想要获取HTML的网址 ['load', 'domcontentloaded', 'networkidle0', 'networkidle2']
        await page.goto(this.currentUrl, { waitUntil: 'networkidle0', timeout: timeoutMilliseconds })

        // 获取页面标题
        this.title = await page.title()
        console.log('\x1b[36m%s\x1b[0m', `网页标题${this.title}`)

        console.log('页面加载完成', '40%')
      } catch (error) {
        console.log('error: ', error)
      }
      // 等待一段时间
      await new Promise((resolve) => setTimeout(resolve, 2000))

      resolve()
    })
  }

  /**
   * @description 向下滚动
   * @returns
   */
  scrollingDown(page) {
    return new Promise(async (resolve) => {
      console.log('向下滚动...', '45%')

      console.log('向下滚动', '50%')

      await page.evaluate(async () => {
        // 异步滚动函数，接受一个参数：最大已滚动距离
        async function autoScroll(maxScroll, timeout = 2000) {
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
            function scroll() {
              // 如果超过最大已滚动距离或者停止滚动，就停止滚动，并执行回调函数
              if (currentScroll >= maxScroll || isStop) {
                console.log('自动滚动完成！')
                clearInterval(timer)
                return resolve()
              }
              // 每次滚动一定的像素
              window.scrollBy(0, 1000)
              // 更新已滚动的距离
              currentScroll = window.scrollY
              // 检测是否停止滚动
              if (Date.now() - lastScrollTime > timeout) {
                // 如果超时没有滚动，就设置停止标志为真
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
        await autoScroll(20000)
      })

      console.log('提取进度', '60%')

      resolve()
    })
  }

  /**
   * @description 查找图像
   * @returns
   */
  findingImages(page) {
    return new Promise(async (resolve) => {
      this.downloadFolderPath
        ? (this.targetDownloadFolderPath = this.downloadFolderPath)
        : (this.targetDownloadFolderPath = `./download/${validateAndModifyFileName(`${this.title}`)}`)

      const { protocolAndDomain } = parseUrl(this.currentUrl)

      console.log('查找图像', '65%')

      console.log('查找图像', '70%')

      console.log('查找图像', '75%')

      console.log('查找图像', '80%')

      let images = await page.evaluate((protocolAndDomain) => {
        const elementArray = ['a', 'img', 'svg', 'use', 'meta', 'link']

        const elements = Array.from(document.querySelectorAll('img')) // 获取所有的 a 和 img 元素
        return elements
          .map((element) => {
            if (element.tagName === 'A') {
              let url = element.getAttribute('href')
              if (!url) return null

              url = handleImageUrl(url, protocolAndDomain)
              if (isImageUrl(url)) return url
            } else if (element.tagName === 'IMG') {
              let url = element.getAttribute('src')
              if (!url) return null

              url = handleImageUrl(url, protocolAndDomain)
              return url
            }
            return null // 返回 null 表示不是图像链接
          })
          .filter((url) => url != null)

        function handleImageUrl(url, protocolAndDomain) {
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
        function isImageUrl(url) {
          // 定义一个正则表达式，匹配以常见图像文件扩展名结尾的字符串
          let regex = /(https?:\/\/).*\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff)$/i // 使用不区分大小写的标志 'i'
          // 调用test()方法，检查url是否符合正则表达式
          return regex.test(url)
        }
      }, protocolAndDomain)

      images.forEach((url) => {
        if (url.includes('_webp')) {
          const jpegUrl = url.replace('_webp', '')
          images.push(jpegUrl)
        }
      })

      // 使用 Set 去重
      images = Array.from(new Set(images))
      this.images = images
      console.log(`提取的图像`, images)
      console.log(`提取的图像的个数`, images.length)

      resolve(images)
    })
  }

  /**
   * 下载图片
   */
  async downloadImages(page) {
    /**
     * @description 判断是否已经处理完所有照片
     */
    const isFinished = () => {
      // 如果保存成功的数量 + 保存失败的数量 == 已请求图片的总数量，那就说明本次服务到此可以结束了
      if (this.downloadSuccessfullyCount + this.downloadFailedCount == this.imageCount) {
        console.log('已经处理完所有照片')
        return true
      }

      return false
    }

    /**
     * @description 成功请求处理器
     */
    const successHandler = (buffer, targetFilePath, imageUrl) => {
      // 请求成功 +1
      this.requestSuccessfullyCount++
      saveFile(buffer, targetFilePath, imageUrl)
    }

    /**
     * @description 错误请求处理器
     */
    const errorHandler = async (error, imageUrl) => {
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

      if (isFinished()) {
        finallyHandler()
      }
    }

    /**
     * @description 图片下载
     * @param {string} page
     * @param {string} imageUrl
     * @returns
     */
    const download = (page, imageUrl) => {
      return new Promise(async (resolve) => {
        // 设置访问图片的超时时间
        const timeoutMilliseconds = 1000 * 60

        // 使用 page.goto 导航到图片的URL
        try {
          const response = await page.goto(imageUrl, { timeout: timeoutMilliseconds })
          let buffer
          const contentType = response.headers()['content-type']

          if (contentType && contentType.startsWith('image/')) {
            buffer = await response.buffer()
          } else {
            return resolve()
          }

          //  生成文件名
          const fileName = validateAndModifyFileName(this.extractFileName(imageUrl, buffer))
          // 构造目标文件的完整路径
          const targetFilePath = path.join(this.targetDownloadFolderPath, fileName)

          successHandler(buffer, targetFilePath, imageUrl)
        } catch (error) {
          errorHandler(error, imageUrl)
        }

        resolve()
      })
    }

    /**
     * @description axios 图片下载
     * @param {string} page
     * @param {string} imageUrl
     * @returns
     */
    const downloadWithAxios = (imageUrl) => {
      return new Promise(async (resolve) => {
        // 设置访问图片的超时时间为 60 秒
        const timeoutMilliseconds = 1000 * 60

        try {
          const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: timeoutMilliseconds,
          })
          const buffer = Buffer.from(response.data, 'binary')

          //  生成文件名
          const fileName = validateAndModifyFileName(this.extractFileName(imageUrl, buffer))
          // 构造目标文件的完整路径
          const targetFilePath = path.join(this.targetDownloadFolderPath, fileName)

          successHandler(buffer, targetFilePath, imageUrl)
        } catch (error) {
          errorHandler(error, imageUrl)
        }

        resolve()
      })
    }

    /**
     * @description 发送请求
     */
    const request = async () => {
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

      this.downloadImages(this.currentUrl, requestFailedImagesClone)
    }

    /**
     * @description 重试机制： 重新下载请求失败的图片，可以确保爬虫能够处理请求失败的情况。
     * @returns
     */
    const requestAgain = () => {
      // 触发重试的次数达到上限
      if (this.triggeringRetriesCount == this.retriesCount) return this.globalResolveHandler()

      console.log('\x1b[36m%s\x1b[0m', `${this.retryInterval}秒后重新下载请求失败的照片`)
      let countdown = this.retryInterval
      const timer = setInterval(() => {
        if (countdown == 0) {
          // 重新发送请求
          request()
          clearInterval(timer)
          countdown = this.retryInterval
        } else {
          console.log('\x1b[36m%s\x1b[0m', countdown)
          countdown--
        }
      }, 1000)
    }

    /**
     * @description 最终处理器
     */
    const finallyHandler = () => {
      console.log('\x1b[34m%s\x1b[0m', `共 ${this.imageCount} 张`)
      console.log('\x1b[32m%s\x1b[0m', `成功访问 ${this.requestSuccessfullyCount} 张`)
      console.log('\x1b[31m%s\x1b[0m', `失败访问 ${this.requestFailedCount} 张`)
      console.log('\x1b[32m%s\x1b[0m', `成功下载 ${this.downloadSuccessfullyCount} 张`)
      console.log('\x1b[31m%s\x1b[0m', `失败访问 ${this.downloadFailedCount} 张`)

      if (this.requestFailedImages.length) {
        console.log('this.requestFailedImages: ', this.requestFailedImages)
        requestAgain()
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

        this.globalResolveHandler()

        console.timeEnd('download time')
        console.log('\x1b[36m%s\x1b[0m', '计时结束')
      }
    }

    /**
     * @description 保存文件
     * @param buffer buffer
     * @param targetFilePath buffer
     * @param imageUrl buffer
     */
    const saveFile = async (buffer, targetFilePath, imageUrl) => {
      try {
        await fs.promises.writeFile(targetFilePath, buffer)
        // 下载成功 +1
        this.downloadSuccessfullyCount++
        console.log('下载成功: ', this.downloadSuccessfullyCount)
        console.log('\x1b[32m%s\x1b[0m', `已下载 ${this.downloadSuccessfullyCount} 张`)
      } catch (error) {
        this.requestFailedImages.push(imageUrl)
        // 下载失败 +1
        this.downloadFailedCount++
        console.log('下载失败: ', this.downloadFailedCount)
        console.log('下载失败', error)
      }

      console.log('-----------------------------------------------')

      // 判断是否已经处理完所有照片
      if (isFinished()) {
        finallyHandler()
      }
    }

    const handler = async (imageUrls) => {
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
            const page = await this.browser.newPage()
            // 设置请求头
            await page.setExtraHTTPHeaders({
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            })

            requestedImageUrls.push(imageUrl)

            if (this.currentUrl.includes('https://chpic.su')) {
              return downloadWithAxios(imageUrl)
            } else {
              return download(page, imageUrl)
            }
          })
        )
        // 请求的结束时间（每一轮）
        endTime = Date.now() % 10000
        // 随机生成请求间隔
        randomInterval = Math.floor(Math.random() * (this.maxIntervalMs - this.minIntervalMs + 1) + this.minIntervalMs)
      }
    }

    switch (this.downloadMode) {
      case 'downloadAllImages':
        handler(this.images)
        break
      case 'downloadOriginImagesByThumbnails':
        let originalImageUrls = []
        if (this.currentUrl.includes('https://www.eroticbeauties.net')) {
          // 使用 page.evaluate 方法在页面上下文中执行 JavaScript 代码
          originalImageUrls = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span.jpg')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

            // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
            const dataSrcValues = spans.map((span) => span.getAttribute('data-src'))

            return dataSrcValues
          })
        } else if (this.currentUrl.includes('http://www.alsasianporn.com')) {
          originalImageUrls = await page.evaluate(() => {
            const as = Array.from(document.querySelectorAll('a[data-fancybox="gallery"]')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

            // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
            const hrefValues = as.map((span) => span.getAttribute('href'))

            return hrefValues
          })
        } else if (
          this.currentUrl.includes('https://www.japanesesexpic.me') ||
          this.currentUrl.includes('http://www.asianpussypic.me')
        ) {
          originalImageUrls = await page.evaluate(() => {
            const as = Array.from(document.querySelectorAll('a[target="_blank"]')) // 获取页面中所有具有 "jpg" 类名的 <span> 元素

            // 使用 Array.map 方法获取每个 <span> 元素的 data-src 属性的值
            const hrefValues = as.map((span) => span.getAttribute('href'))

            return hrefValues
          })
        } else if (this.currentUrl.includes('https://chpic.su')) {
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
        console.log('originalImageUrls.length: ', originalImageUrls.length)

        if (!originalImageUrls.length) {
          resolve()
          return console.log('没有匹配到原图')
        }

        handler(originalImageUrls)
        break
    }
  }

  /**
   * 提取链接中的图像名和文件名
   * @param {string} url
   * @returns
   */
  extractFileName(url, buffer) {
    // 获取 URL 的路径部分
    const path = url.split('?')[0]

    // 获取文件名
    const fileName = path.split('/').pop()
    const type = fileName.split('.').pop()
    const imageName = fileName.replace(`.${type}`, '')

    return imageName + '.' + analyzingImages(buffer)

    function analyzingImages(buffer) {
      const type = getImageFormatFromBuffer(buffer)
      return type

      function getImageFormatFromBuffer(buffer) {
        if (buffer[0] === 0xff && buffer[1] === 0xd8) {
          return 'jpeg'
        } else if (buffer[0] === 0x89 && buffer.toString('utf8', 1, 4) === 'PNG') {
          return 'png'
        } else if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
          return 'gif'
        } else if (
          buffer[0] === 0x52 && // R
          buffer[1] === 0x49 && // I
          buffer[2] === 0x46 && // F
          buffer[3] === 0x46 && // F
          buffer[8] === 0x57 && // W
          buffer[9] === 0x45 && // E
          buffer[10] === 0x42 && // B
          buffer[11] === 0x50 // P
        ) {
          return 'webp'
        } else if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
          return 'bmp'
        }
        return 'Unknown'
      }
    }
  }
}
