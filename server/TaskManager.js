/**
 * 任务管理器 - 管理多个爬虫任务的执行、队列和状态
 */

import { ScraperEngine } from '../lib/core/ScraperEngine.js'
import { nanoid } from 'nanoid'
import EventEmitter from 'events'

export class TaskManager extends EventEmitter {
  constructor(options = {}) {
    super()
    this.tasks = new Map() // taskId -> Task
    this.maxConcurrent = options.maxConcurrent || 3
    this.runningTasks = 0
    this.taskQueue = []
  }

  /**
   * 创建新任务
   */
  createTask(config, options = {}) {
    const taskId = nanoid()

    const task = {
      id: taskId,
      config,
      options,
      status: 'pending',
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      progress: {},
      result: null,
      error: null,
      engine: null
    }

    this.tasks.set(taskId, task)
    this.emit('task:created', { taskId, task })

    return taskId
  }

  /**
   * 运行任务
   */
  async runTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    if (task.status !== 'pending') {
      throw new Error(`Task ${taskId} is already ${task.status}`)
    }

    // 并发控制
    if (this.runningTasks >= this.maxConcurrent) {
      task.status = 'queued'
      this.taskQueue.push(taskId)
      this.emit('task:queued', { taskId, task })
      return taskId
    }

    await this._executeTask(taskId)
    return taskId
  }

  /**
   * 执行任务
   */
  async _executeTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return

    this.runningTasks++
    task.status = 'running'
    task.startedAt = Date.now()

    const engine = new ScraperEngine(task.config, {
      onProgress: (progress) => {
        task.progress = progress
        this.emit('task:progress', { taskId, progress })
      },
      onComplete: (result) => {
        task.status = 'completed'
        task.completedAt = Date.now()
        task.result = result
        this.runningTasks--
        this.emit('task:completed', { taskId, result })
        this._processQueue()
      },
      onError: (error) => {
        task.status = 'failed'
        task.completedAt = Date.now()
        task.error = error
        this.runningTasks--
        this.emit('task:failed', { taskId, error })
        this._processQueue()
      },
      onStatusChange: (status, data) => {
        this.emit('task:status', { taskId, status, data })
      }
    })

    task.engine = engine
    this.emit('task:started', { taskId, task })

    try {
      await engine.run()
    } catch (error) {
      // 错误已经在 engine 的 onError 中处理
    }
  }

  /**
   * 处理队列中的下一个任务
   */
  _processQueue() {
    if (this.taskQueue.length > 0 && this.runningTasks < this.maxConcurrent) {
      const nextTaskId = this.taskQueue.shift()
      this._executeTask(nextTaskId)
    }
  }

  /**
   * 获取任务状态
   */
  getTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return null

    return {
      id: task.id,
      status: task.status,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      progress: task.progress,
      result: task.result,
      error: task.error,
      config: {
        scrapeMode: task.config?.scrapeMode,
        imageMode: task.config?.imageMode,
        targetUrl: task.config?.targetUrl,
        targetUrls: task.config?.targetUrls
      }
    }
  }

  /**
   * 获取所有任务
   */
  getAllTasks() {
    return Array.from(this.tasks.keys()).map(id => this.getTask(id))
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    if (task.status === 'running' && task.engine) {
      await task.engine.cancel()
    } else if (task.status === 'queued' || task.status === 'pending') {
      task.status = 'cancelled'
      task.completedAt = Date.now()
      // 从队列中移除
      const queueIndex = this.taskQueue.indexOf(taskId)
      if (queueIndex > -1) {
        this.taskQueue.splice(queueIndex, 1)
      }
      this.emit('task:cancelled', { taskId })
    }
  }

  /**
   * 删除任务
   */
  deleteTask(taskId) {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === 'running') {
      throw new Error(`Cannot delete running task ${taskId}`)
    }

    this.tasks.delete(taskId)
    this.emit('task:deleted', { taskId })
    return true
  }

  /**
   * 清理已完成的任务
   */
  cleanupCompletedTasks(olderThanMs = 3600000) { // 默认 1 小时
    const now = Date.now()
    const toDelete = []

    for (const [taskId, task] of this.tasks.entries()) {
      if (
        (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') &&
        task.completedAt &&
        now - task.completedAt > olderThanMs
      ) {
        toDelete.push(taskId)
      }
    }

    toDelete.forEach(taskId => this.deleteTask(taskId))
    return toDelete.length
  }

  /**
   * 获取统计信息
   */
  getStats() {
    const stats = {
      total: this.tasks.size,
      pending: 0,
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0
    }

    for (const task of this.tasks.values()) {
      stats[task.status]++
    }

    return stats
  }
}

// 不需要 nanoid，使用简单的 ID 生成器
function nanoid() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
