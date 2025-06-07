import sharp from 'sharp'
import { ConsolaLogger as Logger } from '../../logger/ConsolaLogger.js'

// 获取全局logger实例
const logger = Logger.getGlobal()

/**
 * 图像转换工具类
 * 统一的图像格式转换和处理逻辑
 */
export class ImageConverter {
  /**
   * 检测 buffer 是否为 WebP 格式
   * @param {Buffer} buffer - 图像数据缓冲区
   * @returns {Promise<boolean>} 是否为 WebP 格式
   */
  static async isWebp(buffer) {
    try {
      // 使用 Sharp 的 metadata 方法获取图像的元数据
      const metadata = await sharp(buffer).metadata()

      // 检查图像类型是否为 WebP
      return metadata.format === 'webp'
    } catch (err) {
      // 处理错误
      logger.debug('WebP 格式检测失败:', err)
      return false
    }
  }

  /**
   * 将 WebP 格式转换为 PNG 格式
   * @param {Buffer} webpBuffer - WebP 图像数据缓冲区
   * @returns {Promise<Buffer|null>} PNG 格式的缓冲区，失败时返回 null
   */
  static async webpToPng(webpBuffer) {
    try {
      // 将 WebP buffer 转换为 PNG buffer
      const pngBuffer = await sharp(webpBuffer).toFormat('png').toBuffer()
      return pngBuffer
    } catch (error) {
      logger.error('WebP 转换失败', error)
      return null
    }
  }

  /**
   * 智能处理图像格式转换
   * @param {Buffer} buffer - 原始图像缓冲区
   * @param {string} filePath - 文件路径
   * @returns {Promise<{buffer: Buffer, filePath: string}>} 处理后的缓冲区和文件路径
   */
  static async processImage(buffer, filePath) {
    const isWebpImage = await this.isWebp(buffer)

    if (isWebpImage) {
      const convertedBuffer = await this.webpToPng(buffer)
      if (convertedBuffer) {
        // logger.success('WebP 转 PNG 转换成功')
        // 修改文件路径扩展名
        const updatedFilePath = filePath.replace('.webp', '.png')
        return { buffer: convertedBuffer, filePath: updatedFilePath }
      } else {
        logger.error('WebP 转 PNG 转换失败')
        return { buffer, filePath }
      }
    } else {
      // 非WebP图片直接返回，不输出调试信息（避免控制台信息冗余）
      return { buffer, filePath }
    }
  }
} 