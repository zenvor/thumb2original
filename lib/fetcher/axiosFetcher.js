import axios from 'axios'
import { logger } from '../../utils/logger.js'
import { shouldAcceptResponse } from '../../utils/contentPolicy.js'

/**
 * @description 使用 Axios 获取图片（单次，不含重试）。
 * @param {string} imageUrl 图片 URL
 * @param {object} headers 请求头
 * @param {number} timeout 超时时间（毫秒）
 * @param {{ acceptBinaryContentTypes: boolean|string[] }} [options] 内容可接受性策略配置
 * - options.acceptBinaryContentTypes: 参见 `utils/contentPolicy.js` 中的 AcceptBinaryContentTypes 语义
 * @returns {Promise<{buffer: Buffer, finalUrl: string, headers: object}|null>}
 */
export async function axiosFetchOnce(imageUrl, headers, timeout, options = {}) {
  // 输入验证
  if (!imageUrl || typeof imageUrl !== 'string') {
    logger.warn('Axios获取失败：无效的URL参数')
    return null
  }
  
  if (timeout && (typeof timeout !== 'number' || timeout <= 0)) {
    logger.warn('Axios获取失败：无效的超时参数')
    return null
  }
  
  try {
    const response = await axios({ url: imageUrl, responseType: 'arraybuffer', timeout, headers })
    const headersMap = response.headers || {}
    const contentType = headersMap['content-type']
    const ctLower = (contentType || '').toLowerCase()
    const ctBare = ctLower ? ctLower.split(';')[0].trim() : ''
    // HTML 一律回退（保留可读性日志）
    if (ctBare.includes('text/html')) {
      logger.info(
        `Axios 检测到 HTML 内容，将回退到其他策略: ${imageUrl}`,
        logger.categories.NETWORK,
        { ctBare: ctBare || '', finalUrl: imageUrl }
      )
      return null
    }
    const accept = options.acceptBinaryContentTypes
    const isAllowed = shouldAcceptResponse(headersMap, accept)
    if (!isAllowed) {
      logger.info(
        `Axios 响应类型不被允许，将回退: ${imageUrl}`,
        logger.categories.NETWORK,
        { ctBare: ctBare || '', finalUrl: imageUrl }
      )
      return null
    }

    logger.success(`Axios 访问成功: ${imageUrl}`)
    return { buffer: Buffer.from(response.data), finalUrl: imageUrl, headers: response.headers }
  } catch (error) {
    logger.warn(`Axios 访问失败: ${imageUrl} - ${error.code || error.message}`)
    return null
  }
}
