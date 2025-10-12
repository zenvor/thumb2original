import { describe, it, expect, vi, beforeEach } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  readFileMock: vi.fn()
}))

vi.mock('fs/promises', () => ({
  __esModule: true,
  default: {
    readFile: fsMocks.readFileMock
  }
}))

import { extractImageUrlsFromLocalHtml } from '../lib/imageExtractor.js'

describe('extractImageUrlsFromLocalHtml 属性解析', () => {
  beforeEach(() => {
    fsMocks.readFileMock.mockReset()
  })

  it('支持包含空格与大小写变体的 src / srcset 属性', async () => {
    fsMocks.readFileMock.mockResolvedValue(`
      <html>
        <head><title>Mixed Case</title></head>
        <body>
          <img SRC = "https://example.com/img-upper.jpg" />
          <img src = 'https://example.com/img-single.png'/>
          <img data-src="https://example.com/img-lazy.webp" />
          <img srcset = "
            https://example.com/img-set-1x.jpeg   1x ,
            /relative/img-set-2x.jpeg 2x
          " />
        </body>
      </html>
    `)

    const result = await extractImageUrlsFromLocalHtml('/tmp/sample.html', { includeSrcset: true })
    expect(result.imageUrls).toEqual([
      'https://example.com/img-upper.jpg',
      'https://example.com/img-single.png',
      'https://example.com/img-lazy.webp',
      'https://example.com/img-set-1x.jpeg',
      '/relative/img-set-2x.jpeg'
    ])
    expect(result.title).toBe('Mixed Case')
  })
})
