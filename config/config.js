/**
 * ===================================================================================
 * 网站特殊处理配置
 * ===================================================================================
 */
export const siteConfigs = {
  'imx.to': {
    waitTime: 10000, // 等待页面加载时间 (毫秒) - 增加到大图片处理
    selectorWaitTime: 30000, // 等待元素加载时间 (毫秒) - 增加到大图片处理
    needsReferer: true, // 是否需要添加 Referer 头
    refererUrl: 'https://imx.to/', // Referer 头的值
    downloadStrategy: 'puppeteer', // 下载优先策略: 'axios' | 'puppeteer'
    // 针对 imx.to 的完整请求头配置，解决 503 错误
    customHeaders: {
      // 修复 Accept 头中的错字，防止服务端解析异常
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.9',
      'Cache-Control': 'max-age=0',
      Connection: 'keep-alive',
      DNT: '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'same-site',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
      'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    },
  },
  'chpic.su': {
    waitTime: 2000,
    selectorWaitTime: 5000,
    needsReferer: false,
    downloadStrategy: 'axios',
  },
  default: {
    waitTime: 5000, // 增加默认等待时间以处理大图片
    selectorWaitTime: 15000, // 增加默认选择器等待时间以处理大图片
    needsReferer: false,
    downloadStrategy: 'puppeteer',
  },
}

/**
 * ===================================================================================
 * 爬虫配置文件
 * ===================================================================================
 */
/**
 * @typedef {Object} ScraperConfig
 * @property {'single_page'|'multiple_pages'|'local_html'} scrapeMode 抓取模式
 * @property {'all'|'originals_only'} imageMode 图片模式
 * @property {string} [htmlDirectory]
 * @property {'name'|'mtime_asc'|'mtime_desc'} [htmlSortOrder]
 * @property {boolean} [enableMemory]
 * @property {string} [memoryDirectory]
 * @property {boolean} [forceReprocess]
 * @property {boolean} [lazyMemoryCreation]
 * @property {number} [maxFilesPerRun]
 * @property {boolean} [confirmLargeRun]
 * @property {{
 *   enableStealth?: boolean,
 *   enableAdvancedArgs?: boolean,
 *   windowSize?: string,
 *   userAgent?: string|null,
 *   randomizeFingerprint?: boolean
 * }} [antiDetection]
 * @property {string} [targetUrl]
 * @property {string[]} [targetUrls]
 * @property {string} [outputDirectory]
 * @property {number} [maxRetries]
 * @property {number} [retryDelayMs] 重试间隔（毫秒）
 * @property {number} [concurrentDownloads]
 * @property {number} [minRequestDelayMs]
 * @property {number} [maxRequestDelayMs]
 * @property {{
 *   pageTimeout?: number,
 *   navigationTimeout?: number,
 *   maxPageRetries?: number,
 *   retryDelay?: number,
 *   enableErrorRecovery?: boolean,
 *   connectionCheckInterval?: number
 * }} [stability]
 * @property {{
 *   includeInlineSvg?: boolean,
 *   includeFavicon?: boolean,
 *   includeCssBackgrounds?: boolean,
 *   includeDataUri?: boolean,
 *   includeSrcset?: boolean
 * }} [imageDiscovery]
 * @property {{
 *   retryHtmlAsFailure?: boolean
 * }} [htmlHandling]
 * @property {{
 *   logImageUrls?: boolean
 * }} [debug]
 * @property {{
 *   enableConversion?: boolean,
 *   // 全局转换策略：将所有图片统一转换为指定格式；'none' 表示不转换
 *   // 支持的目标格式：'jpeg' | 'png' | 'webp' | 'tiff' | 'none'
 *   // 说明：SVG/AVIF 目前仅做格式识别，不参与 convert（sharp 不直接支持 SVG→位图；AVIF 识别但此处未启用 AVIF 输出）。
 *   convertTo?: 'jpeg'|'png'|'webp'|'tiff'|'none'
 * }} [format]
 */

/** @type {ScraperConfig} */
export const scraperConfig = {
  // --- 核心模式 ---
  scrapeMode: 'multiple_pages', // 抓取模式: 'single_page' (单页) | 'multiple_pages' (多页) | 'local_html' (本地HTML爬虫模式)
  imageMode: 'all', // 图片模式: 'all' (所有图片) | 'originals_only' (仅原图)

  // --- 图片发现范围（可控开关） ---
  imageDiscovery: {
    includeInlineSvg: false, // 是否包含内联 SVG（仅当能解析出外链或 data 引用时有效）
    includeFavicon: false, // 是否包含网站 favicon（link rel="icon" 等）
    includeCssBackgrounds: false, // 是否解析 CSS background-image/url(...) 与 --svg 变量
    includeDataUri: false, // 是否包含 data:image/* URI（可能带来噪声，默认关闭）
    includeSrcset: false, // 是否解析 img 标签的 srcset 属性中的图片链接（默认开启）
  },

  // --- HTML 页面处理策略 ---
  htmlHandling: {
    retryHtmlAsFailure: true, // 遇到 HTML 响应时直接标记为失败并重试，而非尝试解析页面内容（默认开启，更简洁稳定）
  },

  // --- 调试选项 ---
  debug: {
    logImageUrls: false, // 是否打印所有原始图片链接（调试用）
  },

  // --- 本地HTML爬虫模式配置 ---
  htmlDirectory: './html', // 本地HTML文件目录路径
  htmlSortOrder: 'name', // HTML文件排序方式: 'name' (按文件名，默认) | 'mtime_asc' (按修改时间从旧到新) | 'mtime_desc' (按修改时间从新到旧)

  // 记忆功能配置
  enableMemory: true, // 是否启用记忆功能，跳过已处理的HTML文件
  memoryDirectory: './memory', // 记忆目录路径（每个HTML文件对应一个JSONL文件）
  forceReprocess: false, // 是否强制重新处理所有文件（忽略记忆）
  lazyMemoryCreation: true, // 是否启用懒加载模式，只在实际处理时创建JSONL文件
  maxFilesPerRun: 390, // 每次运行最大处理文件数量（0表示无限制）
  confirmLargeRun: false, // 处理大量文件前是否需要用户确认（检测到超过100个HTML文件时会提示用户确认）

  // --- 反检测配置 ---
  antiDetection: {
    enableStealth: true, // 是否启用 stealth 插件
    enableAdvancedArgs: true, // 是否启用高级浏览器参数
    windowSize: '1366,768', // 浏览器窗口大小
    userAgent: null, // 自定义 User Agent (null 则使用默认)
    randomizeFingerprint: false, // 是否随机化浏览器指纹 (需要额外插件)
  },

  // --- 目标 URL ---
  targetUrl: 'https://nuxt.com/', // 目标网址 (单页模式)
  targetUrls: [
    // 目标网址列表 (多页模式)
    // 'https://www.duitang.com/category/?cat=wallpaper',
    // 'https://www.duitang.com/category/?cat=wallpaper#!hot-p2',
    // 'https://nuxt.com/'
  ],

  // --- 下载行为 ---
  // outputDirectory: '/Volumes/PSSD/外部/picture/download', // 图片输出目录 (留空则默认在 ./download 下，并以网页标题命名)
  outputDirectory: '', // 图片输出目录 (留空则默认在 ./download 下，并以网页标题命名)
  maxRetries: 1, // 下载失败后的最大重试次数
  retryDelayMs: 5000, // 每次重试的间隔时间 (毫秒)

  // --- 性能与反爬虫 ---
  concurrentDownloads: 10, // 并发下载数 (降低并发以避免 503 错误)
  minRequestDelayMs: 2000, // 两批次下载之间的最小延迟 (毫秒) - 增加延迟
  maxRequestDelayMs: 4000, // 两批次下载之间的最大延迟 (毫秒) - 增加延迟

  // --- 稳定性配置 ---
  stability: {
    pageTimeout: 60000, // 页面操作超时时间 (毫秒)
    navigationTimeout: 60000, // 页面导航超时时间 (毫秒)
    maxPageRetries: 3, // 页面加载失败最大重试次数
    retryDelay: 2000, // 重试间隔时间 (毫秒)
    enableErrorRecovery: true, // 是否启用错误恢复机制
    connectionCheckInterval: 30000, // 浏览器连接检查间隔 (毫秒)
  },

  // --- 图片格式处理 ---
  format: {
    // 是否启用图像格式转换（全局开关）
    enableConversion: true,
    // 全局转换策略：'jpeg' | 'png' | 'webp' | 'tiff' | 'none'
    // 说明：SVG/AVIF 会被识别用于统计，但不做格式转换（仅识别不转换）。
    // 默认统一转换为 PNG（与历史默认“WebP→PNG”对齐，同时提供全局统一策略）
    convertTo: 'none',
    // 防止文件名冲突：当同名文件存在时，在文件名后添加URL路径的哈希后缀
    preventNameCollision: false,
  },

  // --- 图片分析（P0 预留并启用） ---
  analysis: {
    // 预设模式（后续映射在校验器中实现）：'strict' | 'balanced' | 'loose'
    preset: 'balanced',
    // 开启严格模式：元数据解析异常将直接判定为 metadata_error 已确认默认行为，无需必填
    // strictValidation: false,
    enableDetailLog: false,
    // P1：可观测性 - 是否输出每张分析耗时的 debug 日志
    logAnalyzeCost: false,
    sampleRate: 100,
    // 显式覆盖动态采样
    /**
     * 小建议
     * 小批量想看更细日志：设置较小值（例如 50）。
     * 大批量想降噪固定间隔：设置较大值（例如 1000）。
     * 若不配置，则自动根据任务规模动态调整，无需手动干预。
     */
    // effectiveSampleRate: 500,  // ≥1 的正数，小值=更频繁日志
    timeoutMs: 10000,
    minBufferSize: 100,
    maxAnalyzableSizeInMB: 50,
    // P1：超过该阈值视为“耗时较长”样本，输出 info 级日志
    longCostWarnMs: 2000,
    // P1：axios 放宽二进制类型接受；true 为允许常见二进制与缺失 content-type
    acceptBinaryContentTypes: true,
    // P2：twoPhase 模式配置（默认 inline）
    // 支持: 'inline' | 'twoPhase' | 'twoPhaseApi'
    // - inline: 分析与下载同步进行（现有默认逻辑）
    // - twoPhase: 先分析写入临时文件，再统一读取临时文件进行下载
    // - twoPhaseApi: 仅执行分析并写入临时文件，跳过下载（供 API 使用）
    mode: 'inline',
    tempDir: './.tmp_analysis',
    cleanupTempOnComplete: true,
    // 冷启动清理与内存持有（按需调整）
    cleanupTempOnStart: true,
    maxHoldBuffers: 0,
  },
}

// 测试与开发者指南：
// - 统一的测试说明与最佳实践（mockClear vs mockReset 等）请参考 ../tests/TESTING_GUIDE.md
// - 统计口径：最终格式统计由 lib/fileManager.js/saveImage() 在“实际落盘后的最终格式”上计数，twoPhase/重试模式下通过共享引用对象聚合。

/**
 * @description 根据 URL 获取网站配置。
 * @param {string} imageUrl - 图片 URL。
 * @returns {object} 网站配置对象。
 */
export function getSiteConfig(imageUrl) {
  for (const [domain, config] of Object.entries(siteConfigs)) {
    if (domain !== 'default' && imageUrl.includes(domain)) {
      return { ...siteConfigs.default, ...config, domain }
    }
  }
  return { ...siteConfigs.default, domain: 'default' }
}
