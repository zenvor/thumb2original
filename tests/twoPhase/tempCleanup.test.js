import { describe, it, expect } from 'vitest'
import fs from 'fs/promises'
import path from 'path'

import { processDownloadQueue } from '../../lib/downloadQueue.js'

describe('twoPhase 冷启动清理（cleanupTempOnStart）', () => {
  it('在 twoPhase 模式启动时应清理临时目录中的陈旧文件', async () => {
    // 准备：创建临时目录与陈旧文件
    const tempDir = path.join(process.cwd(), '.tmp_test_twoPhase_cleanup')
    await fs.mkdir(tempDir, { recursive: true })
    const stale = path.join(tempDir, 'stale.bin')
    await fs.writeFile(stale, Buffer.from('stale'))

    // 构造最小上下文（空 URL 列表即可触发 twoPhase 分支与清理逻辑）
    const config = {
      concurrentDownloads: 1,
      minRequestDelayMs: 0,
      maxRequestDelayMs: 0,
      maxRetries: 0,
      analysis: {
        mode: 'twoPhase',
        tempDir,
        cleanupTempOnStart: true,
        cleanupTempOnComplete: false
      }
    }
    const context = { config }
    const targetDownloadDir = path.join(process.cwd(), '.tmp_test_twoPhase_cleanup_out')
    await fs.mkdir(targetDownloadDir, { recursive: true })

    await processDownloadQueue([], targetDownloadDir, context, [])

    // 断言：目录存在但陈旧文件已被清理
    const entries = await fs.readdir(tempDir)
    expect(entries.length).toBe(0)

    // 清理：移除测试目录
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.rm(targetDownloadDir, { recursive: true, force: true })
  })
})


