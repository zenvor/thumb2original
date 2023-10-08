import fs from 'fs'
import path from 'path'
import axios from 'axios'
import puppeteer from 'puppeteer'
import cheerio from 'cheerio-without-node-native'
// 检验并生成一个符合 Windows 文件命名规则的文件名
import { validateAndModifyFileName } from './utils/validate-and-modify-file-name.js'
// 获取现在的时间
import { getNowDate } from './utils/get-now-date.js'
// 根据缩略图获取原图
import { generateOriginalImageUrl } from './utils/generate-original-image-url.js'
// 解析链接
import { parseLink } from './utils/parse-link.js'

// 配置文件中的变量
import { config } from './config.js'
let {
  extractMode,
  downloadMode,
  retryInterval,
  retriesCount,
  targetCrawlingWebPageLink,
  targetCrawlingWebPageLinks,
  downloadFolderPath,
  maxConcurrentRequests,
  maxIntervalMs,
  minIntervalMs,
} = config

// resolve 函数
let globalResolveHandler
// 网页标题
let title
// 当前访问的链接
let currentLink
// 全局浏览器实例
let globalBrowser
// 导航浏览器
let navigationBrowser
// 触发重试的次数
let triggeringRetriesCount = 0
// 总照片数
let imageCount = 0
// 下载成功的照片数量
let downloadSuccessfullyCount = 0
// 下载失败的照片数量
let downloadFailedCount = 0
// 请求成功的照片数量
let requestSuccessfullyCount = 0
// 请求失败的照片数量
let requestFailedCount = 0
// 请求失败的照片集合
let requestFailedImages = []

switch (extractMode) {
  case 'singleSite':
    console.log('\x1b[36m%s\x1b[0m', '开始计时')
    console.time('download time')
    // 启动一个全局浏览器实例
    globalBrowser = await puppeteer.launch({ headless: 'new' })

    await extractingImages(targetCrawlingWebPageLink)
    break
  case 'multipleSites':
    ;(async function () {
      for (const link of targetCrawlingWebPageLinks) {
        if (link) {
          console.log('\x1b[36m%s\x1b[0m', '开始计时')
          console.time('download time')
          // 启动一个全局浏览器实例
          globalBrowser = await puppeteer.launch({ headless: 'new' })

          await extractingImages(link)
          console.log('link: ', link)
        }
      }
    })()
    break
}

/**
 * @description 图片提取
 * @param {string} link
 */
