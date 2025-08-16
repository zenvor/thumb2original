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
  logger.info('正在从页面中提取图片 URL...')
  
  const {
    includeInlineSvg = false,
    includeFavicon = false,
    includeCssBackgrounds = false,
    includeDataUri = false,
  } = discoveryOptions || {}

  const imageUrls = await page.evaluate(
    (baseUrl, opts) => {
      // 工具函数定义
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
        const results = []
        nodeList.forEach((el) => {
          const raw = el.getAttribute(attr)
          const abs = getAbsoluteUrl(raw)
          if (abs) results.push(abs)
        })
        return results
      }

      function filterByImageLike(urls) {
        const imageRegex = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|avif|ico)$/i
        return urls.filter((u) => {
          if (!u) return false
          if (opts.includeDataUri && typeof u === 'string' && u.startsWith('data:image/')) return true
          return imageRegex.test(u.split('?')[0])
        })
      }

      // 图片提取模块函数（在浏览器环境中定义）
      function extractFromImgElements(collectFromNodeList) {
        const results = []
        
        // IMG src
        results.push(...collectFromNodeList(document.querySelectorAll('img[src]'), 'src'))
        
        // 延迟加载属性
        const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src']
        lazyAttrs.forEach(attr => {
          results.push(...collectFromNodeList(document.querySelectorAll(`img[${attr}]`), attr))
        })
        
        return results
      }

      function extractFromMetaTags(getAbsoluteUrl, filterByImageLike) {
        const metaContent = []
        document.querySelectorAll('meta[content]').forEach(m => {
          const content = m.getAttribute('content')
          const abs = getAbsoluteUrl(content)
          if (abs) metaContent.push(abs)
        })
        return filterByImageLike(metaContent)
      }

      function extractFavicons(getAbsoluteUrl, collectFromNodeList, filterByImageLike) {
        const results = []
        
        // 直接 favicon
        const faviconSelectors = ['link[rel="shortcut icon"]', 'link[rel="icon"]']
        faviconSelectors.forEach(selector => {
          const el = document.querySelector(selector)
          if (el) {
            const href = el.getAttribute('href')
            const abs = getAbsoluteUrl(href)
            if (abs) results.push(abs)
          }
        })
        
        // 其他 link 标签
        const linkHrefs = collectFromNodeList(document.querySelectorAll('link[href]'), 'href')
        results.push(...filterByImageLike(linkHrefs))
        
        return results
      }

      function extractFromCssBackgrounds(getAbsoluteUrl, opts) {
        const results = []
        const elements = document.querySelectorAll('[class]')
        
        const extractUrlFromCss = (val) => {
          if (!val || !val.startsWith('url(')) return null
          
          // 统一解析策略：提取括号内容并去除引号
          let content = val.slice(4, -1) // 去掉 url( 和 )
          content = content.replace(/^["']|["']$/g, '') // 去除首尾引号
          
          if (!content) return null
          
          // data: URI 处理
          if (content.startsWith('data:')) {
            if (!opts.includeDataUri) return null
            try {
              return decodeURIComponent(content)
            } catch {
              return content
            }
          }
          
          // 其他 URL 统一绝对化处理
          return getAbsoluteUrl(content)
        }
        
        elements.forEach(el => {
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

      function extractFromSvgElements(getAbsoluteUrl, opts) {
        const results = []
        
        // SVG use 元素
        document.querySelectorAll('use').forEach(useEl => {
          const ref = useEl.getAttribute('href') || useEl.getAttribute('xlink:href')
          if (!ref) return
          
          if (ref.startsWith('#')) {
            if (opts.includeDataUri) {
              const id = ref.slice(1)
              const symbolEl = document.getElementById(id)
              if (symbolEl) {
                try {
                  const svg = `<svg xmlns="http://www.w3.org/2000/svg">${symbolEl.outerHTML}<use href="#${id}"/></svg>`
                  const encoded = encodeURIComponent(svg)
                  results.push(`data:image/svg+xml,${encoded}`)
                } catch {}
              }
            }
          } else {
            const abs = getAbsoluteUrl(ref)
            if (abs) results.push(abs)
          }
        })
        
        // 内联 SVG
        if (opts.includeInlineSvg) {
          document.querySelectorAll('svg').forEach(svg => {
            try {
              const xml = new XMLSerializer().serializeToString(svg)
              const encoded = encodeURIComponent(xml)
              const dataUrl = `data:image/svg+xml,${encoded}`
              if (opts.includeDataUri) results.push(dataUrl)
            } catch {}
          })
          
          // SVG 内部图片
          document.querySelectorAll('svg image[href], svg image[xlink\\:href]').forEach(img => {
            const ref = img.getAttribute('href') || img.getAttribute('xlink:href')
            const abs = getAbsoluteUrl(ref)
            if (abs) results.push(abs)
          })
        }
        
        return results
      }

      // 主要提取逻辑
      function extractAllImageSources(getAbsoluteUrl, collectFromNodeList, filterByImageLike, opts) {
        const imgLike = [] // 不过滤扩展名的图片源
        const filteredOnly = [] // 需要扩展名过滤的源

        // 1. IMG 标签及延迟加载属性
        imgLike.push(...extractFromImgElements(collectFromNodeList))

        // 2. 链接中的图片
        const anchorUrls = collectFromNodeList(document.querySelectorAll('a[href]'), 'href')
        filteredOnly.push(...filterByImageLike(anchorUrls))

        // 3. Meta 标签图片
        filteredOnly.push(...extractFromMetaTags(getAbsoluteUrl, filterByImageLike))

        // 4. Favicon
        if (opts.includeFavicon) {
          imgLike.push(...extractFavicons(getAbsoluteUrl, collectFromNodeList, filterByImageLike))
        }

        // 5. CSS 背景图片
        if (opts.includeCssBackgrounds) {
          imgLike.push(...extractFromCssBackgrounds(getAbsoluteUrl, opts))
        }

        // 6. SVG 相关
        imgLike.push(...extractFromSvgElements(getAbsoluteUrl, opts))

        return [...imgLike, ...filterByImageLike(filteredOnly)]
      }

      const extractedUrls = extractAllImageSources(getAbsoluteUrl, collectFromNodeList, filterByImageLike, opts)
      return Array.from(new Set(extractedUrls))
    },
    pageUrl,
    { includeInlineSvg, includeFavicon, includeCssBackgrounds, includeDataUri }
  )

  // WebP 变体处理
  const webpVariations = imageUrls.filter(url => url.includes('_webp')).map(url => url.replace('_webp', ''))
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
export async function extractImageUrlsFromLocalHtml(htmlFilePath, options = {}) {
  try {
    const htmlContent = await fs.readFile(htmlFilePath, 'utf-8')
    const fileName = path.basename(htmlFilePath, '.html')
    
    const { imageUrls, title } = parseHtmlForImages(htmlContent, fileName, options)
    
    logger.debug(`从 ${path.basename(htmlFilePath)} 提取到 ${imageUrls.length} 个图片URL`)
    
    return { imageUrls, title }
  } catch (error) {
    logger.error(`读取HTML文件失败 ${htmlFilePath}: ${error.message}`)
    return { imageUrls: [], title: path.basename(htmlFilePath, '.html') }
  }
}

/**
 * 从HTML内容中解析图片URL和标题
 * @param {string} htmlContent HTML内容
 * @param {string} fileName 文件名（作为默认标题）
 * @param {object} options 选项
 * @returns {{imageUrls: string[], title: string}}
 */
function parseHtmlForImages(htmlContent, fileName, options = {}) {
  const imageUrls = []
  const includeDataUri = !!options.includeDataUri
  
  // 简化策略：使用 indexOf 和 substring 替代复杂正则
  let searchIndex = 0
  while (true) {
    // 查找 <img 标签
    const imgStart = htmlContent.indexOf('<img', searchIndex)
    if (imgStart === -1) break
    
    // 查找该img标签的结束
    const imgEnd = htmlContent.indexOf('>', imgStart)
    if (imgEnd === -1) break
    
    const imgTag = htmlContent.substring(imgStart, imgEnd + 1)
    
    // 提取 src 属性
    const src = extractSrcFromImgTag(imgTag)
    if (src) {
      if (src.startsWith('data:')) {
        if (includeDataUri) imageUrls.push(src)
      } else {
        imageUrls.push(src)
      }
    }
    
    searchIndex = imgEnd + 1
  }
  
  // 提取标题 - 同样使用简单字符串操作
  const title = extractTitleFromHtml(htmlContent) || fileName
  
  return {
    imageUrls: Array.from(new Set(imageUrls)),
    title
  }
}

/**
 * 从img标签中提取src属性值
 * @param {string} imgTag img标签字符串
 * @returns {string|null} src属性值
 */
function extractSrcFromImgTag(imgTag) {
  // 查找 src=" 或 src='
  const srcDoubleQuote = imgTag.indexOf('src="')
  const srcSingleQuote = imgTag.indexOf("src='")
  
  let srcStart, quote
  if (srcDoubleQuote !== -1 && (srcSingleQuote === -1 || srcDoubleQuote < srcSingleQuote)) {
    srcStart = srcDoubleQuote + 5 // 'src="'.length
    quote = '"'
  } else if (srcSingleQuote !== -1) {
    srcStart = srcSingleQuote + 5 // "src='".length  
    quote = "'"
  } else {
    return null
  }
  
  const srcEnd = imgTag.indexOf(quote, srcStart)
  if (srcEnd === -1) return null
  
  return imgTag.substring(srcStart, srcEnd)
}

/**
 * 从HTML中提取title标签内容
 * @param {string} htmlContent HTML内容
 * @returns {string|null} 标题内容
 */
function extractTitleFromHtml(htmlContent) {
  const titleStart = htmlContent.indexOf('<title')
  if (titleStart === -1) return null
  
  const titleContentStart = htmlContent.indexOf('>', titleStart)
  if (titleContentStart === -1) return null
  
  const titleEnd = htmlContent.indexOf('</title>', titleContentStart)
  if (titleEnd === -1) return null
  
  return htmlContent.substring(titleContentStart + 1, titleEnd).trim()
}
