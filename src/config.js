const config = {
  // 解析模式 'singleSite' 单个站点 | 'multipleSites' 多个站点
  extractMode: 'singleSite',
  // 下载模式 'downloadAllImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadAllImages',
  // 目标解析网站
  url: 'https://www.duitang.com/blog/?id=1507598814',
  // url: 'file:///Users/claude/Projects/%E4%B8%AA%E4%BA%BA%E9%A1%B9%E7%9B%AE/%E7%88%AC%E8%99%AB/web-crawler-nodejs/%E6%B5%8B%E8%AF%95%E9%A1%B5%E9%9D%A2.html',
  // url: 'https://www.duitang.com/category/?cat=wallpaper',
  // url: 'https://wallspic.com/cn/album/for_mobile',
  // 多个目标解析网站
  urls: [],
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 重试次数
  retriesCount: 1,
  // 最大并发请求数（每一轮）
  maxConcurrentRequests: 15,
  // 最大请求间隔时间（毫秒）
  maxIntervalMs: 100,
  // 最小请求间隔时间（毫秒）
  minIntervalMs: 50,
  // 下载的文件夹路径（不填默认根据网页标题创建文件夹，下载到download文件夹）
  downloadFolderPath: '',
  // 浏览器配置
  browser: {
    headless: false,
  },
  // 日志级别控制 'debug' | 'info' | 'warn' | 'error'
  // debug: 显示所有日志（调试、信息、警告、错误）
  // info: 显示信息、警告、错误日志
  // warn: 显示警告、错误日志  
  // error: 仅显示错误日志
  logLevel: 'debug',
  // 是否启用高颜值进度条 (true: 启用cli-progress进度条, false: 使用传统日志输出)
  enableProgressBar: false,
  // 进度条更新频率 'realtime' | 'fast' | 'normal' | 'slow'
  // realtime: 实时更新，每次下载成功都立即显示 (60fps) 推荐使用 🔥
  // fast: 快速更新，每秒30次更新
  // normal: 正常更新，每秒10次更新（原设置）
  // slow: 缓慢更新，每秒5次更新
  progressUpdateFrequency: 'realtime',
  
  // 🧠 Page Pool 2.0 配置
  pagePoolStrategy: 'auto', // 'auto' | 'reuse' | 'progressive'
  
  // Page Pool 详细配置
  pagePool: {
    // 🧠 PWS (Page Weight Score) 权重配置
    pws: {
      weights: {
        images: 0.3,      // 图片数量权重 (30%)
        domNodes: 0.25,   // DOM节点权重 (25%)
        bytes: 0.25,      // 字节数权重 (25%)
        heap: 0.2         // 堆内存权重 (20%)
      }
    },
    
    // 🧠 Auto策略阈值配置
    autoThreshold: {
      pws: 50,              // PWS阈值，低于此值使用reuse策略
      freeMemPercent: 25    // 可用内存百分比阈值，低于此值强制使用progressive策略
    },
    
    // 🏆 Reuse策略健康检查配置
    reuse: {
      poolSize: 5,          // 默认页面池大小（已有logic会覆盖）
      maxReuse: 20,         // 单个页面最大复用次数
      maxHeap: 200,         // 堆内存使用上限 (MB)
      maxErrors: 3          // 连续5xx错误上限
    },
    
    // 🧠 Progressive策略配置
    progressive: {
      batchSize: 3,         // 批次大小（已有logic会覆盖）
      preloadNext: true     // 是否启用异步预热下一批页面
    },
    
    // 📊 监控配置
    monitor: {
      enableProm: false,    // 是否启用Prometheus指标（未实现）
      endpoint: '/metrics'  // 指标端点（未实现）
    }
  }
}

export { config }