function extractingImages(link) {
  return new Promise(async (resolve) => {
    globalResolveHandler = resolve
    console.log('link: ', link)
    currentLink = link
    // 启动一个新的浏览器实例
    navigationBrowser = await puppeteer.launch({ headless: 'new' })
    // 创建一个新的页面
    const page = await navigationBrowser.newPage()
    // 设置视口大小为1600px宽，5000px高
    await page.setViewport({ width: 1600, height: 50000 })
    // 配置导航超时
    await page.setDefaultNavigationTimeout(300 * 1000)
    // 导航到您想要获取HTML的网址 ['load', 'domcontentloaded', 'networkidle0', 'networkidle2']
    await page.goto(link, { waitUntil: 'domcontentloaded' })
    // 模拟滚动页面
    await page.evaluate(() => {
      window.scrollBy(0, 1000)
    })

    // 等待确保页面加载完成
    await page.waitForSelector('body')

    // 获取页面标题
    title = await page.title()
    console.log('title: ', title)

    let targetDownloadFolderPath
    downloadFolderPath
      ? (targetDownloadFolderPath = downloadFolderPath)
      : (targetDownloadFolderPath = `./download/${validateAndModifyFileName(`${title}`)}`)

    // 获取页面中匹配选择器的所有图片元素
    // const html = await page.content()
    // console.log('html: ', html)
    // const $ = cheerio.load(html)
    // const images = []
    // const { protocolAndDomain } = parseLink(link)
    // if (link.includes('https://www.4khd.com')) {
    //   $('a').each((index, element) => {
    //     debugger
    //     const href = $(element).attr('href')
    //     let url = href
    //     if (!url.includes('http')) {
    //       images.push((url = `${protocolAndDomain}` + url))
    //     } else {
    //       images.push(url)
    //     }
    //   })
    // } else {
    //   $('img').each((index, element) => {
    //     const src = $(element).attr('src')
    //     let url = src
    //     if (!url.includes('http')) {
    //       images.push((url = `${protocolAndDomain}` + url))
    //     } else {
    //       images.push(url)
    //     }
    //   })
    // }

    const { protocolAndDomain } = parseLink(link)
    const images = await page.evaluate((protocolAndDomain) => {
      const elements = Array.from(document.querySelectorAll('img'))

      return (images = elements.map((element) => {
        let url = element.getAttribute('src')
        if (!url.includes('http')) {
          return (url = `${protocolAndDomain}` + url)
        } else {
          return url
        }
      }))
    }, protocolAndDomain)

    console.log('images: ', images)
    console.log('images: ', images?.length)

    if (!images?.length) return finallyHandler()

    switch (downloadMode) {
      case 'downloadAllImages':
        installImages(
          link,
          images,
          targetDownloadFolderPath,
          maxConcurrentRequests,
          maxIntervalMs,
          minIntervalMs,
          finallyHandler
        )
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
        } else if (link.includes('https://chpic.su')) {
          originalImageUrls = images
            .map((imageUrl) => generateOriginalImageUrl(imageUrl, 'transparent'))
            .filter((imageUrl) => imageUrl !== '')
          const originalImageUrlsOtherTypes = images
            .map((imageUrl) => generateOriginalImageUrl(imageUrl, 'white'))
            .filter((imageUrl) => imageUrl !== '')

          originalImageUrls.push(...originalImageUrlsOtherTypes)
        } else {
          originalImageUrls = images
            .map((imageUrl) => generateOriginalImageUrl(imageUrl))
            .filter((imageUrl) => imageUrl !== '')
        }

        console.log('originalImageUrls: ', originalImageUrls)
        if (!originalImageUrls.length) {
          return console.log('没有匹配到原图')
        }

        installImages(
          link,
          originalImageUrls,
          targetDownloadFolderPath,
          maxConcurrentRequests,
          maxIntervalMs,
          minIntervalMs,
          finallyHandler
        )

        break
    }
  })
}

/**
 * 下载图片
 * @param {string} link
 * @param {string} imageUrls 图片链接集合
 * @param {string} targetDownloadFolderPath 目标下载文件夹路径
 * @param {string} maxConcurrentRequests 最大并发请求数（每一轮）
 * @param {string} maxIntervalMs 最大请求间隔时间（毫秒）
 * @param {string} minIntervalMs 最小请求间隔时间（毫秒）
 * @param {function} finallyHandler 最终处理函数
 */
