/**
 * 浏览器端图片提取客户端脚本
 * 在 page.evaluate() 中执行，提取页面中的所有图片 URL
 */

// 工具函数：获取元素的 href 或 xlink:href 属性
function getHrefOrXlink(element) {
  return element.getAttribute('href') || element.getAttribute('xlink:href')
}

// 工具函数：获取绝对 URL
function getAbsoluteUrl(url, baseUrl, opts) {
  if (!url || typeof url !== 'string') return null
  if (!opts.includeDataUri && url.startsWith('data:')) return null
  try {
    return new URL(url, baseUrl).href
  } catch (e) {
    return null
  }
}

// 工具函数：从节点列表收集属性值
function collectFromNodeList(nodeList, attr, baseUrl, opts) {
  const results = []
  nodeList.forEach((el) => {
    const raw = el.getAttribute(attr)
    const abs = getAbsoluteUrl(raw, baseUrl, opts)
    if (abs) results.push(abs)
  })
  return results
}

// 工具函数：按图片扩展名过滤
function filterByImageExtension(urls) {
  const imageRegex = /\.(jpg|jpeg|png|gif|bmp|webp|svg|tiff|avif|ico)$/i
  return urls.filter((u) => {
    if (!u) return false
    if (typeof u === 'string' && u.startsWith('data:image/')) return true
    return imageRegex.test(u.split('?')[0])
  })
}

// 简化的 CSS URL 提取
function extractUrlFromCss(val, pageUrl, options) {
  if (!val || !val.includes('url(')) return null
  
  const start = val.indexOf('url(') + 4
  const end = val.indexOf(')', start)
  if (end === -1) return null
  
  let content = val.slice(start, end).trim()
  if ((content.startsWith('"') && content.endsWith('"')) || 
      (content.startsWith("'") && content.endsWith("'"))) {
    content = content.slice(1, -1)
  }
  
  if (!content) return null
  
  if (content.startsWith('data:')) {
    if (!options.includeDataUri) return null
    try {
      return decodeURIComponent(content)
    } catch {
      return content
    }
  }
  
  return getAbsoluteUrl(content, pageUrl, options)
}

// 简化的内联 SVG 处理
function processInlineSvg(svg, options) {
  if (!options.includeDataUri) return null
  try {
    const xml = new XMLSerializer().serializeToString(svg)
    const encoded = encodeURIComponent(xml)
    return `data:image/svg+xml,${encoded}`
  } catch {
    return null
  }
}

// 工具函数：从 srcset 属性中提取图片 URL
function extractUrlsFromSrcset(srcsetValue, pageUrl, options) {
  const results = []
  if (!srcsetValue) return results
  
  // 解析 srcset 值 - 格式: "URL 1x, URL 2x" 或 "URL 400w, URL 800w"
  const entries = srcsetValue.split(',')
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (!trimmed) continue
    
    // 找到最后一个空格，前面是URL，后面是descriptor
    const lastSpaceIndex = trimmed.lastIndexOf(' ')
    let url
    if (lastSpaceIndex > 0) {
      url = trimmed.substring(0, lastSpaceIndex).trim()
    } else {
      // 没有descriptor的情况，整个就是URL
      url = trimmed
    }
    
    if (url) {
      const abs = getAbsoluteUrl(url, pageUrl, options)
      if (abs) results.push(abs)
    }
  }
  
  return results
}

// 1. IMG 标签提取
function extractFromImgElements(pageUrl, options) {
  const results = []
  
  // IMG src
  results.push(...collectFromNodeList(document.querySelectorAll('img[src]'), 'src', pageUrl, options))
  
  // IMG srcset
  if (options.includeSrcset) {
    document.querySelectorAll('img[srcset]').forEach(img => {
      const srcsetValue = img.getAttribute('srcset')
      results.push(...extractUrlsFromSrcset(srcsetValue, pageUrl, options))
    })
  }
  
  // 延迟加载属性
  const lazyAttrs = ['data-src', 'data-original', 'data-lazy-src']
  lazyAttrs.forEach(attr => {
    results.push(...collectFromNodeList(document.querySelectorAll(`img[${attr}]`), attr, pageUrl, options))
  })
  
  return results
}

// 2. Meta 标签提取
function extractFromMetaTags(pageUrl, options) {
  const metaContent = []
  document.querySelectorAll('meta[content]').forEach(m => {
    const content = m.getAttribute('content')
    const abs = getAbsoluteUrl(content, pageUrl, options)
    if (abs) metaContent.push(abs)
  })
  return filterByImageExtension(metaContent)
}

