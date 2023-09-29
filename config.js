const config = {
  // 运行模式 'parseWebPage' | 'parseFile'
  runningMode: 'parseWebPage',
  // 下载模式 'downloadAllImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadAllImages',
  // 目标解析网站
  targetCrawlingWebPageLink: 'https://nuxt.com/',
  // 下载的目标文件路径（不填默认根据网页标题创建文件夹，下载到download文件夹） 
  targetDownloadFolderPath: '',
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 重试次数
  retriesCount: 5,
  // 最大并发请求数（每一轮）
  maxConcurrentRequests: 25,
  // 最大请求间隔时间（毫秒）
  maxIntervalMs: 5000,
  // 最小请求间隔时间（毫秒）
  minIntervalMs: 500,
  // 目标读取文件路径
  targetReadFilePath: '',
}

export { config }
