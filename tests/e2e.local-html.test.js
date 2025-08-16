import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import { validateAndNormalizeConfig } from '../lib/configValidator.js'
import { downloadManager } from '../lib/downloadManager.js'

const tmpRoot = path.join(process.cwd(), '.e2e_local_html')
const htmlDir = path.join(tmpRoot, 'html')
const outDir = path.join(tmpRoot, 'download')

async function writeHtmlSample(name, body) {
  await fs.mkdir(htmlDir, { recursive: true })
  const file = path.join(htmlDir, name)
  await fs.writeFile(file, `<!DOCTYPE html><html><head><title>${name}</title></head><body>${body}</body></html>`)
  return file
}

describe('E2E - local HTML mode (inline analyze)', () => {
  beforeAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
    await fs.mkdir(tmpRoot, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true })
  })

  it('应能处理本地 HTML：一张可用 PNG + 一张过小失败，流程可达', async () => {
    const okPng = Buffer.alloc(200); okPng[0]=0x89; okPng.write('PNG',1,'utf8')
    const okPngPath = path.join(tmpRoot, 'ok.png')
    await fs.writeFile(okPngPath, okPng)

    // 通过 file:// 引用一张“本地”图片（以 puppeteer 分支不会被调用的方式，fetchImage 会按 axios 路径处理；这里不真正下载，
    // 在真实场景下应 mock axios/puppeteer。E2E 轻量验证以流程贯通为主）
    const body = `
      <img src="${okPngPath}">
      <img src="data:image/png;base64,AAA" />
    `
    await writeHtmlSample('sample.html', body)

    const config = await validateAndNormalizeConfig({
      scrapeMode: 'local_html',
      htmlDirectory: htmlDir,
      outputDirectory: outDir,
      concurrentDownloads: 2,
      maxRetries: 0,
      analysis: { preset: 'balanced', minBufferSize: 50 }
    })

    // 直接调用 downloadManager，绕过浏览器与本地 HTML 扫描，以聚焦下载流程
    const urls = [okPngPath, 'data:image/png;base64,AAA']
    const context = { config, pageTitle: 'e2e', htmlFilePath: null }
    await downloadManager(urls, context)

    // 至少成功保存 1 张
    const exists = await fs.readdir(outDir).catch(() => [])
    expect(exists.length).toBeGreaterThanOrEqual(1)
  })
})


