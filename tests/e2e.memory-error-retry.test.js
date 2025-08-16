import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { saveMock, callCount } = vi.hoisted(() => ({
  saveMock: vi.fn(async (buffer, filePath, imageUrl, stats) => { stats.successful++ }),
  callCount: { value: 0 }
}))

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    const buf = Buffer.alloc(200)
    buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

vi.mock('../utils/imageUtils.js', async () => {
  const actual = await vi.importActual('../utils/imageUtils.js')
  return {
    ...actual,
    getImageMetadata: vi.fn(async () => {
      callCount.value++
      if (callCount.value === 1) {
        // 模拟首次内存错误（可重试）
        const err = new RangeError('Allocation failed - JavaScript heap out of memory')
        err.code = 'ERR_OUT_OF_MEMORY'
        throw err
      }
      return { width: 2, height: 2, format: 'png' }
    })
  }
})

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('E2E - memory_error 可重试并在重试后成功', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_memory_error')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 1,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', timeoutMs: 500, enableDetailLog: false }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的自定义实现，影响统计或断言。
    saveMock.mockClear()
    callCount.value = 0
  })

  it('首次内存错误 → memory_error，重试成功，统计正确', async () => {
    const urls = ['http://img-2']
    const res = await processDownloadQueue(urls, outDir, { config: cfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(res.analyzed).toBe(2)
    expect(res.analysisFailures.memory_error).toBe(1)
    expect(res.analysisFailedUrls.length).toBe(1)
  })
})
