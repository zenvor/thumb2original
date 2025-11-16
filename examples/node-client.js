#!/usr/bin/env node
/**
 * Node.js API 客户端示例
 * 演示如何通过编程方式使用 thumb2original API
 */

import fetch from 'node-fetch'
import { io } from 'socket.io-client'

const API_URL = process.env.API_URL || 'http://localhost:3000'

/**
 * 创建任务并监控进度
 */
async function createAndMonitorTask(config) {
  console.log('🚀 创建任务...')

  // 1. 创建任务
  const response = await fetch(`${API_URL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config })
  })

  if (!response.ok) {
    throw new Error(`创建任务失败: ${response.statusText}`)
  }

  const { taskId } = await response.json()
  console.log(`✅ 任务已创建: ${taskId}`)

  // 2. 连接 WebSocket 监听进度
  const socket = io(API_URL)

  return new Promise((resolve, reject) => {
    socket.on('connect', () => {
      console.log('📡 WebSocket 已连接')
      socket.emit('subscribe', taskId)
    })

    socket.on('task:progress', (data) => {
      if (data.taskId === taskId) {
        console.log('⏳ 进度更新:', JSON.stringify(data.progress, null, 2))
      }
    })

    socket.on('task:completed', (data) => {
      if (data.taskId === taskId) {
        console.log('✅ 任务完成!')
        console.log('结果:', JSON.stringify(data.result, null, 2))
        socket.disconnect()
        resolve(data.result)
      }
    })

    socket.on('task:failed', (data) => {
      if (data.taskId === taskId) {
        console.error('❌ 任务失败:', data.error)
        socket.disconnect()
        reject(new Error(data.error))
      }
    })

    socket.on('disconnect', () => {
      console.log('📡 WebSocket 已断开')
    })
  })
}

/**
 * 轮询方式监控任务（不使用 WebSocket）
 */
async function createAndPollTask(config) {
  console.log('🚀 创建任务...')

  // 1. 创建任务
  const response = await fetch(`${API_URL}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config })
  })

  const { taskId } = await response.json()
  console.log(`✅ 任务已创建: ${taskId}`)

  // 2. 轮询任务状态
  return new Promise((resolve, reject) => {
    const pollInterval = setInterval(async () => {
      try {
        const statusResponse = await fetch(`${API_URL}/api/tasks/${taskId}`)
        const task = await statusResponse.json()

        console.log(`⏳ 任务状态: ${task.status}`)

        if (task.status === 'completed') {
          clearInterval(pollInterval)
          console.log('✅ 任务完成!')
          console.log('结果:', JSON.stringify(task.result, null, 2))
          resolve(task.result)
        } else if (task.status === 'failed') {
          clearInterval(pollInterval)
          console.error('❌ 任务失败:', task.error)
          reject(new Error(task.error))
        } else if (task.status === 'cancelled') {
          clearInterval(pollInterval)
          console.log('🚫 任务已取消')
          resolve(null)
        }
      } catch (error) {
        clearInterval(pollInterval)
        reject(error)
      }
    }, 2000) // 每 2 秒轮询一次
  })
}

/**
 * 批量创建任务
 */
