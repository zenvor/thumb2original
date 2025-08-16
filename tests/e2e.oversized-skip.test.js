import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { saveMock } = vi.hoisted(() => ({
  saveMock: vi.fn()
}))

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    // 构造一个 ~2MB 的 PNG-like buffer，以触发 too_large 分支（实现中最小阈值为 1MB）
    const buf = Buffer.alloc(2 * 1024 * 1024)
    buf[0] = 0x89
    buf.write('PNG', 1, 'utf8')
    return { buffer: buf, headers: { 'content-type': 'image/png' }, finalUrl: url }
  })
}))

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('E2E - 超大文件跳过元数据但仍落盘', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_oversized')
  const cfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: {
      preset: 'balanced',
      minBufferSize: 50,
      maxAnalyzableSizeInMB: 1, // 实现中最小阈值强制为 >=1MB
      enableDetailLog: false
    }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的自定义实现，影响统计或断言。
    saveMock.mockClear()
  })

  it('analysisResult.metadata.skipped 应为 too_large，且 saveImage 被调用', async () => {
    const url = 'http://site/oversized.png'
    const res = await processDownloadQueue([url], outDir, { config: cfg }, [])
    expect(res.analyzed).toBe(1)
    expect(saveMock).toHaveBeenCalledTimes(1)
    const lastCall = saveMock.mock.calls.at(-1)
    const analysisResult = lastCall[6]
    expect(analysisResult?.metadata?.skipped).toBe('too_large')
    // format 通过嗅探应为 png
    expect(analysisResult?.metadata?.format?.toLowerCase()).toBe('png')
  })
})