function installImages(
  link,
  imageUrls,
  targetDownloadFolderPath,
  maxConcurrentRequests = 50,
  maxIntervalMs = 0,
  minIntervalMs = 0,
  finallyHandler
) {
  return new Promise(async (topResolve) => {
    if (!fs.existsSync(targetDownloadFolderPath)) {
      console.log(`没有检测到"${targetDownloadFolderPath}"文件夹`)
      fs.mkdirSync(targetDownloadFolderPath, { recursive: true })
      console.log('文件夹创建成功')
    }

    // 已发送请求的图片链接集合
    const requestedImageUrls = []
    // 总照片数(待处理的请求总数)
    imageCount = imageUrls.length

    // 随机请求间隔（毫秒）
    let randomInterval = 0
    // 请求的开始时间（每一轮）
    let startTime = 0
    // 请求的结束时间（每一轮）
    let endTime = 0

    /* 随机化请求间隔：为了更好地模拟真实用户的行为，在请求之间添加随机的时间间隔，
      而不是固定的间隔。这可以减少模式化的请求，降低被识别为爬虫的概率。 */
    for (let i = 0; i < imageUrls.length; i += maxConcurrentRequests) {
      const batchUrls = imageUrls.slice(i, i + maxConcurrentRequests)
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
          const page = await globalBrowser.newPage()
          // 设置请求头
          await page.setExtraHTTPHeaders({
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36',
            // Referer: link,
          })
          //  生成文件名
          const fileName = addExtension(
            validateAndModifyFileName(`IMG_${requestedImageUrls.length + 1}_${extractUrlFileNames(imageUrl)}`)
          )

          requestedImageUrls.push(imageUrl)

          if (link.includes('https://chpic.su')) {
            return axiosDownload(fileName, imageUrl)
          } else {
            return download(page, fileName, imageUrl)
          }
        })
      )
      // 请求的结束时间（每一轮）
      endTime = Date.now() % 10000
      // 随机生成请求间隔
      randomInterval = Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1) + minIntervalMs)
    }

    /**
     * @description 图片下载
     * @param {string} page
     * @param {string} fileName
     * @param {string} imageUrl
     * @returns
     */
    async function download(page, fileName, imageUrl) {
      return new Promise(async (resolve) => {
        // 构造目标文件的完整路径
        const targetFilePath = path.join(targetDownloadFolderPath, fileName)

        // 设置访问图片的超时时间为 60 秒
        const timeoutMilliseconds = 1000 * 60

        // 使用 page.goto 导航到图片的URL
        try {
          const imageBuffer = await page
            .goto(imageUrl, { timeout: timeoutMilliseconds })
            .then((response) => response.buffer())
          await successHandler(imageBuffer, targetFilePath, imageUrl)
        } catch (error) {
          await errorHandler(error, imageUrl)
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
    async function axiosDownload(fileName, imageUrl) {
      return new Promise(async (resolve) => {
        // 构造目标文件的完整路径
        const targetFilePath = path.join(targetDownloadFolderPath, fileName)

        // 设置访问图片的超时时间为 60 秒
        const timeoutMilliseconds = 1000 * 60

        try {
          const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: timeoutMilliseconds,
          })
          const imageBuffer = Buffer.from(response.data, 'binary')
          await successHandler(imageBuffer, targetFilePath, imageUrl)
        } catch (error) {
          await errorHandler(error, imageUrl)
        }

        resolve()
      })
    }

    // 成功请求处理器
    function successHandler(imageBuffer, targetFilePath, imageUrl) {
      return new Promise(async (resolve) => {
        // 请求成功 +1
        requestSuccessfullyCount++
        await saveFile(imageBuffer, targetFilePath, imageUrl)
        resolve()
      })
    }

    // 错误请求处理器
    function errorHandler(error, imageUrl) {
      return new Promise((resolve) => {
        // 请求失败 +1
        requestFailedCount++
        console.log('请求失败: ', requestFailedCount)
        // 下载失败 +1
        downloadFailedCount++
        console.log('请求失败/下载失败: ', downloadFailedCount)

        if (!error) {
          console.log('请求发送失败', imageUrl)
        } else {
          requestFailedImages.push(imageUrl)
          console.log(`访问图片时发生错误：`, imageUrl)
          console.log('错误请求集合个数: ', requestFailedImages.length)
          console.log('error', error)
        }
        // 判断是否已经处理完所有照片
        isFinished()

        resolve()
      })
    }

    /**
     * @description 保存文件
     * @param buffer buffer
     */
    function saveFile(imageBuffer, targetFilePath, imageUrl) {
      return new Promise(async (resolve) => {
        try {
          await fs.promises.writeFile(targetFilePath, imageBuffer)
          // 下载成功 +1
          downloadSuccessfullyCount++
          console.log('下载成功: ', downloadSuccessfullyCount)
          console.log('\x1b[32m%s\x1b[0m', `已下载 ${downloadSuccessfullyCount} 张`)
        } catch (error) {
          requestFailedImages.push(imageUrl)
          // 下载失败 +1
          downloadFailedCount++
          console.log('下载失败: ', downloadFailedCount)
          console.log('保存失败：', error)
        }

        // 判断是否已经处理完所有照片
        isFinished()
        console.log('-----------------------------------------------')
        resolve()
      })
    }

    // 判断是否已经处理完所有照片
    async function isFinished() {
      // 如果保存成功的数量 + 保存失败的数量 == 已请求图片的总数量，那就说明本次服务到此可以结束了
      if (downloadSuccessfullyCount + downloadFailedCount == imageCount) {
        console.log(
          'downloadSuccessfullyCount + downloadFailedCount: ',
          downloadSuccessfullyCount + downloadFailedCount
        )
        await finallyHandler()
        globalResolveHandler()
      }
    }
  })
}

