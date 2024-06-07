const config = {
  // 解析模式 'singleSite' 单个站点 | 'multipleSites' 多个站点
  extractMode: 'singleSite',
  // 下载模式 'downloadAllImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadOriginImagesByThumbnails',
  // 目标解析网站
  url: 'https://chpic.su/en/stickers/natsumeyujincho/',
  // 多个目标解析网站
  urls: [],
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 重试次数
  retriesCount: 5,
  // 最大并发请求数（每一轮）
  maxConcurrentRequests: 20,
  // 最大请求间隔时间（毫秒）
  maxIntervalMs: 1000,
  // 最小请求间隔时间（毫秒）
  minIntervalMs: 100,
  // 下载的文件夹路径（不填默认根据网页标题创建文件夹，下载到download文件夹）
  downloadFolderPath: '',
}

export { config }
