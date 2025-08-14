import fs from 'fs/promises'
import path from 'path'
import { logger } from '../utils/logger.js'

/**
 * @description 从页面中提取所有图像 URL。
 * @param {object} page - Puppeteer 页面实例。
 * @param {string} pageUrl - 当前页面的 URL。
 * @returns {Promise<string[]>} 提取到的图像 URL 数组。
 */
export async function extractImageUrls(page, pageUrl, discoveryOptions = {}) {
  // 中文注释：扩展 DOM 源提取图片 URL，受配置开关控制，保持 KISS 并去重
  logger.info('正在从页面中提取图片 URL...')
  const base = pageUrl

  const {
    includeInlineSvg = false,
    includeFavicon = false,
    includeCssBackgrounds = true,
    includeDataUri = false,
  } = discoveryOptions || {}

  const imageUrls = await page.evaluate(
    (baseUrl, opts) => {
      function getAbsoluteUrl(url) {
        if (!url || typeof url !== 'string') return null
        if (!opts.includeDataUri && url.startsWith('data:')) return null
        try {
          return new URL(url, baseUrl).href
        } catch (e) {
          return null
        }
      }

      function collectFromNodeList(nodeList, attr) {
        // 中文注释：仅收集到本地数组，由调用方决定归入哪一类集合
        const results = []
        nodeList.forEach((el) => {
          const raw = el.getAttribute(attr)
          const abs = getAbsoluteUrl(raw)
          if (abs) results.push(abs)
        })
        return results
      }

      function collectFromBackgrounds() {
        // 中文注释：对齐 api 策略
        // - 仅遍历带 class 的元素
        // - 仅提取 background-image 与自定义变量 --svg
        // - 仅接受 url(...) 值以 http(s) 或 data: 开头，忽略相对路径，降低噪声
        const results = []
        const elements = document.querySelectorAll('[class]')
        const extractUrlFromCss = (val) => {
          if (!val) return null
          const m = val.match(/url\(("|')?([^"')]+)("|')?\)/i)
          if (!m) return null
          const raw = m[2]
          if (!(raw.startsWith('http') || raw.startsWith('data:'))) return null
          return getAbsoluteUrl(raw)
        }
        elements.forEach((el) => {
          const style = getComputedStyle(el)
          const bg = style.getPropertyValue('background-image') || ''
          const svgVar = style.getPropertyValue('--svg') || ''
          const bgUrl = extractUrlFromCss(bg)
          if (bgUrl) results.push(bgUrl)
          const svgUrl = extractUrlFromCss(svgVar)
          if (svgUrl) results.push(svgUrl)
        })
        return results
      }

      function filterByImageLike(urls) {
        // 中文注释：仅保留看起来像图片的 URL；允许常见扩展名
        const imageRegex = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|avif|ico)$/i
        return urls.filter((u) => {
          if (!u) return false
          if (opts.includeDataUri && typeof u === 'string' && u.startsWith('data:image/')) return true
          return imageRegex.test(u.split('?')[0])
        })
      }

      const imgLike = [] // IMG/srcset/picture/source/CSS/inline-SVG/USE 等：不过滤扩展名
      const filteredOnly = [] // 仅对 A/META/LINK 做扩展名过滤

      // 1) <img src> 与 srcset/picture/source
      imgLike.push(...collectFromNodeList(document.querySelectorAll('img[src]'), 'src'))
      // 对齐 api：不提取 img[srcset]
      // 对齐 api：不提取 <picture><source>
        // 常见延迟加载属性
        ;['data-src', 'data-original', 'data-lazy-src'].forEach((attr) => {
          imgLike.push(...collectFromNodeList(document.querySelectorAll(`img[${attr}]`), attr))
        })

      // 2) <a href> 指向图片（扩展名过滤）
      const anchorUrls = collectFromNodeList(document.querySelectorAll('a[href]'), 'href')
      filteredOnly.push(...filterByImageLike(anchorUrls))

      // 3) meta[content] 可能包含图片（如 og:image）
      const metaContent = []
      document.querySelectorAll('meta[content]').forEach((m) => {
        const content = m.getAttribute('content')
        const abs = getAbsoluteUrl(content)
        if (abs) metaContent.push(abs)
      })
      filteredOnly.push(...filterByImageLike(metaContent))

      // 4) link[href] favicon 等（受开关控制）
      if (opts.includeFavicon) {
        const linkHrefs = collectFromNodeList(document.querySelectorAll('link[href]'), 'href')
        filteredOnly.push(...filterByImageLike(linkHrefs))
      }

      // 5) CSS background-image 与 --svg（受开关控制，按 api 策略仅遍历带 class 的元素）
      // 为减少 HTML 路由噪声：data:image/* 直接纳入；http(s) 链接按扩展名过滤
      if (opts.includeCssBackgrounds) {
        imgLike.push(...collectFromBackgrounds())

        // 备选方案：暂时注释
        // const cssUrls = collectFromBackgrounds()
        // const dataUrls = cssUrls.filter((u) => typeof u === 'string' && u.startsWith('data:image/'))
        // const httpUrls = filterByImageLike(cssUrls)
        // imgLike.push(...dataUrls)
        // filteredOnly.push(...httpUrls)
      }

      // 6) SVG 与 <use xlink:href>（内联 SVG 受开关控制）
      // 外链 <img src="...svg"> 已被上面规则捕获。这里尝试解析 <use> 到 <symbol> 的外链引用
      document.querySelectorAll('use').forEach((useEl) => {
        const ref = useEl.getAttribute('href') || useEl.getAttribute('xlink:href')
        if (!ref) return
        if (ref.startsWith('#')) {
          if (opts.includeDataUri) {
            const id = ref.slice(1)
            const symbolEl = document.getElementById(id)
            if (symbolEl) {
              try {
                const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\">${symbolEl.outerHTML}<use href=\"#${id}\"/></svg>`
                const encoded = encodeURIComponent(svg)
                imgLike.push(`data:image/svg+xml,${encoded}`)
              } catch {}
            }
          }
        } else {
          const abs = getAbsoluteUrl(ref)
          if (abs) imgLike.push(abs)
        }
      })

      if (opts.includeInlineSvg) {
        // 对内联 <svg>：序列化 data:image/svg+xml 以便外层处理
        document.querySelectorAll('svg').forEach((svg) => {
          try {
            const xml = new XMLSerializer().serializeToString(svg)
            const encoded = encodeURIComponent(xml)
            const dataUrl = `data:image/svg+xml,${encoded}`
            if (opts.includeDataUri) imgLike.push(dataUrl)
          } catch {}
        })
        // <svg> 内部 <image href>
        document.querySelectorAll('svg image[href], svg image[xlink\\:href]').forEach((img) => {
          const ref = img.getAttribute('href') || img.getAttribute('xlink:href')
          const abs = getAbsoluteUrl(ref)
          if (abs) imgLike.push(abs)
        })
      }

      // 归一化与过滤：IMG/CSS/SVG/USE 等不过滤扩展名，仅对 A/META/LINK 进行扩展名过滤
      const filtered = filterByImageLike(filteredOnly)
      return Array.from(new Set([...imgLike, ...filtered]))
    },
    base,
    { includeInlineSvg, includeFavicon, includeCssBackgrounds, includeDataUri }
  )

  // 中文注释：保留 _webp → 原图的简易变体尝试
  const webpVariations = imageUrls.filter((url) => url.includes('_webp')).map((url) => url.replace('_webp', ''))

  const allUrls = [...imageUrls, ...webpVariations]
  const uniqueUrls = Array.from(new Set(allUrls))

  logger.debug(`找到 ${uniqueUrls.length} 个唯一的图片 URL。`)
  return uniqueUrls
}

/**
 * @description 从本地HTML文件中提取图像URL与标题。
 * @param {import('node:fs').PathLike} htmlFilePath - HTML文件路径。
 * @returns {Promise<{imageUrls: string[], title: string}>}
 */
export async function extractImageUrlsFromLocalHtml(htmlFilePath) {
  try {
    const htmlContent = await fs.readFile(htmlFilePath, 'utf-8')
    const fileName = path.basename(htmlFilePath, '.html')

    const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi
    const imageUrls = []
    let match

    while ((match = imgRegex.exec(htmlContent)) !== null) {
      const src = match[1]
      if (src && !src.startsWith('data:')) {
        imageUrls.push(src)
      }
    }

    const titleMatch = htmlContent.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = titleMatch ? titleMatch[1].trim() : fileName

    logger.debug(`从 ${path.basename(htmlFilePath)} 提取到 ${imageUrls.length} 个图片URL`)

    return {
      imageUrls: Array.from(new Set(imageUrls)),
      title,
    }
  } catch (error) {
    logger.error(`读取HTML文件失败 ${htmlFilePath}: ${error.message}`)
    return { imageUrls: [], title: path.basename(htmlFilePath, '.html') }
  }
}
