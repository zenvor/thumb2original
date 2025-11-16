/**
 * 内存存储 - 存储提取任务数据
 */

export class MemoryStorage {
  constructor() {
    this.tasks = new Map() // taskId -> task data
  }

  /**
   * 创建任务
   */
  async create(taskData) {
    this.tasks.set(taskData.id, {
      ...taskData,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    return this.tasks.get(taskData.id)
  }

  /**
   * 获取任务
   */
  async get(taskId) {
    return this.tasks.get(taskId)
  }

  /**
   * 更新任务
   */
  async update(taskId, updates) {
    const task = this.tasks.get(taskId)
    if (!task) {
      throw new Error(`Task ${taskId} not found`)
    }

    const updated = {
      ...task,
      ...updates,
      updated_at: new Date().toISOString()
    }

    this.tasks.set(taskId, updated)
    return updated
  }

  /**
   * 删除任务
   */
  async delete(taskId) {
    return this.tasks.delete(taskId)
  }

  /**
   * 获取所有任务
   */
  async getAll() {
    return Array.from(this.tasks.values())
  }

  /**
   * 按状态过滤
   */
  async getByStatus(status) {
    return Array.from(this.tasks.values()).filter(task => task.status === status)
  }

  /**
   * 清理旧任务
   */
  async cleanup(olderThanMs = 3600000) {
    const now = Date.now()
    let deletedCount = 0

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.status === 'done' || task.status === 'failed') {
        const taskTime = new Date(task.updated_at).getTime()
        if (now - taskTime > olderThanMs) {
          this.tasks.delete(taskId)
          deletedCount++
        }
      }
    }

    return deletedCount
  }

  /**
   * 获取统计信息
   */
  async getStats() {
    const all = await this.getAll()
    const stats = {
      total: all.length,
      pending: 0,
      running: 0,
      done: 0,
      failed: 0
    }

    for (const task of all) {
      if (stats[task.status] !== undefined) {
        stats[task.status]++
      }
    }

    return stats
  }
}
