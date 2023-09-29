import fs from 'fs'
import path from 'path'
import puppeteer from 'puppeteer'
import cheerio from 'cheerio-without-node-native'
// 检验并生成一个符合 Windows 文件命名规则的文件名
import { validateAndModifyFileName } from './utils/validate-and-modify-file-name.js'
// 获取现在的时间
import { getNowDate } from './utils/get-now-date.js'
// 根据缩略图获取原图
import { generateOriginalImageUrl } from './utils/generate-original-image-url.js'

// 配置文件中的变量
import { config } from './config.js'
let {
  downloadMode,
  retryInterval,
  retriesCount,
  targetCrawlingWebPageLink,
  targetDownloadFolderPath,
  maxConcurrentRequests,
  maxIntervalMs,
  minIntervalMs,
} = config

// 启动一个全局浏览器实例
const globalBrowser = await puppeteer.launch({ headless: 'new' })

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

console.log('\x1b[36m%s\x1b[0m', '开始计时')
console.time('download time')

extractingImages(targetCrawlingWebPageLink)

/**
 * @description 图片提取
 * @param {string} link
 */
async function extractingImages(link) {
  // 启动一个新的浏览器实例
  const browser = await puppeteer.launch({ headless: 'new' })
  // 创建一个新的页面
  const page = await browser.newPage()
  // 导航到您想要获取HTML的网址
  await page.goto(link)
  // 等待确保页面加载完成
  await page.waitForSelector('body')
  // 获取页面标题
  const title = await page.title()
  console.log('title: ', title)
  // 选择要保存的图片元素的选择器
  const imageSelector = 'img' // 这里使用了一个简单的选择器，您可以根据需要自定义选择器

  if (!targetDownloadFolderPath) {
    targetDownloadFolderPath = `./download/${validateAndModifyFileName(`${title}`)}`
  }

  // 获取页面中匹配选择器的所有图片元素
  const images = await page.$$eval(imageSelector, (elements) => {
    const images = elements.map((element) => element.src)
    return Array.from(new Set(images))
  })

  console.log('images: ', images)
  console.log('images: ', images.length)

  switch (downloadMode) {
    case 'downloadAllImages':
      installImages(images, targetDownloadFolderPath, maxConcurrentRequests, maxIntervalMs, minIntervalMs)
      break
    case 'downloadOriginImagesByThumbnails':
      const originalImageUrls = images.map((imageUrl) => {
        return generateOriginalImageUrl(imageUrl)
      })
      console.log('originalImageUrls: ', originalImageUrls)
      installImages(originalImageUrls, targetDownloadFolderPath, maxConcurrentRequests, maxIntervalMs, minIntervalMs)
      break
  }

  await browser.close()
}

/**
 * 下载图片
 * @param {string} imageUrls 图片链接集合
 * @param {string} targetDownloadFolderPath 目标下载文件夹路径
 * @param {string} maxConcurrentRequests 最大并发请求数（每一轮）
 * @param {string} maxIntervalMs 最大请求间隔时间（毫秒）
 * @param {string} minIntervalMs 最小请求间隔时间（毫秒）
 */
async function installImages(
  imageUrls,
  targetDownloadFolderPath,
  maxConcurrentRequests = 6,
  maxIntervalMs = 0,
  minIntervalMs = 0
) {
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

        const fileName = validateAndModifyFileName(`IMG_${getNowDate()}_${extractUrlFileNames(imageUrl)}`)

        await download(page, fileName, imageUrl)

        requestedImageUrls.push(imageUrl)
      })
    )
    // 请求的结束时间（每一轮）
    endTime = Date.now() % 10000

    randomInterval = Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1) + minIntervalMs)
  }

  console.log('\x1b[32m%s\x1b[0m', `共发送了 ${requestedImageUrls.length} 次请求`)

  /**
   * 图片下载
   * @param {string} page
   * @param {string} fileName
   * @param {string} imageUrl
   * @returns
   */
  async function download(page, fileName, imageUrl) {
    // 构造目标文件的完整路径
    const targetFilePath = path.join(targetDownloadFolderPath, fileName)

    return new Promise(async (resolve) => {
      // 设置访问图片的超时时间为 60 秒
      const timeoutMilliseconds = 1000 * 60

      // 使用 page.goto 导航到图片的URL
      try {
        const imageBuffer = await page
          .goto(imageUrl, { timeout: timeoutMilliseconds })
          .then((response) => response.buffer())
        console.log('imageBuffer: ', imageBuffer)
        successHandler(imageBuffer, targetFilePath, imageUrl, resolve)
      } catch (error) {
        errorHandler(error)
        resolve()
      }
    })
  }

  // 成功请求处理器
  function successHandler(imageBuffer, targetFilePath, imageUrl, resolve) {
    saveFile(imageBuffer, targetFilePath, imageUrl, resolve)
    // 请求成功 +1
    requestSuccessfullyCount++
  }

  // 错误请求处理器
  function errorHandler(error, imageUrl) {
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
      return console.log('error', error)
    }

    // 判断是否已经处理完所有照片
    isFinished()
  }

  /**
   * 保存文件
   * @param buffer buffer
   */
  async function saveFile(imageBuffer, targetFilePath, imageUrl, resolve) {
    try {
      await fs.promises.writeFile(targetFilePath, imageBuffer)
      // 下载成功 +1
      downloadSuccessfullyCount++
      console.log('下载成功: ', downloadSuccessfullyCount)
      console.log('\x1b[32m%s\x1b[0m', `已下载 ${downloadSuccessfullyCount} 张`)
      resolve()
    } catch (error) {
      requestFailedImages.push(imageUrl)
      // 下载失败 +1
      downloadFailedCount++
      console.log('下载失败: ', downloadFailedCount)
      console.log('保存失败：', error)
      resolve()
    }

    // 判断是否已经处理完所有照片
    isFinished()
    console.log('-----------------------------------------------')
  }

  // 判断是否已经处理完所有照片
  function isFinished() {
    // 如果保存成功的数量 + 保存失败的数量 == 已请求图片的总数量，那就说明本次服务到此可以结束了
    if (downloadSuccessfullyCount + downloadFailedCount == imageCount) {
      console.log('downloadSuccessfullyCount + downloadFailedCount: ', downloadSuccessfullyCount + downloadFailedCount)
      finallyHandler()
    }
  }
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

  if (requestFailedImages.length) {
    console.log('requestFailedImages: ', requestFailedImages)
    requestAgain()
  } else {
    // 关闭浏览器
    globalBrowser.close()
    console.timeEnd('download time')
    console.log('\x1b[36m%s\x1b[0m', '计时结束')
  }
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
  function request() {
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

    installImages(
      requestFailedImagesClone,
      targetDownloadFolderPath,
      maxConcurrentRequests,
      maxIntervalMs,
      minIntervalMs
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
      if (fileName.includes('?')) {
        fileName = fileName.split('?')[0]
      }
      return fileName
    } catch (error) {
      console.log('url', url)
      console.log('提取链接中的文件名 Error', error)
    }
  }
}
