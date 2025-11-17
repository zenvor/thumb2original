/**
 * WebSocket 连接管理器 - 管理实时进度推送
 */

import { logger } from '../../utils/logger.js'

export class WebSocketManager {
  constructor() {
    // taskId -> Set<WebSocket>
    this.connections = new Map()
  }

  /**
   * 添加 WebSocket 连接
   */
  addConnection(taskId, ws) {
    if (!this.connections.has(taskId)) {
      this.connections.set(taskId, new Set())
    }

    this.connections.get(taskId).add(ws)

    // 发送连接确认
    this.sendToClient(ws, {
      type: 'connected',
      message: 'WebSocket connection established',
      taskId
    })

    logger.info(`WebSocket connection added for task: ${taskId}`)

    // 监听断开事件
    ws.on('close', () => {
      this.removeConnection(taskId, ws)
    })

    ws.on('error', (error) => {
      logger.error(`WebSocket error for task ${taskId}:`, error)
      this.removeConnection(taskId, ws)
    })
  }

  /**
   * 移除连接
   */
  removeConnection(taskId, ws) {
    const connections = this.connections.get(taskId)
    if (connections) {
      connections.delete(ws)

      if (connections.size === 0) {
        this.connections.delete(taskId)
      }

      logger.info(`WebSocket connection removed for task: ${taskId}`)
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

    // 延迟关闭连接（给客户端时间接收完成事件）
    setTimeout(() => {
      this.closeAllConnections(taskId)
    }, 1000)
  }

  /**
   * 发送错误事件
   */
  sendError(taskId, error) {
    this.broadcast(taskId, {
      type: 'error',
      message: error.message || 'An error occurred'
    })

    // 延迟关闭连接
    setTimeout(() => {
      this.closeAllConnections(taskId)
    }, 1000)
  }

  /**
   * 广播消息给所有订阅者
   */
  broadcast(taskId, data) {
    const connections = this.connections.get(taskId)
    if (!connections || connections.size === 0) {
      return
    }

    const message = JSON.stringify(data)

    for (const ws of connections) {
      this.sendToClient(ws, data)
    }
  }

  /**
   * 发送消息给单个客户端
   */
  sendToClient(ws, data) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(data))
      } catch (error) {
        logger.error('Failed to send WebSocket message:', error)
      }
    }
  }

  /**
   * 关闭任务的所有连接
   */
  closeAllConnections(taskId) {
    const connections = this.connections.get(taskId)
    if (connections) {
      for (const ws of connections) {
        try {
          ws.close()
        } catch (error) {
          logger.error('Failed to close WebSocket:', error)
        }
      }
      this.connections.delete(taskId)
    }
  }

  /**
   * 获取连接统计
   */
  getStats() {
    let totalConnections = 0
    for (const connections of this.connections.values()) {
      totalConnections += connections.size
    }

    return {
      activeTasks: this.connections.size,
      totalConnections
    }
  }
}
