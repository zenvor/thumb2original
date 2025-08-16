import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { fetchMock, saveMock, callCount } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  saveMock: vi.fn(),
  callCount: new Map()
}))

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: fetchMock.mockImplementation(async (url) => {
    const c = (callCount.get(url) || 0) + 1
    callCount.set(url, c)
    if (c === 1) {
      return { buffer: Buffer.alloc(10), headers: { 'content-type': 'image/png' }, finalUrl: url }
    }
    const buf = Buffer.alloc(200); buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('E2E - twoPhase 可重试(content_too_small)后成功', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_twoPhase_retry')
  const tempDir = path.join(process.cwd(), '.tmp_test_twoPhase_retry')
  const cfg = {
    concurrentDownloads: 2,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 2,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: {
      mode: 'twoPhase',
      tempDir,
      cleanupTempOnStart: true,
      cleanupTempOnComplete: true,
      minBufferSize: 50,
      enableDetailLog: false
    }
  }

  beforeEach(async () => {
    callCount.clear()
    fetchMock.mockClear()
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    await fs.mkdir(tempDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的自定义实现，影响统计或断言。
    saveMock.mockClear()
  })

  it('分析失败统计应记录一次 content_too_small，最终 saveImage 成功一次', async () => {
    const url = 'http://site/need-retry.png'
    const res = await processDownloadQueue([url], outDir, { config: cfg }, [])
    expect(res.analysisFailures.content_too_small).toBe(1)
    expect(callCount.get(url)).toBeGreaterThanOrEqual(2)
    expect(saveMock).toHaveBeenCalledTimes(1)
  })
})
