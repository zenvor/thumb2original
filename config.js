const config = {
  // 解析模式 'singleSite' 单个站点 | 'multipleSites' 多个站点
  extractMode: 'multipleSites',
  // 下载模式 'downloadAllImages' | 'downloadOriginImagesByThumbnails'
  downloadMode: 'downloadOriginImagesByThumbnails',
  // 目标解析网站
  targetCrawlingWebPageLink: '',
  // 多个目标解析网站
  targetCrawlingWebPageLinks: [
    // 'https://viper.to/threads/7410802-2018-04-30-Cali-The-Color-of-Spring-x103-4000px?highlight=The+Color+of+Spring',
    // 'https://vipergirls.to/threads/7517601-Sandra-Cali-Chanel-Fenn-Victoria-Minina?p=118528410',
    // 'https://viper.to/threads/6241620-Cali-The-color-of-spring-2?highlight=The+Color+of+Spring',
    // 'https://viper.to/threads/6239128-Cali-The-color-of-spring?highlight=The+Color+of+Spring',
    // 'https://viper.to/threads/4740828-2018-04-30-Cali-The-Color-of-Spring-(x104)-2671x4000?highlight=The+Color+of+Spring',
    'https://vipergirls.to/threads/3493182-MPL-Promo-Banners-Video-Trailers-amp-Pic-o-the-Days-Updated-Daily-(After-Feb-17-2018)/page23',
  ],
  // 重试间隔(秒钟)-如果有下载失败的照片，服务会等待一段时间，然后重新下载请求失败的照片，默认 5 秒钟
  retryInterval: 5,
  // 重试次数
  retriesCount: 5,
  // 最大并发请求数（每一轮）
  maxConcurrentRequests: 10,
  // 最大请求间隔时间（毫秒）
  maxIntervalMs: 1000,
  // 最小请求间隔时间（毫秒）
  minIntervalMs: 100,
  // 下载的文件夹路径（不填默认根据网页标题创建文件夹，下载到download文件夹）
  downloadFolderPath: '',
}

export { config }