/**
 * @description 最终处理器
 */
function finallyHandler() {
  console.log('\x1b[34m%s\x1b[0m', `共 ${imageCount} 张图片`)
  console.log('\x1b[32m%s\x1b[0m', `已成功访问 ${requestSuccessfullyCount} 张`)
  console.log('\x1b[31m%s\x1b[0m', `失败访问 ${requestFailedCount} 张`)
  console.log('\x1b[32m%s\x1b[0m', `${downloadSuccessfullyCount} 张下载成功`)
  console.log('\x1b[31m%s\x1b[0m', `${downloadFailedCount} 张下载失败`)

  return new Promise((resolve) => {
    if (requestFailedImages.length) {
      console.log('requestFailedImages: ', requestFailedImages)
      requestAgain()
    } else {
      // 关闭浏览器
      globalBrowser.close()
      navigationBrowser.close()
      // 触发重试的次数
      triggeringRetriesCount = 0
      // 总照片数
      imageCount = 0
      // 下载成功的照片数量
      downloadSuccessfullyCount = 0
      // 下载失败的照片数量
      downloadFailedCount = 0
      // 请求成功的照片数量
      requestSuccessfullyCount = 0
      // 请求失败的照片数量
      requestFailedCount = 0
      // 请求失败的照片集合
      requestFailedImages = []
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
function requestAgain() {
  // 触发重试的次数达到上限
  if (triggeringRetriesCount == retriesCount) return

  console.log('\x1b[36m%s\x1b[0m', `${retryInterval}秒后重新下载请求失败的照片`)
  let countdown = retryInterval
  const timer = setInterval(() => {
    if (countdown == 0) {
      // 重新发送请求
      request()
      clearInterval(timer)
      countdown = retryInterval
    } else {
      console.log('\x1b[36m%s\x1b[0m', countdown)
      countdown--
    }
  }, 1000)

  // 发送请求
  async function request() {
    // 触发重试
    triggeringRetriesCount++
    // 请求成功的照片数量
    requestSuccessfullyCount = 0
    // 请求失败的照片数量
    requestFailedCount = 0
    // 总照片数
    imageCount = 0
    // 下载成功的照片数量
    downloadSuccessfullyCount = 0
    // 下载失败的照片数量
    downloadFailedCount = 0

    const requestFailedImagesClone = JSON.parse(JSON.stringify(requestFailedImages))
    requestFailedImages = []

    let targetDownloadFolderPath
    downloadFolderPath
      ? (targetDownloadFolderPath = downloadFolderPath)
      : (targetDownloadFolderPath = `./download/${validateAndModifyFileName(`${title}`)}`)

    installImages(
      currentLink,
      requestFailedImagesClone,
      targetDownloadFolderPath,
      maxConcurrentRequests,
      maxIntervalMs,
      minIntervalMs,
      finallyHandler
    )
  }
}

/**
 * 提取链接中的文件名
 * @param {string} url
 * @returns
 */
function extractUrlFileNames(url) {
  if (url) {
    try {
      const slashString = url.lastIndexOf('/') || 0
      let fileName = url.substring(slashString + 1)
      if (fileName.includes('?')) fileName = fileName.split('?')[0]
      return fileName
    } catch (error) {
      console.log('url', url)
      console.log('提取链接中的文件名 Error', error)
    }
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
