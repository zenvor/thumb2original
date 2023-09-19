import fs from 'fs'
import axios from 'axios'
import { generateRegex } from './generate-regex.js'
import { parseImageUrl } from './parse-image-url.js'
import { runningMode, downloadMode, targetCrawlingWebPageLink, targetReadFilePath } from './config.js'

/**
 * 链接匹配器
 * @param {string} url
 * @returns
 */
export function urlMatcher(url) {
  return new Promise(async (resolve) => {
    let regex

    if (downloadMode != 'downloadAllImages') {
      const parsedInfo = parseImageUrl(url)
      const { protocol, domain, fileExtension } = parsedInfo
      console.log('协议: ' + protocol, '\n域名: ' + domain, '\n文件扩展名: ' + fileExtension)
      // 匹配特定的某些图片链接
      regex = generateRegex(protocol, domain, fileExtension)
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

    if (downloadMode == 'downloadAllImages') {
      // 匹配所有图片链接
      // const imageRegex = /(?<=(img[^>]*src="))[^"]*/g
      // const matchUrls = content.match(imageRegex)

      // FIXME: 需要适配 parseFile 模式的链接
      const imageRegex = /<img [^>]*src=['"](https?:\/\/[^'"]+\.(jpeg|jpg|gif|png|bmp|svg|webp|jpg_webp))['"][^>]*>/ig;
      const matches = [...content.matchAll(imageRegex)]
      const matchUrls = matches.map((match) => match[1])

      console.log('matchUrls: ', matchUrls)
      console.log('matchUrls: ', matchUrls.length)

      resolve(matchUrls)
    } else {
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
