import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { saveMock } = vi.hoisted(() => ({
  saveMock: vi.fn(async (buffer, filePath, imageUrl, stats) => {
    stats.successful++
    if (stats && stats.formatCounts) {
      stats.formatCounts.png = (stats.formatCounts.png || 0) + 1
    }
  })
}))

// 根据 URL 区分两种情况：?case=attach 和 ?case=missing
vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    const buf = Buffer.alloc(256)
    buf[0] = 0x89; buf.write('PNG', 1, 'utf8')
    if (url.includes('case=attach')) {
      return {
        buffer: buf,
        headers: { 'content-disposition': 'attachment; filename="pic.png"', 'content-type': 'application/octet-stream' },
        finalUrl: url
      }
    }
    // 缺失 content-type
    return { buffer: buf, headers: {}, finalUrl: url }
  })
}))

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.png`
}))

describe('E2E - attachment 与 缺失 content-type 放行', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_headers_cases')
  const baseCfg = {
    concurrentDownloads: 1,
    minRequestDelayMs: 0,
    maxRequestDelayMs: 0,
    maxRetries: 0,
    retryDelayMs: 0,
    outputDirectory: outDir,
    analysis: { preset: 'balanced', enableDetailLog: false }
  }

  beforeEach(async () => {
    await fs.rm(outDir, { recursive: true, force: true })
    await fs.mkdir(outDir, { recursive: true })
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的累加逻辑，导致 formatCounts 统计丢失。
    saveMock.mockClear()
  })

  it('Content-Disposition: attachment 应放行并保存', async () => {
    const url = 'http://site/file?case=attach'
    const res = await processDownloadQueue([url], outDir, { config: baseCfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(res.analyzed).toBe(1)
    expect(Object.values(res.analysisFailures).reduce((a,b)=>a+b,0)).toBe(0)
    expect(res.formatCounts.png || 0).toBe(1)
  })

  it('缺失 content-type 也应放行并保存', async () => {
    const url = 'http://site/file2?case=missing'
    const res = await processDownloadQueue([url], outDir, { config: baseCfg }, [])
    expect(saveMock).toHaveBeenCalledTimes(1)
    expect(res.analyzed).toBe(1)
    expect(Object.values(res.analysisFailures).reduce((a,b)=>a+b,0)).toBe(0)
    expect(res.formatCounts.png || 0).toBe(1)
  })
})
