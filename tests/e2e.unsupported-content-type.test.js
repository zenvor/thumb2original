import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const callCount = new Map()

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    const c = (callCount.get(url) || 0) + 1
    callCount.set(url, c)
    // 返回 HTML 文本头，分析应判定为 unsupported_content_type（非重试）
    return { buffer: Buffer.from('<html>not image</html>'), headers: { 'content-type': 'text/html; charset=utf-8' }, finalUrl: url }
  })
}))

vi.mock('../lib/fileManager.js', async () => {
  const actual = await vi.importActual('../lib/fileManager.js')
  return {
    ...actual,
    saveImage: vi.fn(async () => {}),
    generateFileName: (url) => `${path.basename(url)}.bin`
  }
})

describe('E2E - unsupported_content_type 不重试', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_unsupported_ct')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 3,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', enableDetailLog: false }
  }

  beforeEach(async () => {
    callCount.clear()
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
  })

  it('应只分析一次且统计 unsupported_content_type=1，且不进入重试', async () => {
    const url = 'http://site/image-like.html'
    const res = await processDownloadQueue([url], outDir, { config: cfg }, [])
    expect(res.analysisFailures.unsupported_content_type).toBe(1)
    expect(callCount.get(url)).toBe(1)
  })
})
