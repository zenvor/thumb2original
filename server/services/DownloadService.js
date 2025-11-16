/**
 * 下载服务 - 处理图片下载请求
 */

import JSZip from 'jszip'
import { logger } from '../../utils/logger.js'

export class DownloadService {
  constructor(storage, imageCache) {
    this.storage = storage
    this.imageCache = imageCache
  }

  /**
   * 下载单张图片
   */
  async downloadSingle(extractionId, imageId) {
    // 验证任务存在且已完成
    const task = await this.storage.get(extractionId)
    if (!task) {
      throw new Error('Extraction task not found')
    }

    if (task.status !== 'done') {
      throw new Error(`Extraction task is not done yet (status: ${task.status})`)
    }

    if (task.options.mode !== 'advanced') {
      throw new Error('Download is only available for advanced mode extractions')
    }

    // 获取图片
    const imageData = this.imageCache.get(extractionId, imageId)
    if (!imageData) {
      throw new Error('Image not found in cache')
    }

    // 确定 Content-Type
    const contentType = this.getContentType(imageData.metadata.format)

    // 确定文件名
    const filename = imageData.metadata.basename || `image.${imageData.metadata.format}`

    return {
      buffer: imageData.buffer,
      contentType,
      filename
    }
  }

  /**
   * 下载多张图片（ZIP）
   */
  async downloadMultiple(extractionId, imageIds) {
    // 验证任务存在且已完成
    const task = await this.storage.get(extractionId)
    if (!task) {
      throw new Error('Extraction task not found')
    }

    if (task.status !== 'done') {
      throw new Error(`Extraction task is not done yet (status: ${task.status})`)
    }

    if (task.options.mode !== 'advanced') {
      throw new Error('Download is only available for advanced mode extractions')
    }

    // 获取图片
    const images = this.imageCache.getMultiple(extractionId, imageIds)
    if (images.length === 0) {
      throw new Error('No images found in cache')
    }

    // 生成 ZIP
    const zipBuffer = await this.generateZip(images)

    // 生成文件名
    const domain = this.extractDomain(task.url)
    const timestamp = Date.now()
    const filename = `${domain}-${timestamp}.zip`

    return {
      buffer: zipBuffer,
      contentType: 'application/zip',
      filename
    }
  }

  /**
   * 生成 ZIP 压缩包
   */
  async generateZip(images) {
    const zip = new JSZip()

    // 用于处理文件名冲突
    const filenameCount = new Map()

    for (const image of images) {
      let filename = image.metadata.basename || `image.${image.metadata.format}`

      // 处理文件名冲突
      if (filenameCount.has(filename)) {
        const count = filenameCount.get(filename)
        filenameCount.set(filename, count + 1)

        const nameParts = filename.split('.')
        const extension = nameParts.pop()
        const baseName = nameParts.join('.')
        filename = `${baseName}-${count}.${extension}`
      } else {
        filenameCount.set(filename, 1)
      }

      zip.file(filename, image.buffer)
    }

    // 生成 ZIP Buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6
      }
    })

    return zipBuffer
  }

  /**
   * 根据图片格式获取 Content-Type
   */
  getContentType(format) {
    const mimeTypes = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'bmp': 'image/bmp',
      'ico': 'image/x-icon',
      'tiff': 'image/tiff'
    }

    return mimeTypes[format.toLowerCase()] || 'application/octet-stream'
  }

  /**
   * 从 URL 提取域名
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url)
      return urlObj.hostname.replace(/^www\./, '')
    } catch {
      return 'images'
    }
  }
}
