/**
 * 图片缓存 - 临时缓存图片 Buffer（用于下载端点）
 * 仅在 advanced 模式下使用
 */

export class ImageCache {
  constructor() {
    // extractionId -> Map<imageId, {buffer, metadata, timestamp}>
    this.cache = new Map()
  }

  /**
   * 缓存图片
   */
  set(extractionId, imageId, buffer, metadata) {
    if (!this.cache.has(extractionId)) {
      this.cache.set(extractionId, new Map())
    }

    const extractionCache = this.cache.get(extractionId)
    extractionCache.set(imageId, {
      buffer,
      metadata,
      timestamp: Date.now()
    })
  }

  /**
   * 获取单张图片
   */
  get(extractionId, imageId) {
    const extractionCache = this.cache.get(extractionId)
    if (!extractionCache) return null

    return extractionCache.get(imageId) || null
  }

  /**
   * 获取提取任务的所有图片
   */
  getAll(extractionId) {
    const extractionCache = this.cache.get(extractionId)
    if (!extractionCache) return []

    return Array.from(extractionCache.entries()).map(([imageId, data]) => ({
      imageId,
      ...data
    }))
  }

  /**
   * 获取多张图片
   */
  getMultiple(extractionId, imageIds) {
    const extractionCache = this.cache.get(extractionId)
    if (!extractionCache) return []

    return imageIds
      .map(imageId => {
        const data = extractionCache.get(imageId)
        return data ? { imageId, ...data } : null
      })
      .filter(Boolean)
  }

  /**
   * 删除提取任务的所有图片
   */
  delete(extractionId) {
    return this.cache.delete(extractionId)
  }

  /**
   * 清理过期缓存
   */
  cleanup(olderThanMs = 3600000) {
    const now = Date.now()
    let deletedCount = 0

    for (const [extractionId, extractionCache] of this.cache.entries()) {
      let hasValidImages = false

      for (const [imageId, data] of extractionCache.entries()) {
        if (now - data.timestamp > olderThanMs) {
          extractionCache.delete(imageId)
          deletedCount++
        } else {
          hasValidImages = true
        }
      }

      // 如果该提取任务的所有图片都已过期，删除整个提取任务
      if (!hasValidImages) {
        this.cache.delete(extractionId)
      }
    }

    return deletedCount
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    let totalImages = 0
    let totalSize = 0

    for (const extractionCache of this.cache.values()) {
      totalImages += extractionCache.size
      for (const data of extractionCache.values()) {
        if (data.buffer) {
          totalSize += data.buffer.length
        }
      }
    }

    return {
      extractionCount: this.cache.size,
      imageCount: totalImages,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
    }
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this.cache.clear()
  }
}
