import fs from 'fs'
import axios from 'axios'
import { generateRegex } from './generate-regex.js'
import { parseImageUrl } from './parse-image-url.js'
import { runningMode, downloadMode, targetCrawlingWebPageLink, targetReadFilePath } from '../config.js'

/**
 * 链接匹配器
 * @param {string} url
 * @returns
 */
export function urlMatcher(url) {
  return new Promise(async (resolve) => {
    let regex

    if (
      (downloadMode == 'downloadSomeSpecificImages' && url) ||
      (downloadMode == 'downloadOriginImagesByThumbnails' && url)
    ) {
      const parsedInfo = parseImageUrl(url)
      const { protocol, domain, fileExtension } = parsedInfo
      console.log('协议: ' + protocol, '\n域名: ' + domain, '\n文件扩展名: ' + fileExtension)
      // 匹配特定的某些图片链接
      regex = generateRegex(protocol, domain, fileExtension)
    } else if (downloadMode == 'downloadSomeSpecificImages' && !url) {
      console.log('请配置缩略图链接`thumbnailUrl`')
      return
    }

    // 文本数据，
    let content
    if (runningMode == 'parseWebPage') {
      // 获取网页内容
      content = await getWebContent()
    } else if (runningMode == 'parseFile') {
      try {
        // 读取文件内容
        content = await fs.promises.readFile(targetReadFilePath, { encoding: 'utf-8' })
      } catch (error) {
        console.log('文件读取失败', error)
      }
    }
    if (!content) return console.log('没有获取到任何内容')
    // FIXME: 需要适配 parseFile 模式的链接
    if ((downloadMode == 'downloadAllImages' && !url) || (downloadMode == 'downloadOriginImagesByThumbnails' && !url)) {
      // 方式一 匹配所有图片链接
      // const imageRegex = /(?<=(img[^>]*src="))[^"]*/g
      // const matchUrls = content.match(imageRegex)

      // 方式二 匹配所有图片链接
      const imageRegex =
        /<img [^>]*src=['"]((https?:\/\/)?[^'"]+\.(jpeg|jpg|gif|png|bmp|svg|webp|jpg_webp))['"][^>]*>/gi
      const matches = [...content.matchAll(imageRegex)]
      let matchUrls = matches.map((match) => match[1])

      const parsedInfo = parseImageUrl(targetCrawlingWebPageLink)
      const { protocol, domain } = parsedInfo
      matchUrls = matchUrls.map((url) => {
        if (!url.includes('http')) {
          return (url = `${protocol}//${domain}` + url)
        } else {
          return url
        }
      })
      resolve(matchUrls)
    } else if (
      (downloadMode == 'downloadOriginImagesByThumbnails' && url) ||
      (downloadMode == 'downloadSomeSpecificImages' && url)
    ) {
      const matchUrls = content.match(regex)
      if (!matchUrls) return console.log('没有匹配到任何链接')
      resolve(matchUrls)
    }
  })
}

// 获取网页内容
function getWebContent() {
  return new Promise((resolve, reject) => {
    axios
      .get(targetCrawlingWebPageLink)
      .then((response) => {
        console.log('response: ', response)
        resolve(response.data)
      })
      .catch((error) => {
        return console.error('发生错误：', error)
      })
  })
}
