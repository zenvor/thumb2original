import axios from 'axios'
import { logger } from '../../utils/logger.js'

/**
 * @description 使用 Axios 下载图片（单次，不含重试）。
 * @param {string} imageUrl 图片 URL
 * @param {object} headers 请求头
 * @param {number} timeout 超时时间（毫秒）
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>}
 */
export async function axiosDownloadOnce(imageUrl, headers, timeout) {
  try {
    const response = await axios({ url: imageUrl, responseType: 'arraybuffer', timeout, headers })
    const contentType = response.headers['content-type']
    if (contentType && contentType.includes('text/html')) {
      logger.info(`Axios 检测到 HTML 内容，将回退到其他策略: ${imageUrl}`)
      return null
    }
    logger.success(`Axios 下载成功: ${imageUrl}`)
    return { buffer: Buffer.from(response.data), finalUrl: imageUrl, headers: response.headers }
  } catch (error) {
    logger.warn(`Axios 下载失败: ${imageUrl} - ${error.code || error.message}`)
    return null
  }
}


