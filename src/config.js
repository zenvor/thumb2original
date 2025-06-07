const config = {
  // 解析模式 'singleSite' 单个站点 | 'multipleSites' 多个站点
  extractMode: 'singleSite',
  // 下载模式 'downloadAllImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadOriginImagesByThumbnails',
  // 目标解析网站
  url: 'https://www.duitang.com/blog/?id=1507598814',
  // 多个目标解析网站
  urls: [],
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 重试次数
  retriesCount: 1,
  // 最大并发请求数（每一轮）
  maxConcurrentRequests: 30,
  // 最大请求间隔时间（毫秒）
  maxIntervalMs: 100,
  // 最小请求间隔时间（毫秒）
  minIntervalMs: 50,
  // 下载的文件夹路径（不填默认根据网页标题创建文件夹，下载到download文件夹）
  downloadFolderPath: '',
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
}

export { config }
