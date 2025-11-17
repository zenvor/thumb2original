/**
 * 数据库内容检查脚本
 * 快速查看数据库中存储了哪些数据
 */

import { ImageAnalysisDB } from './lib/database/ImageAnalysisDB.js'
import { scraperConfig } from './config/config.js'

async function checkDatabase() {
  const dbPath = scraperConfig.database.path

  console.log('========== 数据库内容检查 ==========\n')
  console.log(`数据库路径: ${dbPath}\n`)

  try {
    const db = new ImageAnalysisDB(dbPath)
    await db.init()

    // 获取数据库统计
    const stats = db.getStats()
    console.log('📊 数据库统计:')
    console.log(`  任务数: ${stats.taskCount}`)
    console.log(`  图片数: ${stats.imageCount}`)
    console.log(`  数据库大小: ${stats.dbSizeMB} MB\n`)

    if (stats.taskCount === 0) {
      console.log('❌ 数据库为空，没有任何任务记录\n')
      console.log('提示: 确保配置中 database.enabled = true')
      db.close()
      return
    }

    // 获取所有任务
    const allTasks = db.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT 10').all()

    console.log('📋 最近的任务 (最多显示10个):')
    console.log('─'.repeat(80))

    for (const task of allTasks) {
      const createdAt = new Date(task.created_at).toLocaleString('zh-CN')
      const metadata = task.metadata ? JSON.parse(task.metadata) : {}

      console.log(`\n任务 ID: ${task.id}`)
      console.log(`  URL: ${task.url}`)
      console.log(`  模式: ${task.mode}`)
      console.log(`  状态: ${task.status}`)
      console.log(`  创建时间: ${createdAt}`)
      console.log(`  图片总数: ${task.total_images}`)
      console.log(`  已分析: ${task.analyzed_images}`)

      if (metadata.formatCounts) {
        const formats = Object.entries(metadata.formatCounts)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ')
        console.log(`  格式分布: ${formats}`)
      }

      // 显示该任务的图片
      const images = db.getImagesByTask(task.id, false)
      console.log(`  存储图片数: ${images.length}`)

      if (images.length > 0) {
        console.log('  图片列表:')
        images.slice(0, 5).forEach((img, idx) => {
          const sizeKB = Math.round(img.size / 1024)
          console.log(`    [${img.sequence_number || idx + 1}] ${img.format} ${img.width}x${img.height} (${sizeKB}KB)`)
        })
        if (images.length > 5) {
          console.log(`    ... 还有 ${images.length - 5} 张图片`)
        }
      }
    }

    console.log('\n' + '─'.repeat(80))
    console.log('\n✅ 数据库检查完成\n')

    // 验证 buffer 是否存在
    if (allTasks.length > 0) {
      const firstTask = allTasks[0]
      const images = db.getImagesByTask(firstTask.id, true)

      if (images.length > 0) {
        const hasBuffer = images.every(img => img.buffer && img.buffer.length > 0)
        console.log('🔍 Buffer 验证:')
        console.log(`  任务 ${firstTask.id} 的所有图片都有 buffer: ${hasBuffer ? '✅ 是' : '❌ 否'}`)

        if (hasBuffer) {
          const totalSize = images.reduce((sum, img) => sum + img.buffer.length, 0)
          console.log(`  总 buffer 大小: ${(totalSize / 1024 / 1024).toFixed(2)} MB`)
        }
      }
    }

    db.close()
  } catch (error) {
    console.error('❌ 检查失败:', error.message)
    if (error.code === 'ENOENT') {
      console.log('\n提示: 数据库文件不存在，请先运行一次提取任务')
    }
  }
}

checkDatabase()
