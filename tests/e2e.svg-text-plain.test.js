import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs/promises'
import { processDownloadQueue } from '../lib/downloadQueue.js'

const { saveMock, svg } = vi.hoisted(() => ({
  saveMock: vi.fn(),
  svg: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><rect width="24" height="24" fill="black"/></svg>`, 'utf8')
}))

vi.mock('../lib/imageFetcher.js', () => ({
  fetchImage: vi.fn(async (url) => {
    // 故意返回 text/plain，但内容是 SVG
    return { buffer: svg, headers: { 'content-type': 'text/plain' }, finalUrl: url }
  })
}))

vi.mock('../lib/fileManager.js', () => ({
  saveImage: saveMock,
  generateFileName: (url) => `${path.basename(url)}.svg`
}))

describe('E2E - SVG 在 text/plain 头下应放行并保存', () => {
  const outDir = path.join(process.cwd(), '.tmp_e2e_svg_text_plain')
  const cfg = {
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
    // 重要：仅清理调用记录，保留实现。不要使用 mockReset，否则会清空 saveImage 的自定义实现，影响统计或断言。
    saveMock.mockClear()
  })

  it('分析应判定 isValid，saveImage 被调用一次', async () => {
    const url = 'http://site/icon.svg'
    const res = await processDownloadQueue([url], outDir, { config: cfg }, [])
    expect(res.analyzed).toBe(1)
    expect(saveMock).toHaveBeenCalledTimes(1)
    const analysisResult = saveMock.mock.calls.at(-1)[6]
    expect(analysisResult?.isValid).toBe(true)
    expect(analysisResult?.metadata?.format?.toLowerCase()).toBe('svg')
  })
})
