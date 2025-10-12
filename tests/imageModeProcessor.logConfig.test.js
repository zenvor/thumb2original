import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../utils/logger.js', () => {
  const info = vi.fn()
  const debug = vi.fn()
  const warn = vi.fn()
  return {
    logger: {
      info,
      debug,
      warn,
      categories: {},
      header: vi.fn(),
      success: vi.fn()
    }
  }
})

vi.mock('../utils/imageUrlConverter.js', () => ({
  convertThumbnailToOriginalUrl: vi.fn((url) => `converted-${url}`)
}))

import { logger } from '../utils/logger.js'
import { processUrlsByImageMode } from '../lib/imageModeProcessor.js'
import { scraperConfig } from '../config/config.js'

describe('imageModeProcessor 日志配置', () => {
  beforeEach(() => {
    logger.info.mockClear()
    logger.debug.mockClear()
    logger.warn.mockClear()
    scraperConfig.debug = {}
  })

  it('运行时配置开启 logImageUrls 时打印原图列表', async () => {
    const runtimeConfig = { debug: { logImageUrls: true } }
    const urls = await processUrlsByImageMode(null, ['thumb-a'], 'https://example.com/page', 'originals_only', runtimeConfig)
    expect(urls).toEqual(['converted-thumb-a'])
    expect(logger.info.mock.calls.some(([msg]) => /原始图片链接/.test(msg))).toBe(true)
  })

  it('运行时配置关闭 logImageUrls 时不打印', async () => {
    const runtimeConfig = { debug: { logImageUrls: false } }
    await processUrlsByImageMode(null, ['thumb-b'], 'https://example.com/page', 'originals_only', runtimeConfig)
    expect(logger.info.mock.calls.some(([msg]) => /原始图片链接/.test(msg))).toBe(false)
  })

  it('无运行时配置时回退到全局配置', async () => {
    scraperConfig.debug = { logImageUrls: true }
    await processUrlsByImageMode(null, ['thumb-c'], 'https://example.com/page', 'originals_only')
    expect(logger.info.mock.calls.some(([msg]) => /原始图片链接/.test(msg))).toBe(true)
  })

  it('限制域名原图解析时能处理相对与绝对路径', async () => {
    const imageNodes = [
      {
        getAttribute: (name) => (name === 'src' ? '/albums/tn_sample01.jpg' : null)
      },
      {
        getAttribute: (name) => (name === 'src' ? 'https://cdn.chinesesexphotos.com/assets/tn_sample02.jpg' : null)
      }
    ]
    const documentStub = {
      querySelectorAll: vi.fn(() => imageNodes)
    }

    const pageStub = {
      evaluate: async (fn, baseUrl) => {
        const previousDocument = global.document
        try {
          global.document = documentStub
          return fn(baseUrl)
        } finally {
          if (previousDocument === undefined) {
            delete global.document
          } else {
            global.document = previousDocument
          }
        }
      }
    }

    const urls = await processUrlsByImageMode(
      pageStub,
      ['https://chinesesexphotos.com/images/tn_fallback.jpg'],
      'https://chinesesexphotos.com/gallery/index.html?foo=1',
      'originals_only'
    )

    expect(documentStub.querySelectorAll).toHaveBeenCalledWith('img[src*="tn_"]')
    expect(urls).toEqual([
      'https://chinesesexphotos.com/albums/sample01.jpg',
      'https://cdn.chinesesexphotos.com/assets/sample02.jpg'
    ])
  })
})