async function createBatchTasks(configs) {
  console.log(`🚀 批量创建 ${configs.length} 个任务...`)

  const tasks = await Promise.all(
    configs.map(async (config) => {
      const response = await fetch(`${API_URL}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config })
      })
      const { taskId } = await response.json()
      return taskId
    })
  )

  console.log(`✅ 已创建 ${tasks.length} 个任务:`, tasks)

  // 监听所有任务的进度
  const socket = io(API_URL)

  return new Promise((resolve) => {
    const results = {}
    let completedCount = 0

    socket.on('connect', () => {
      console.log('📡 WebSocket 已连接')
      socket.emit('subscribe') // 订阅所有任务
    })

    socket.on('task:completed', (data) => {
      if (tasks.includes(data.taskId)) {
        completedCount++
        results[data.taskId] = data.result
        console.log(`✅ 任务 ${data.taskId} 完成 (${completedCount}/${tasks.length})`)

        if (completedCount === tasks.length) {
          console.log('🎉 所有任务完成!')
          socket.disconnect()
          resolve(results)
        }
      }
    })

    socket.on('task:failed', (data) => {
      if (tasks.includes(data.taskId)) {
        completedCount++
        results[data.taskId] = { error: data.error }
        console.error(`❌ 任务 ${data.taskId} 失败:`, data.error)

        if (completedCount === tasks.length) {
          console.log('所有任务处理完成（有失败）')
          socket.disconnect()
          resolve(results)
        }
      }
    })
  })
}

/**
 * 获取系统统计
 */
async function getStats() {
  const response = await fetch(`${API_URL}/api/tasks`)
  const data = await response.json()

  console.log('📊 系统统计:')
  console.log(JSON.stringify(data.stats, null, 2))

  return data.stats
}

/**
 * 取消任务
 */
async function cancelTask(taskId) {
  console.log(`🚫 取消任务: ${taskId}`)

  const response = await fetch(`${API_URL}/api/tasks/${taskId}/cancel`, {
    method: 'POST'
  })

  const data = await response.json()
  console.log(data.message)
}

/**
 * 清理已完成任务
 */
async function cleanupOldTasks(olderThanHours = 1) {
  console.log(`🧹 清理 ${olderThanHours} 小时前的任务...`)

  const response = await fetch(`${API_URL}/api/tasks/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ olderThanMs: olderThanHours * 3600000 })
  })

  const data = await response.json()
  console.log(data.message)
}

// ============= 示例用法 =============

async function main() {
  try {
    console.log('='.repeat(50))
    console.log('thumb2original API 客户端示例')
    console.log(`API 地址: ${API_URL}`)
    console.log('='.repeat(50))

    // 示例 1: 单个任务 + WebSocket 监控
    console.log('\n📝 示例 1: 单个任务 + WebSocket 监控')
    await createAndMonitorTask({
      scrapeMode: 'single_page',
      imageMode: 'originals_only',
      targetUrl: 'https://nuxt.com/',
      outputDirectory: './download',
      maxRetries: 2,
      concurrentDownloads: 5
    })

    // 示例 2: 单个任务 + 轮询方式
    console.log('\n📝 示例 2: 单个任务 + 轮询方式')
    // await createAndPollTask({
    //   scrapeMode: 'single_page',
    //   imageMode: 'all',
    //   targetUrl: 'https://example.com/gallery2'
    // })

    // 示例 3: 批量任务
    console.log('\n📝 示例 3: 批量任务')
    // await createBatchTasks([
    //   {
    //     scrapeMode: 'single_page',
    //     targetUrl: 'https://example.com/page1',
    //     imageMode: 'all'
    //   },
    //   {
    //     scrapeMode: 'single_page',
    //     targetUrl: 'https://example.com/page2',
    //     imageMode: 'originals_only'
    //   },
    //   {
    //     scrapeMode: 'single_page',
    //     targetUrl: 'https://example.com/page3',
    //     imageMode: 'all'
    //   }
    // ])

    // 示例 4: 获取统计信息
    console.log('\n📝 示例 4: 获取统计信息')
    await getStats()

    // 示例 5: 清理旧任务
    console.log('\n📝 示例 5: 清理旧任务')
    await cleanupOldTasks(1)

    console.log('\n✅ 所有示例执行完成!')
  } catch (error) {
    console.error('❌ 错误:', error.message)
    console.error(error.stack)
    process.exit(1)
  }
}

// 运行主函数
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}

// 导出函数供其他模块使用
export {
  createAndMonitorTask,
  createAndPollTask,
  createBatchTasks,
  getStats,
  cancelTask,
  cleanupOldTasks
}