// 3. Favicon 提取
function extractFavicons(pageUrl, options) {
  const results = []
  
  // 直接 favicon
  const faviconSelectors = ['link[rel="shortcut icon"]', 'link[rel="icon"]']
  faviconSelectors.forEach(selector => {
    const el = document.querySelector(selector)
    if (el) {
      const href = el.getAttribute('href')
      const abs = getAbsoluteUrl(href, pageUrl, options)
      if (abs) results.push(abs)
    }
  })
  
  // 其他 link 标签
  const linkHrefs = collectFromNodeList(document.querySelectorAll('link[href]'), 'href', pageUrl, options)
  results.push(...filterByImageExtension(linkHrefs))
  
  return results
}

// 4. CSS 背景图片提取
function extractFromCssBackgrounds(pageUrl, options) {
  const results = []
  const elements = document.querySelectorAll('[style*="background-image"], [class]')
  
  elements.forEach(el => {
    // 先检查内联样式
    if (el.style.backgroundImage) {
      const bgUrl = extractUrlFromCss(el.style.backgroundImage, pageUrl, options)
      if (bgUrl) results.push(bgUrl)
    }
    
    // 只对有class的元素检查计算样式
    if (el.className) {
      const style = getComputedStyle(el)
      const bg = style.getPropertyValue('background-image')
      if (bg && bg !== 'none') {
        const bgUrl = extractUrlFromCss(bg, pageUrl, options)
        if (bgUrl) results.push(bgUrl)
      }
      
      const svgVar = style.getPropertyValue('--svg')
      if (svgVar) {
        const svgUrl = extractUrlFromCss(svgVar, pageUrl, options)
        if (svgUrl) results.push(svgUrl)
      }
    }
  })
  
  return results
}

// 5. SVG 相关提取（降低嵌套深度）
function extractFromSvgElements(pageUrl, options) {
  const results = []
  
  // SVG use 元素
  document.querySelectorAll('use').forEach(useEl => {
    const ref = getHrefOrXlink(useEl)
    if (!ref) return
    
    if (ref.startsWith('#') && options.includeDataUri) {
      const id = ref.slice(1)
      const symbolEl = document.getElementById(id)
      if (symbolEl) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg">${symbolEl.outerHTML}<use href="#${id}"/></svg>`
        try {
          const encoded = encodeURIComponent(svg)
          results.push(`data:image/svg+xml,${encoded}`)
        } catch {}
      }
    } else {
      const abs = getAbsoluteUrl(ref, pageUrl, options)
      if (abs) results.push(abs)
    }
  })
  
  // 内联 SVG 处理
  if (options.includeInlineSvg) {
    document.querySelectorAll('svg').forEach(svg => {
      const dataUrl = processInlineSvg(svg, options)
      if (dataUrl) results.push(dataUrl)
    })
    
    // SVG 内部图片
    document.querySelectorAll('svg image[href], svg image[*|href]').forEach(img => {
      const ref = getHrefOrXlink(img)
      const abs = getAbsoluteUrl(ref, pageUrl, options)
      if (abs) results.push(abs)
    })
  }
  
  return results
}

// 主提取函数
function extractAllImageSources(pageUrl, options) {
  const imgLike = [] // 不过滤扩展名的图片源
  const filteredOnly = [] // 需要扩展名过滤的源

  // 1. IMG 标签及延迟加载属性
  imgLike.push(...extractFromImgElements(pageUrl, options))

  // 2. 链接中的图片
  const anchorUrls = collectFromNodeList(document.querySelectorAll('a[href]'), 'href', pageUrl, options)
  filteredOnly.push(...filterByImageExtension(anchorUrls))

  // 3. Meta 标签图片
  filteredOnly.push(...extractFromMetaTags(pageUrl, options))

  // 4. Favicon
  if (options.includeFavicon) {
    imgLike.push(...extractFavicons(pageUrl, options))
  }

  // 5. CSS 背景图片
  if (options.includeCssBackgrounds) {
    imgLike.push(...extractFromCssBackgrounds(pageUrl, options))
  }

  // 6. SVG 相关
  imgLike.push(...extractFromSvgElements(pageUrl, options))

  return [...imgLike, ...filterByImageExtension(filteredOnly)]
}

// 导出主函数（在 page.evaluate 中调用）
function extractImageUrls(pageUrl, options) {
  if (!pageUrl || typeof pageUrl !== 'string') return []
  if (!options || typeof options !== 'object') return []
  
  const extractedUrls = extractAllImageSources(pageUrl, options)
  return Array.from(new Set(extractedUrls))
}
