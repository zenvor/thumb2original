import { describe, it, expect, vi } from 'vitest'

// 先 mock axios 下载器以拦截调用参数
vi.mock('../lib/fetcher/axiosFetcher.js', () => {
  return {
    axiosFetchOnce: vi.fn().mockResolvedValue(null)
  }
})

// puppeteer 下载器在本测试中不会被调用，但避免真实依赖
vi.mock('../lib/fetcher/puppeteerFetcher.js', () => {
  return {
    puppeteerFetchOnce: vi.fn().mockResolvedValue(null)
  }
})

// 引入被测模块与已 mock 的函数
import { axiosFetchOnce } from '../lib/fetcher/axiosFetcher.js'

describe('fetchImage → acceptBinaryContentTypes 透传', () => {
  it('当为 boolean false 时应透传到 axiosFetcher', async () => {
    const { fetchImage } = await import('../lib/imageFetcher.js')
    const context = { config: { analysis: { acceptBinaryContentTypes: false } }, strategyOrder: ['axios'] }
    await fetchImage('http://example.com/a.jpg', context)
    expect(axiosFetchOnce).toHaveBeenCalled()
    const call = axiosFetchOnce.mock.calls[0]
    expect(call[3]).toMatchObject({ acceptBinaryContentTypes: false })
  })

  it('当为数组时应透传到 axiosFetcher', async () => {
    const { fetchImage } = await import('../lib/imageFetcher.js')
    const context = { config: { analysis: { acceptBinaryContentTypes: ['application/octet-stream'] } }, strategyOrder: ['axios'] }
    await fetchImage('http://example.com/b.jpg', context)
    expect(axiosFetchOnce).toHaveBeenCalled()
    const call = axiosFetchOnce.mock.calls[1]
    expect(call[3]).toMatchObject({ acceptBinaryContentTypes: ['application/octet-stream'] })
  })
})


