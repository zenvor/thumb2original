import Database from 'better-sqlite3'
import { migrate } from './schema.js'
import path from 'path'
import fs from 'fs/promises'
import { logger } from '../../utils/logger.js'

/**
 * 图片分析数据库管理类
 * 提供任务和图片的 CRUD 操作
 */
export class ImageAnalysisDB {
  /**
   * @param {string} dbPath - 数据库文件路径
   * @param {object} options - 配置选项
   */
  constructor(dbPath, options = {}) {
    this.dbPath = dbPath
    this.options = {
      enableWAL: true,           // 启用 WAL 模式（性能优化）
      retentionHours: 24,        // 数据保留时间（小时）
      ...options
    }

    this.db = null
    this._initialized = false
  }

  /**
   * 初始化数据库连接
   */
  async init() {
    if (this._initialized) return

    try {
      // 确保目录存在
      const dir = path.dirname(this.dbPath)
      await fs.mkdir(dir, { recursive: true })

      // 创建数据库连接
      this.db = new Database(this.dbPath)

      // 启用 WAL 模式（提高并发性能）
      if (this.options.enableWAL) {
        this.db.pragma('journal_mode = WAL')
      }

      // 执行 schema 迁移
      migrate(this.db)

      this._initialized = true
      logger.info(`数据库已初始化: ${this.dbPath}`)
    } catch (error) {
      logger.error(`数据库初始化失败: ${error.message}`)
      throw error
    }
  }

  /**
   * 关闭数据库连接
   */
  close() {
    if (this.db) {
      this.db.close()
      this._initialized = false
      logger.info('数据库连接已关闭')
    }
  }

  /**
   * 确保数据库已初始化
   */
  _ensureInitialized() {
    if (!this._initialized || !this.db) {
      throw new Error('数据库未初始化，请先调用 init() 方法')
    }
  }

  // ==================== 任务管理 ====================

  /**
   * 创建新任务
   * @param {string} taskId - 任务ID
   * @param {string} url - 原始 URL
   * @param {string} mode - 处理模式
   * @returns {object} 任务对象
   */
  createTask(taskId, url, mode) {
    this._ensureInitialized()
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, url, mode, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    stmt.run(taskId, url, mode, 'pending', now, now)

    logger.debug(`任务已创建: ${taskId}`)
    return { id: taskId, url, mode, status: 'pending', created_at: now }
  }

  /**
   * 更新任务状态
   * @param {string} taskId - 任务ID
   * @param {string} status - 新状态
   * @param {object} metadata - 元数据（可选）
   */
  updateTaskStatus(taskId, status, metadata = null) {
    const now = Date.now()
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET status = ?, updated_at = ?, metadata = ?
      WHERE id = ?
    `)

    const metadataJson = metadata ? JSON.stringify(metadata) : null
    stmt.run(status, now, metadataJson, taskId)

    logger.debug(`任务状态已更新: ${taskId} -> ${status}`)
  }

  /**
   * 更新任务图片计数
   * @param {string} taskId - 任务ID
   * @param {number} totalImages - 总图片数
   * @param {number} analyzedImages - 已分析数
   */
  updateTaskImageCount(taskId, totalImages, analyzedImages) {
    const stmt = this.db.prepare(`
      UPDATE tasks
      SET total_images = ?, analyzed_images = ?, updated_at = ?
      WHERE id = ?
    `)

    stmt.run(totalImages, analyzedImages, Date.now(), taskId)
  }

  /**
   * 获取任务信息
   * @param {string} taskId - 任务ID
   * @returns {object|null} 任务对象
   */
  getTask(taskId) {
    const stmt = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `)

