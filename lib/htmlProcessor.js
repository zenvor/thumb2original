// 聚合导出，保持对外 API 不变
export { loadAndScrollPage } from './pageLoader.js'
export { extractImageUrls, extractImageUrlsFromLocalHtml } from './imageExtractor.js'
export { processUrlsByImageMode } from './imageModeProcessor.js'
export { processLocalHtmlMode, scanHtmlFiles } from './localHtmlProcessor.js'