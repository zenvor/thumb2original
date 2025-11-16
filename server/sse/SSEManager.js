/**
 * SSE 管理器 - 管理服务器发送事件连接
 */

export class SSEManager {
  constructor() {
    this.connections = new Map() // taskId -> Set<response>
  }

  /**
   * 添加 SSE 连接
   */
  addConnection(taskId, res) {
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Set())
    }
    this.connections.get(taskId).add(res)

    // 设置 SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no') // 禁用 Nginx 缓冲

    // 发送初始连接消息
    this.sendEvent(res, { type: 'connected', message: 'SSE connection established' })
  }

  /**
   * 移除 SSE 连接
   */
  removeConnection(taskId, res) {
    const connections = this.connections.get(taskId)
    if (connections) {
      connections.delete(res)
      if (connections.size === 0) {
        this.connections.delete(taskId)
      }
    }
  }

  /**
   * 发送事件到单个连接
   */
  sendEvent(res, data) {
    if (res.writableEnded) return

    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`)
    } catch (error) {
      console.error('SSE send error:', error)
    }
  }

  /**
   * 广播事件到所有订阅该任务的连接
   */
  broadcast(taskId, data) {
    const connections = this.connections.get(taskId)
    if (!connections) return

    for (const res of connections) {
      this.sendEvent(res, data)
    }
  }

  /**
   * 发送进度更新
   */
  sendProgress(taskId, message, progress) {
    this.broadcast(taskId, {
      type: 'progress',
      message,
      progress
    })
  }

  /**
   * 发送完成事件
   */
  sendComplete(taskId, data) {
    this.broadcast(taskId, {
      type: 'complete',
      ...data
    })

    // 完成后关闭所有连接
    this.closeAll(taskId)
  }

  /**
   * 发送错误事件
   */
  sendError(taskId, error) {
    this.broadcast(taskId, {
      type: 'error',
      message: error.message || 'An error occurred'
    })

    // 错误后关闭所有连接
    this.closeAll(taskId)
  }

  /**
   * 关闭所有连接
   */
  closeAll(taskId) {
    const connections = this.connections.get(taskId)
    if (!connections) return

    for (const res of connections) {
      try {
        res.end()
      } catch (error) {
        console.error('Error closing SSE connection:', error)
      }
    }

    this.connections.delete(taskId)
  }

  /**
   * 获取活跃连接数
   */
  getConnectionCount(taskId) {
    return this.connections.get(taskId)?.size || 0
  }

  /**
   * 获取所有活跃任务
   */
  getActiveTasks() {
    return Array.from(this.connections.keys())
  }
}
