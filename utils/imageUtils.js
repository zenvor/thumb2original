import sharp from 'sharp'
import { logger } from './logger.js'

// 支持的图片格式常量
export const SUPPORTED_FORMATS = {
  JPEG: 'jpeg',
  PNG: 'png',
  GIF: 'gif',
  WEBP: 'webp',
  BMP: 'bmp',
  TIFF: 'tiff',
  SVG: 'svg'
}

// 图片质量配置
export const QUALITY_PRESETS = {
  LOW: { jpeg: 60, webp: 50, png: 6 },
  MEDIUM: { jpeg: 80, webp: 70, png: 4 },
  HIGH: { jpeg: 90, webp: 85, png: 2 },
  LOSSLESS: { jpeg: 100, webp: 100, png: 0 }
}

/**
 * @description 从给定的 Buffer 中识别图像格式。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @returns {string} 图像格式 ('jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff', 'svg', 'Unknown')。
 */
export function identifyImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return 'Unknown'
  
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return SUPPORTED_FORMATS.JPEG
  
  // PNG
  if (buffer[0] === 0x89 && buffer.toString('utf8', 1, 4) === 'PNG') return SUPPORTED_FORMATS.PNG
  
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return SUPPORTED_FORMATS.GIF
  
  // WebP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) return SUPPORTED_FORMATS.WEBP
  
  // BMP
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return SUPPORTED_FORMATS.BMP
  
  // TIFF (Little Endian)
  if (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) return SUPPORTED_FORMATS.TIFF
  
  // TIFF (Big Endian)
  if (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a) return SUPPORTED_FORMATS.TIFF
  
  // SVG
  const svgStart = buffer.toString('utf8', 0, Math.min(100, buffer.length)).toLowerCase()
  if (svgStart.includes('<svg') || svgStart.includes('<?xml')) return SUPPORTED_FORMATS.SVG
  
  return 'Unknown'
}

/**
 * @description 获取图片的元数据信息。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @returns {Promise<object|null>} 图片元数据，包含宽度、高度、格式、大小等信息。
 */
export async function getImageMetadata(buffer) {
  try {
    const metadata = await sharp(buffer).metadata()
    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: buffer.length,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
      density: metadata.density,
      colorspace: metadata.space
    }
  } catch (error) {
    logger.error(`获取图片元数据失败: ${error.message}`)
    return null
  }
}

/**
 * @description 从 URL 中提取文件名，并使用 Buffer 分析来确定正确的文件扩展名。
 * @param {string} url - 图像的 URL。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @returns {string} 带有正确扩展名的完整文件名。
 */
export function getFileNameFromUrl(url, buffer) {
  const urlPath = url.split('?')[0]
  const baseName = urlPath.split('/').pop()
  const nameWithoutExt = baseName.includes('.') ? baseName.substring(0, baseName.lastIndexOf('.')) : baseName
  const extension = identifyImageFormat(buffer)
  return `${nameWithoutExt}.${extension}`
}

/**
 * @description 将 WebP 格式的 Buffer 转换为 PNG 格式。
 * @param {Buffer} webpBuffer - WebP 图像的 Buffer。
 * @returns {Promise<Buffer|null>} 转换后的 PNG Buffer，如果失败则返回 null。
 */
export async function convertWebpToPng(webpBuffer) {
  try {
    return await sharp(webpBuffer).toFormat('png').toBuffer()
  } catch (error) {
    logger.error(`WebP 到 PNG 转换失败: ${error.message}`)
    return null
  }
}

/**
 * @description 通用图片格式转换函数。
 * @param {Buffer} buffer - 原始图像 Buffer。
 * @param {string} targetFormat - 目标格式 ('jpeg', 'png', 'webp', 'tiff')。
 * @param {object} options - 转换选项，包含质量设置等。
 * @returns {Promise<Buffer|null>} 转换后的图像 Buffer。
 */
