/**
 * 数据库功能配置示例
 *
 * 这个文件展示了如何启用和配置 SQLite 数据库功能
 * 用于在 twoPhaseApi 模式下持久化存储图片分析结果
 */

import { scraperConfig } from './config.js'

// 启用数据库的配置示例
export const databaseConfig = {
  ...scraperConfig,

  // 关键：必须设置为 twoPhaseApi 模式
  analysis: {
    ...scraperConfig.analysis,
    mode: 'twoPhaseApi',  // 仅分析，不下载（适合 API 使用）
  },

  // 启用数据库配置
  database: {
    enabled: true,                      // 启用数据库存储
    path: './data/analysis.db',         // 数据库文件路径
    enableWAL: true,                    // 启用 WAL 模式（提高并发性能）
    retentionHours: 24,                 // 数据保留 24 小时
    autoCleanup: true,                  // 自动清理过期数据
    cleanupInterval: 3600000,           // 清理间隔 1 小时（毫秒）
  },
}

/**
 * 使用示例：
 *
 * 1. 基本使用（分析并存储）：
 *    启动爬虫后，图片会自动分析并存储到数据库
 *    不会下载到文件系统
 *
 * 2. 获取分析结果：
 *    分析完成后，通过返回的 taskId 获取图片数据
 *
 * 3. 读取图片 Buffer：
 *    使用 getImagesWithBuffers(taskId) 方法
 *
 * 代码示例：
 *
 * ```javascript
 * import { ImageAnalysisDB } from './lib/database/ImageAnalysisDB.js'
 *
 * // 初始化数据库
 * const db = new ImageAnalysisDB('./data/analysis.db')
 * await db.init()
 *
 * // 获取任务信息
 * const task = db.getTask(taskId)
 * console.log(task)
 *
 * // 获取所有图片（带 Buffer）
 * const images = db.getImagesWithBuffers(taskId)
 * for (const img of images) {
 *   console.log(`${img.url}: ${img.format} ${img.width}x${img.height}`)
 *   // img.buffer 可以直接使用
 * }
 *
 * // 获取数据库统计
 * const stats = db.getStats()
 * console.log(`任务数: ${stats.taskCount}, 图片数: ${stats.imageCount}`)
 *
 * // 手动清理过期数据
 * const deleted = db.cleanupOldTasks(24) // 删除 24 小时前的任务
 * console.log(`清理了 ${deleted} 个过期任务`)
 *
 * // 关闭数据库
 * db.close()
 * ```
 */

/**
 * 注意事项：
 *
 * 1. 数据库文件位置：
 *    默认在 ./data/analysis.db
 *    确保目录存在或程序有创建权限
 *
 * 2. 性能优化：
 *    - WAL 模式提高并发性能
 *    - 批量插入用于内存缓存
 *    - 单个数据库文件可存储数百万张图片
 *
 * 3. 数据清理：
 *    - 自动清理基于 retentionHours 配置
 *    - 可以手动调用 cleanupOldTasks() 清理
 *    - 删除任务会级联删除关联的图片
 *
 * 4. 备份：
 *    - 只需复制 .db 文件即可备份
 *    - WAL 模式下还有 .db-wal 和 .db-shm 文件
 *    - 建议在数据库关闭后再备份
 *
 * 5. 与临时文件的关系：
 *    - 数据库和临时文件并存
 *    - 临时文件作为降级方案
 *    - 优先从数据库读取 Buffer
 */
