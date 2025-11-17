/**
 * 数据库功能测试脚本
 * 验证 SQLite 数据库的基本功能
 */

import { ImageAnalysisDB } from './lib/database/ImageAnalysisDB.js'
import crypto from 'crypto'

async function testDatabase() {
  console.log('========== 数据库功能测试开始 ==========\n')

  // 1. 初始化数据库
  console.log('1. 初始化数据库...')
  const db = new ImageAnalysisDB('./data/test_analysis.db', {
    enableWAL: true,
    retentionHours: 24
  })
  await db.init()
  console.log('✅ 数据库初始化成功\n')

  // 2. 创建测试任务
  console.log('2. 创建测试任务...')
  const taskId = `test-${Date.now()}`
  const task = db.createTask(taskId, 'https://example.com/test', 'twoPhaseApi')
  console.log('✅ 任务已创建:', task)
  console.log()

  // 3. 保存测试图片
  console.log('3. 保存测试图片...')
  const testImages = [
    {
      url: 'https://example.com/image1.jpg',
      buffer: crypto.randomBytes(5 * 1024), // 5KB
      headers: { 'content-type': 'image/jpeg' },
      metadata: { format: 'jpeg', width: 800, height: 600, size: 5120 },
      sequenceNumber: 1
    },
    {
      url: 'https://example.com/image2.png',
      buffer: crypto.randomBytes(10 * 1024), // 10KB
      headers: { 'content-type': 'image/png' },
      metadata: { format: 'png', width: 1024, height: 768, size: 10240 },
      sequenceNumber: 2
    },
    {
      url: 'https://example.com/image3.webp',
      buffer: crypto.randomBytes(3 * 1024), // 3KB
      headers: { 'content-type': 'image/webp' },
      metadata: { format: 'webp', width: 640, height: 480, size: 3072 },
      sequenceNumber: 3
    }
  ]

  for (const img of testImages) {
    const imageId = db.saveImage(taskId, img)
    console.log(`  ✅ 图片 ${img.sequenceNumber} 已保存 (ID: ${imageId})`)
  }
  console.log()

  // 4. 测试批量保存
  console.log('4. 测试批量保存...')
  const batchImages = [
    {
      url: 'https://example.com/batch1.jpg',
      buffer: crypto.randomBytes(2 * 1024),
      headers: { 'content-type': 'image/jpeg' },
      metadata: { format: 'jpeg', width: 400, height: 300, size: 2048 },
      sequenceNumber: 4
    },
    {
      url: 'https://example.com/batch2.jpg',
      buffer: crypto.randomBytes(4 * 1024),
      headers: { 'content-type': 'image/jpeg' },
      metadata: { format: 'jpeg', width: 600, height: 400, size: 4096 },
      sequenceNumber: 5
    }
  ]
  db.saveImageBatch(taskId, batchImages)
  console.log(`✅ 批量保存完成: ${batchImages.length} 张图片\n`)

  // 5. 更新任务状态
  console.log('5. 更新任务状态...')
  db.updateTaskStatus(taskId, 'completed', {
    formatCounts: { jpeg: 3, png: 1, webp: 1 }
  })
  db.updateTaskImageCount(taskId, 5, 5)
  console.log('✅ 任务状态已更新\n')

  // 6. 读取任务信息
  console.log('6. 读取任务信息...')
  const savedTask = db.getTask(taskId)
  console.log('  任务详情:')
  console.log(`    ID: ${savedTask.id}`)
  console.log(`    URL: ${savedTask.url}`)
  console.log(`    状态: ${savedTask.status}`)
  console.log(`    模式: ${savedTask.mode}`)
  console.log(`    图片总数: ${savedTask.total_images}`)
  console.log(`    已分析: ${savedTask.analyzed_images}`)
  console.log(`    元数据: ${JSON.stringify(savedTask.metadata)}`)
  console.log()

  // 7. 读取图片列表（不含 Buffer）
  console.log('7. 读取图片列表（元数据）...')
  const imagesMetadata = db.getImagesByTask(taskId, false)
  console.log(`  找到 ${imagesMetadata.length} 张图片:`)
  for (const img of imagesMetadata) {
    console.log(`    [${img.sequence_number}] ${img.format} ${img.width}x${img.height} (${Math.round(img.size / 1024)}KB)`)
  }
  console.log()

  // 8. 读取图片（含 Buffer）
  console.log('8. 读取图片（含 Buffer）...')
  const imagesWithBuffer = db.getImagesWithBuffers(taskId)
  console.log(`  读取 ${imagesWithBuffer.length} 张图片的 Buffer:`)
  for (const img of imagesWithBuffer) {
    console.log(`    [${img.sequence_number}] Buffer 大小: ${img.buffer.length} 字节`)
  }
  console.log()

  // 9. 通过 URL 获取图片
  console.log('9. 通过 URL 获取图片...')
  const img1 = db.getImageByUrl(taskId, 'https://example.com/image1.jpg')
  console.log(`  找到图片: ${img1.format} ${img1.width}x${img1.height}`)
  console.log(`  Buffer 大小: ${img1.buffer.length} 字节\n`)

  // 10. 获取单张图片的 Buffer
  console.log('10. 获取单张图片的 Buffer...')
  const buffer = db.getImageBuffer(taskId, 'https://example.com/image2.png')
  console.log(`  Buffer 大小: ${buffer.length} 字节\n`)

  // 11. 获取数据库统计
  console.log('11. 获取数据库统计...')
  const stats = db.getStats()
  console.log('  数据库统计:')
  console.log(`    任务数: ${stats.taskCount}`)
  console.log(`    图片数: ${stats.imageCount}`)
  console.log(`    数据库大小: ${stats.dbSizeMB} MB`)
  console.log()

  // 12. 测试清理功能
  console.log('12. 测试清理功能...')
  // 创建一个旧任务用于测试清理
  const oldTaskId = `old-${Date.now() - 48 * 3600 * 1000}`
  db.createTask(oldTaskId, 'https://example.com/old', 'twoPhaseApi')
  console.log('  创建了一个旧任务用于测试清理')

  const deleted = db.cleanupOldTasks(24) // 清理 24 小时前的任务
  console.log(`  ✅ 清理完成: 删除 ${deleted} 个过期任务\n`)

  // 13. 删除测试任务
  console.log('13. 删除测试任务...')
  const deletedCount = db.deleteTask(taskId)
  console.log(`  ✅ 删除完成: ${deletedCount} 个任务\n`)

  // 14. 验证删除
  console.log('14. 验证删除...')
  const deletedTask = db.getTask(taskId)
  console.log(`  任务是否存在: ${deletedTask ? '是' : '否'}`)
  const remainingImages = db.getImagesByTask(taskId, false)
  console.log(`  关联图片数: ${remainingImages.length} (应为 0)\n`)

  // 15. 关闭数据库
  console.log('15. 关闭数据库...')
  db.close()
  console.log('✅ 数据库已关闭\n')

  console.log('========== 数据库功能测试完成 ==========')
  console.log('所有测试通过! ✅')
}

// 运行测试
testDatabase().catch(error => {
  console.error('测试失败:', error)
  process.exit(1)
})