    const task = stmt.get(taskId)
    if (task && task.metadata) {
      task.metadata = JSON.parse(task.metadata)
    }
    return task
  }

  /**
   * 删除任务（级联删除关联的图片）
   * @param {string} taskId - 任务ID
   * @returns {number} 删除的行数
   */
  deleteTask(taskId) {
    const stmt = this.db.prepare(`
      DELETE FROM tasks WHERE id = ?
    `)

    const result = stmt.run(taskId)
    logger.info(`任务已删除: ${taskId} (删除 ${result.changes} 条记录)`)
    return result.changes
  }

  // ==================== 图片管理 ====================

  /**
   * 保存图片到数据库
   * @param {string} taskId - 任务ID
   * @param {object} imageData - 图片数据
   * @returns {number} 插入的图片ID
   */
  saveImage(taskId, imageData) {
    this._ensureInitialized()

    if (!imageData.buffer || imageData.buffer.length === 0) {
      logger.error(`尝试保存空 buffer 到数据库: ${imageData.url}`)
      throw new Error(`Cannot save image without buffer: ${imageData.url}`)
    }

    const stmt = this.db.prepare(`
      INSERT INTO images (
        task_id, url, buffer, format, width, height, size,
        headers, sequence_number, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      taskId,
      imageData.url,
      imageData.buffer,
      imageData.metadata?.format || null,
      imageData.metadata?.width || null,
      imageData.metadata?.height || null,
      imageData.metadata?.size || null,
      imageData.headers ? JSON.stringify(imageData.headers) : null,
      imageData.sequenceNumber || null,
      Date.now()
    )

    logger.debug(`图片已保存到数据库: ${imageData.url} (ID: ${result.lastInsertRowid}, bufferSize: ${imageData.buffer.length})`)
    return result.lastInsertRowid
  }

  /**
   * 批量保存图片（使用事务优化性能）
   * @param {string} taskId - 任务ID
   * @param {Array} imagesData - 图片数据数组
   * @returns {number} 插入的图片数量
   */
  saveImageBatch(taskId, imagesData) {
    const insert = this.db.prepare(`
      INSERT INTO images (
        task_id, url, buffer, format, width, height, size,
        headers, sequence_number, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    const insertMany = this.db.transaction((images) => {
      for (const imageData of images) {
        insert.run(
          taskId,
          imageData.url,
          imageData.buffer,
          imageData.metadata?.format || null,
          imageData.metadata?.width || null,
          imageData.metadata?.height || null,
          imageData.metadata?.size || null,
          imageData.headers ? JSON.stringify(imageData.headers) : null,
          imageData.sequenceNumber || null,
          Date.now()
        )
      }
    })

    insertMany(imagesData)
    logger.info(`批量保存图片完成: ${imagesData.length} 张`)
    return imagesData.length
  }

  /**
   * 获取单张图片
   * @param {number} imageId - 图片ID
   * @param {boolean} includeBuffer - 是否包含 Buffer（默认 true）
   * @returns {object|null} 图片对象
   */
  getImage(imageId, includeBuffer = true) {
    const fields = includeBuffer
      ? '*'
      : 'id, task_id, url, format, width, height, size, headers, sequence_number, created_at'

    const stmt = this.db.prepare(`
      SELECT ${fields} FROM images WHERE id = ?
    `)

    const image = stmt.get(imageId)
    if (image && image.headers) {
      image.headers = JSON.parse(image.headers)
    }
    return image
  }

  /**
   * 通过 URL 获取图片
   * @param {string} taskId - 任务ID
   * @param {string} url - 图片 URL
   * @returns {object|null} 图片对象
   */
  getImageByUrl(taskId, url) {
    const stmt = this.db.prepare(`
      SELECT * FROM images WHERE task_id = ? AND url = ? LIMIT 1
    `)

    const image = stmt.get(taskId, url)
    if (image && image.headers) {
      image.headers = JSON.parse(image.headers)
    }
    return image
  }

  /**
   * 获取任务的所有图片
   * @param {string} taskId - 任务ID
   * @param {boolean} includeBuffer - 是否包含 Buffer（默认 false）
   * @returns {Array} 图片数组
   */
  getImagesByTask(taskId, includeBuffer = false) {
    this._ensureInitialized()
    const fields = includeBuffer
      ? '*'
      : 'id, task_id, url, format, width, height, size, headers, sequence_number, created_at'

    const stmt = this.db.prepare(`
      SELECT ${fields} FROM images
      WHERE task_id = ?
      ORDER BY sequence_number, id
    `)

    const images = stmt.all(taskId)
    return images.map(img => ({
      ...img,
      headers: img.headers ? JSON.parse(img.headers) : null
    }))
  }

  /**
   * 获取任务的所有图片（包含 Buffer）
   * 专用于下载阶段使用
   * @param {string} taskId - 任务ID
   * @returns {Array} 包含 Buffer 的图片数组
   */
  getImagesWithBuffers(taskId) {
    logger.debug(`从数据库获取图片 (taskId: ${taskId}, includeBuffer: true)`)
    const images = this.getImagesByTask(taskId, true)
    logger.info(`从数据库获取到 ${images.length} 张图片 (taskId: ${taskId})`)

    if (images.length > 0) {
      const firstImage = images[0]
      logger.debug(`第一张图片信息:`, {
        url: firstImage.url,
        hasBuffer: !!firstImage.buffer,
        bufferSize: firstImage.buffer?.length || 0,
        format: firstImage.format,
        dimensions: `${firstImage.width}x${firstImage.height}`
      })
    }

    return images
  }

  /**
   * 获取图片的 Buffer
   * @param {string} taskId - 任务ID
   * @param {string} url - 图片 URL
   * @returns {Buffer|null} Buffer 对象
   */
  getImageBuffer(taskId, url) {
    const image = this.getImageByUrl(taskId, url)
    return image ? image.buffer : null
  }

  // ==================== 清理和维护 ====================

  /**
   * 清理过期任务（基于保留时间）
   * @param {number} olderThanHours - 超过多少小时的任务（默认使用配置值）
   * @returns {number} 删除的任务数
   */
  cleanupOldTasks(olderThanHours = null) {
    const hours = olderThanHours || this.options.retentionHours
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000)

    const stmt = this.db.prepare(`
      DELETE FROM tasks WHERE created_at < ?
    `)

    const result = stmt.run(cutoffTime)
    logger.info(`清理过期任务: 删除 ${result.changes} 个任务（超过 ${hours} 小时）`)
    return result.changes
  }

  /**
   * 清理指定状态的任务
   * @param {string} status - 任务状态
   * @param {number} olderThanHours - 超过多少小时
   * @returns {number} 删除的任务数
   */
  cleanupTasksByStatus(status, olderThanHours = 24) {
    const cutoffTime = Date.now() - (olderThanHours * 60 * 60 * 1000)

    const stmt = this.db.prepare(`
      DELETE FROM tasks WHERE status = ? AND created_at < ?
    `)

    const result = stmt.run(status, cutoffTime)
    logger.info(`清理任务: 删除 ${result.changes} 个 ${status} 任务`)
    return result.changes
  }

  /**
   * 优化数据库（压缩和整理）
   */
  optimize() {
    logger.info('开始优化数据库...')
    this.db.pragma('optimize')
    this.db.exec('VACUUM')
    logger.info('数据库优化完成')
  }

  /**
   * 获取数据库统计信息
   * @returns {object} 统计信息
   */
  getStats() {
    const taskCount = this.db.prepare('SELECT COUNT(*) as count FROM tasks').get().count
    const imageCount = this.db.prepare('SELECT COUNT(*) as count FROM images').get().count
    const dbSize = this.db.prepare('SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()').get().size

    return {
      taskCount,
      imageCount,
      dbSize,
      dbSizeMB: (dbSize / 1024 / 1024).toFixed(2)
    }
  }
}

/**
 * 创建数据库实例（单例模式）
 */
let dbInstance = null

/**
 * 获取数据库实例（单例）
 * @param {object} config - 配置对象
 * @returns {ImageAnalysisDB} 数据库实例
 */
export function getDatabase(config) {
  if (!dbInstance) {
    const dbPath = config?.database?.path || './data/analysis.db'
    dbInstance = new ImageAnalysisDB(dbPath, {
      enableWAL: config?.database?.enableWAL !== false,
      retentionHours: config?.database?.retentionHours || 24
    })
  }

  return dbInstance
}

/**
 * 关闭数据库实例
 */
export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}
