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
        // 首次耗时较长，配合超小 timeout 触发 processing_timeout
        await new Promise(r => setTimeout(r, 50))
        return { width: 1, height: 1, format: 'png' }
      }
      return { width: 1, height: 1, format: 'png' }
    })
  }
})

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('E2E - processing_timeout 可重试并在重试后成功', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_processing_timeout')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 1,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', timeoutMs: 1, enableDetailLog: false }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的自定义实现，影响统计或断言。
    saveMock.mockClear()
    callCount.value = 0
  })

  it('首次超时 → processing_timeout，重试成功，统计正确', async () => {
    const urls = ['http://img-1']
    const res = await processDownloadQueue(urls, outDir, { config: cfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(res.analyzed).toBe(2)
    expect(res.analysisFailures.processing_timeout).toBe(1)
    expect(res.analysisFailedUrls.length).toBe(1)
  })
})