export async function convertImageFormat(buffer, targetFormat, options = {}) {
  try {
    let sharpInstance = sharp(buffer)
    
    switch (targetFormat.toLowerCase()) {
      case SUPPORTED_FORMATS.JPEG:
        sharpInstance = sharpInstance.jpeg({ 
          quality: options.quality || QUALITY_PRESETS.HIGH.jpeg,
          progressive: options.progressive !== false
        })
        break
      case SUPPORTED_FORMATS.PNG:
        sharpInstance = sharpInstance.png({ 
          compressionLevel: options.quality || QUALITY_PRESETS.HIGH.png,
          progressive: options.progressive !== false
        })
        break
      case SUPPORTED_FORMATS.WEBP:
        sharpInstance = sharpInstance.webp({ 
          quality: options.quality || QUALITY_PRESETS.HIGH.webp,
          lossless: options.lossless || false
        })
        break
      case SUPPORTED_FORMATS.TIFF:
        sharpInstance = sharpInstance.tiff({ 
          quality: options.quality || QUALITY_PRESETS.HIGH.jpeg
        })
        break
      default:
        throw new Error(`不支持的目标格式: ${targetFormat}`)
    }
    
    return await sharpInstance.toBuffer()
  } catch (error) {
    logger.error(`图片格式转换失败 (${targetFormat}): ${error.message}`)
    return null
  }
}

/**
 * @description 调整图片尺寸。
 * @param {Buffer} buffer - 原始图像 Buffer。
 * @param {object} options - 调整选项 { width, height, fit, background }。
 * @returns {Promise<Buffer|null>} 调整后的图像 Buffer。
 */
export async function resizeImage(buffer, options = {}) {
  try {
    const { width, height, fit = 'cover', background = { r: 255, g: 255, b: 255, alpha: 1 } } = options
    
    let sharpInstance = sharp(buffer)
    
    if (width || height) {
      sharpInstance = sharpInstance.resize({
        width,
        height,
        fit,
        background
      })
    }
    
    return await sharpInstance.toBuffer()
  } catch (error) {
    logger.error(`图片尺寸调整失败: ${error.message}`)
    return null
  }
}

/**
 * @description 压缩图片。
 * @param {Buffer} buffer - 原始图像 Buffer。
 * @param {string} quality - 质量预设 ('low', 'medium', 'high', 'lossless')。
 * @returns {Promise<Buffer|null>} 压缩后的图像 Buffer。
 */
export async function compressImage(buffer, quality = 'medium') {
  try {
    const format = identifyImageFormat(buffer)
    const qualitySettings = QUALITY_PRESETS[quality.toUpperCase()] || QUALITY_PRESETS.MEDIUM
    
    return await convertImageFormat(buffer, format, { quality: qualitySettings[format] })
  } catch (error) {
    logger.error(`图片压缩失败: ${error.message}`)
    return null
  }
}

/**
 * @description 检查图片是否损坏。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @returns {Promise<boolean>} 如果图片有效返回 true，否则返回 false。
 */
export async function validateImage(buffer) {
  try {
    await sharp(buffer).metadata()
    return true
  } catch (error) {
    logger.debug(`图片验证失败: ${error.message}`)
    return false
  }
}

/**
 * @description 获取图片的主要颜色。
 * @param {Buffer} buffer - 图像文件的 Buffer。
 * @param {number} colors - 要提取的颜色数量，默认为5。
 * @returns {Promise<Array|null>} 主要颜色数组，每个颜色包含 r, g, b 值和出现频率。
 */
export async function getDominantColors(buffer, colors = 5) {
  try {
    const { dominant } = await sharp(buffer)
      .resize(100, 100, { fit: 'cover' })
      .raw()
      .toBuffer({ resolveWithObject: true })
    
    // 这里简化实现，实际项目中可能需要更复杂的颜色分析算法
    return [{ r: dominant.r, g: dominant.g, b: dominant.b, frequency: 1.0 }]
  } catch (error) {
    logger.error(`获取主要颜色失败: ${error.message}`)
    return null
  }
}