import { describe, it, expect, vi } from 'vitest'
import fs from 'fs/promises'
import path from 'path'

// 监控写入临时文件次数
import * as store from '../../lib/tempFileStore.js'
import { processDownloadQueue } from '../../lib/downloadQueue.js'
import * as fetcher from '../../lib/imageFetcher.js'
import { analyzeImage } from '../../lib/imageAnalyzer.js'

vi.mock('../../lib/imageFetcher.js', async (orig) => {
  const mod = await orig()
  return {
    ...mod,
    fetchImage: vi.fn(async (url) => ({ buffer: Buffer.from('data'), finalUrl: url, headers: { 'content-type': 'image/png' } }))
  }
})

vi.mock('../../lib/imageAnalyzer.js', async (orig) => {
  const mod = await orig()
  return {
    ...mod,
    analyzeImage: vi.fn(async (imageData, url) => ({ isValid: true, metadata: { format: 'png', size: imageData.buffer.length, finalUrl: url } }))
  }
})

describe('twoPhase maxHoldBuffers', () => {
  it('当 maxHoldBuffers>0 时，应批量落盘以减少 write 次数', async () => {
    const tempDir = path.join(process.cwd(), '.tmp_test_twoPhase_hold')
    const outDir = path.join(process.cwd(), '.tmp_test_twoPhase_hold_out')
    await fs.mkdir(tempDir, { recursive: true })
    await fs.mkdir(outDir, { recursive: true })

    // 监控 writeBufferToTemp 调用次数
    const spy = vi.spyOn(store, 'writeBufferToTemp')

    const imageUrls = ['u1','u2','u3','u4']
    const context = {
      config: {
        concurrentDownloads: 4,
        minRequestDelayMs: 0,
        maxRequestDelayMs: 0,
        maxRetries: 0,
        analysis: {
          mode: 'twoPhase',
          tempDir,
          cleanupTempOnStart: true,
          cleanupTempOnComplete: true,
          maxHoldBuffers: 3
        }
      }
    }

    await processDownloadQueue(imageUrls, outDir, context, [])

    // 期望：4 张图片，按 hold=3，应先批量写入 3 次，批次末写入 1 次，共 4 次
    expect(spy).toHaveBeenCalledTimes(4)

    // 清理
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.rm(outDir, { recursive: true, force: true })
  })
})


