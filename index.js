import fs from 'fs'
import axios from 'axios'
import fetch from 'node-fetch'
import path from 'path'
import cheerio from 'cheerio-without-node-native'
import { AbortController } from 'abort-controller'
// 链接匹配器
import { urlMatcher } from './url-matcher.js'
// 根据缩略图获取原图
import { generateOriginalImageLink } from './generate-original-image-link.js'
// 配置文件中的变量
import { downloadMode, retryInterval, thumbnailUrl, targetDownloadFolderPath } from './config.js'

// 辅助函数，从数组中获取随机项
const sample = (array) => array[Math.floor(Math.random() * array.length)]

const headers = [
  {
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="92", " Not A;Brand";v="99", "Google Chrome";v="92"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
  },
  {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.5',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:90.0) Gecko/20100101 Firefox/90.0',
  },
]

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

// 匹配链接
urlMatcher(thumbnailUrl).then((thumbnailUrls) => {
  if (!thumbnailUrls) return
  thumbnailUrls = Array.from(new Set(thumbnailUrls))
  switch (downloadMode) {
    case 'downloadAllImages':
      installImages(thumbnailUrls, targetDownloadFolderPath)
      break
    case 'downloadSomeSpecificImages':
      installImages(thumbnailUrls, targetDownloadFolderPath)
      break
    case 'downloadOriginImagesByThumbnails':
      const originalImageUrls = thumbnailUrls.map((item) => {
        return generateOriginalImageLink(item)
      })

      console.log('originalImageUrls: ', originalImageUrls.length)
      installImages(originalImageUrls, targetDownloadFolderPath)
      break
  }
})

/**
 * 下载图片
 * @param {string} urls 图片链接集合
 * @param {string} targetDownloadFolderPath 目标下载文件夹路径
 */
async function installImages(urls, targetDownloadFolderPath, maxIntervalMs = 500, minIntervalMs = 0) {
  if (!fs.existsSync(targetDownloadFolderPath)) {
    console.log(`没有检测到"${targetDownloadFolderPath}"文件夹`)
    fs.mkdirSync(targetDownloadFolderPath, { recursive: true })
    console.log('文件夹创建成功')
  }

  // 已请求过的图片链接集合
  const requestedImageUrls = []
  // 总照片数(待处理的请求总数)
  imageCount = urls.length
  for (const url of urls) {
    const fileName = `IMG_${extractUrlFileNames(url)}`
    /* 随机化请求间隔：为了更好地模拟真实用户的行为，在请求之间添加随机的时间间隔，
    而不是固定的间隔。这可以减少模式化的请求，降低被识别为爬虫的概率。 */
    await download('axios', fileName, url, {
      responseType: 'arraybuffer',
      timeout: 1000 * 10,
      headers: sample(headers),
    })
    // 随机请求间隔（毫秒）
    const randomInterval = Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1) + minIntervalMs)
    console.log('随机请求间隔: ', `${randomInterval}ms`)
    // 设置请求间隔：在发送连续请求之间添加固定的时间间隔，以减缓请求的频率。
    await new Promise((resolve) => setTimeout(resolve, randomInterval))

    requestedImageUrls.push(url)
  }
  console.log('\x1b[32m%s\x1b[0m', `共发送了 ${requestedImageUrls.length} 次请求`)

  /**
   * 图片下载
   * @param {string} requester
   * @param {string} fileName
   * @param {string} url
   * @param {string} options
   * @returns
   */
  function download(requester, fileName, url, options) {
    return new Promise(async (resolve) => {
      // 构造目标文件的完整路径
      const targetFilePath = path.join(targetDownloadFolderPath, fileName)

      switch (requester) {
        case 'axios':
          try {
            const { data: buffer } = await axios({ url, ...options })
            successHandler(buffer)
          } catch (error) {
            errorHandler(error)
          }
          break
        case 'fetch':
          try {
            const response = await fetchWithTimeout(url)
            const buffer = Buffer.from(await response.buffer())
            console.log('buffer: ', buffer)
            successHandler(buffer)
          } catch (error) {
            errorHandler(error)
          }
          break
      }

      // 成功请求处理器
      function successHandler(buffer) {
        resolve()
        saveFile(buffer)
        // 请求成功 +1
        requestSuccessfullyCount++
        // console.log('图片访问成功', url)
      }

      // 错误请求处理器
      function errorHandler(error) {
        reject()
        requestFailedImages.push(url)
        // 请求失败 +1
        requestFailedCount++
        console.log('请求失败: ', requestFailedCount)
        // 下载失败 +1
        downloadFailedCount++
        console.log('请求失败/下载失败: ', downloadFailedCount)
        console.log('errorStatus', error?.response?.status)
        console.log('errorStatusText: ', error?.response?.statusText)
        console.log(`访问图片时发生错误：`, url)
        console.log('错误请求集合个数: ', requestFailedImages.length)

        // 判断是否已经处理完所有照片
        isFinished()
      }

      /**
       * 保存文件
       * @param buffer buffer
       */
      async function saveFile(buffer) {
        try {
          await fs.promises.writeFile(targetFilePath, buffer)
          // 下载成功 +1
          downloadSuccessfullyCount++
          console.log('下载成功: ', downloadSuccessfullyCount)
          console.log('\x1b[32m%s\x1b[0m', `已下载 ${downloadSuccessfullyCount} 张`)
        } catch (error) {
          requestFailedImages.push(url)
          // 下载失败 +1
          downloadFailedCount++
          console.log('下载失败: ', downloadFailedCount)
          console.log('保存失败：', error)
        }

        // 判断是否已经处理完所有照片
        isFinished()
        console.log('-----------------------------------------------')
      }

      // 判断是否已经处理完所有照片
      function isFinished() {
        // 如果保存成功的数量 + 保存失败的数量 == 已请求图片的总数量，那就说明本次服务到此可以结束了
        if (downloadSuccessfullyCount + downloadFailedCount == imageCount) {
          console.log(
            'downloadSuccessfullyCount + downloadFailedCount: ',
            downloadSuccessfullyCount + downloadFailedCount
          )
          finallyHandler()
        }
      }
    })
  }
}

