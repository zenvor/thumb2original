/**
 * 图像格式检测工具类
 * 统一的图像格式检测和识别逻辑
 */
export class ImageFormatDetector {
  /**
   * 检测 buffer 是否为有效的图像格式
   * @param {Buffer} buffer - 图像数据缓冲区
   * @returns {boolean} 是否为图像格式
   */
  static isImageBuffer(buffer) {
    if (!buffer || buffer.length < 16) {
      return false
    }

    const bytes = new Uint8Array(buffer)
    const header = bytes.subarray(0, 16)

    // JPEG: 0xFFD8
    if (header[0] === 0xff && header[1] === 0xd8) {
      return true
    }
    // PNG: 0x89504E47
    else if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
      return true
    }
    // GIF: GIF89a 或 GIF87a
    else if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
      return true
    }
    // WebP: RIFF 和 WEBP
    else if (
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50
    ) {
      return true
    }
    // BMP: 0x424D
    else if (header[0] === 0x42 && header[1] === 0x4d) {
      return true
    }
    // TIFF: 0x49492A00 (小端) 或 0x4D4D002A (大端)
    else if (
      (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a && header[3] === 0x00) || // 小端
      (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0x00 && header[3] === 0x2a) // 大端
    ) {
      return true
    }

    return false // 不是图像
  }

  /**
   * 获取图像格式的字符串表示
   * @param {Buffer} buffer - 图像数据缓冲区
   * @returns {string} 图像格式名称 (jpeg, png, gif, webp, bmp, tiff) 或 'unknown'
   */
  static getImageFormat(buffer) {
    if (!buffer || buffer.length < 16) {
      return 'unknown'
    }

    const bytes = new Uint8Array(buffer)

    // JPEG: 0xFFD8
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      return 'jpeg'
    }
    // PNG: 0x89504E47 或者使用字符串检测
    else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
      return 'png'
    } else if (bytes[0] === 0x89 && buffer.toString('utf8', 1, 4) === 'PNG') {
      return 'png'
    }
    // GIF: GIF89a 或 GIF87a
    else if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
      return 'gif'
    }
    // WebP: RIFF 和 WEBP
    else if (
      bytes[0] === 0x52 && // R
      bytes[1] === 0x49 && // I
      bytes[2] === 0x46 && // F
      bytes[3] === 0x46 && // F
      bytes[8] === 0x57 && // W
      bytes[9] === 0x45 && // E
      bytes[10] === 0x42 && // B
      bytes[11] === 0x50 // P
    ) {
      return 'webp'
    }
    // BMP: 0x424D
    else if (bytes[0] === 0x42 && bytes[1] === 0x4d) {
      return 'bmp'
    }
    // TIFF: 0x49492A00 (小端) 或 0x4D4D002A (大端)
    else if (
      (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || // 小端
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) // 大端
    ) {
      return 'tiff'
    }

    return 'unknown'
  }
} 