// 最终处理器
function finallyHandler() {
  console.log('\x1b[34m%s\x1b[0m', `共 ${imageCount} 张图片`)
  console.log('\x1b[32m%s\x1b[0m', `已成功访问 ${requestSuccessfullyCount} 张`)
  console.log('\x1b[31m%s\x1b[0m', `失败访问 ${requestFailedCount} 张`)
  console.log('\x1b[32m%s\x1b[0m', `${downloadSuccessfullyCount} 张下载成功`)
  console.log('\x1b[31m%s\x1b[0m', `${downloadFailedCount} 张下载失败`)

  if (requestFailedImages.length) {
    requestAgain()
  } else {
    console.timeEnd('download time')
    console.log('\x1b[36m%s\x1b[0m', '计时结束')
  }
}

// 重试机制： 重新下载请求失败的图片，可以确保爬虫能够处理请求失败的情况。
function requestAgain() {
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
    asynchronousRequestList = []

    installImages(requestFailedImagesClone, targetDownloadFolderPath)
  }
}

/**
 * 有超时功能的fetch
 * @param {string} url
 * @param {object} options
 * @param {number} timeout
 * @returns
 */
function fetchWithTimeout(url, options, timeout = 1000 * 10) {
  return new Promise(async (resolve, reject) => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
    }, timeout)

    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
      clearTimeout(timeoutId) // 取消超时定时器
      resolve(response)
    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('请求超时')
      } else {
        console.log('请求错误：', error.code)
      }
      clearTimeout(timeoutId) // 取消超时定时器
      reject(error)
    }
  })
}

/**
 * 提取链接中的文件名
 * @param {string} url
 * @returns
 */
function extractUrlFileNames(url) {
  const slashString = url.lastIndexOf('/')
  const fileName = url.substring(slashString + 1)
  return fileName
}

function date() {
  const date = new Date()
  const year = date.getFullYear()
  const month = date.getMonth() + 1 < 10 ? `0${date.getMonth() + 1}` : date.getMonth() + 1
  const day = date.getDate() < 10 ? `0${date.getDate()}` : date.getDate()
  return `${year}_${month}_${day}`
}
