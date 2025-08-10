# 缩略图转原图爬虫工具

一个功能强大的图片爬虫工具，支持从网页和本地HTML文件中提取图片URL，并自动将缩略图转换为原图进行下载。

注：本地 HTML 模式由核心库 `@crawler/core` 提供实现，CLI 仅负责配置与调用，无需维护重复工具函数。

## 安装 @crawler/core（通过 GitHub 引用）

在 `package.json` 中直接通过 GitHub tag 引用（固定版本，保证可重复构建）：

```json
{
  "dependencies": {
    "@crawler/core": "github:zenvor/crawler-core#v0.1.0"
  }
}
```

> 发布说明与历史版本：参见 [crawler-core Releases](https://github.com/zenvor/crawler-core/releases)（当前稳定版本：[v0.1.0](https://github.com/zenvor/crawler-core/releases/tag/v0.1.0)）。

## 功能特性

- **多种爬虫模式**：
  - `single_page`：单页面爬虫模式
  - `multiple_pages`：多页面爬虫模式
  - `local_html`：**本地HTML爬虫模式**（新增）

- **智能图片处理**：
  - 自动识别图片格式
  - 缩略图到原图URL转换
  - WebP格式自动转换为PNG
  - 图片去重处理

- **高级下载功能**：
  - 并发下载控制
  - 失败重试机制
  - 随机延迟防反爬
  - 进度实时显示

- **🛡️ 反检测功能**（新增）：
  - 集成 puppeteer-extra + stealth 插件
  - 自动隐藏浏览器自动化痕迹
  - 模拟真实用户行为
  - 绕过 Cloudflare 等反爬虫系统
  - 可配置的反检测强度

## 项目安装

```bash
npm install
```

### 安装Chrome浏览器（Puppeteer需要）

```bash
npx puppeteer browsers install chrome
```

## 使用方法

### 1. 配置

所有配置项均在 `config/config.js` 文件中设置：

```javascript
const scraperConfig = {
  scrapeMode: 'single_page', // 或 'multiple_pages'
  targetUrl: 'https://example.com/gallery',
  imageMode: 'originals_only',
  
  // 反检测配置（新增）
  antiDetection: {
    enableStealth: true,        // 启用 stealth 插件
    enableAdvancedArgs: true,   // 启用高级浏览器参数
    windowSize: '1366,768',     // 浏览器窗口大小
    userAgent: null,            // 自定义 User Agent
    randomizeFingerprint: false // 随机化浏览器指纹
  },
  // 其他配置...
}
```



```javascript
const scraperConfig = {
  scrapeMode: 'local_html',
  htmlDirectory: './html',
  imageMode: 'originals_only',
  // 其他配置...
}
```

详细说明请参考：[本地HTML爬虫模式使用说明](./LOCAL_HTML_MODE.md)

### 2. 运行爬虫

```bash
# 推荐使用 npm start
npm start

# 或者直接运行主入口
node index.js
```

### 3. 特殊站点 e2e 与故障排除（chpic.su / imx.to）

- 运行指引请参考根级文档：`../docs/special-sites-e2e.md`
- 故障排除：`../docs/troubleshooting-imx-to.md`

## 配置选项

| 配置项 | 说明 | 可选值 |
|--------|------|--------|
| `scrapeMode` | 爬虫模式 | `single_page`, `multiple_pages`, `local_html` |
| `imageMode` | 图片模式 | `all`, `originals_only` |
| `htmlDirectory` | HTML文件目录 | 相对或绝对路径 |
| `outputDirectory` | 输出目录 | 默认为 `./download` |
| `concurrentDownloads` | 并发下载数 | 数字，默认10 |
| `maxRetries` | 最大重试次数 | 数字，默认3 |

## 模块化架构

项目采用模块化设计，代码组织清晰：

- **config/**: 配置管理模块
- **lib/**: 核心功能模块
- **utils/**: 通用工具模块
- **index.js**: 简洁的主入口文件

## 📚 详细文档

- 文档导航（唯一来源）：`../README.md`
- 特殊站点 e2e：`../docs/special-sites-e2e.md`
- imx.to 故障排除：`../docs/troubleshooting-imx-to.md`

## 🔧 故障排除

### 反爬虫拦截问题
如果遇到反爬虫拦截问题，请参考 [反检测功能使用指南](./ANTI_DETECTION.md) 进行配置调整。

### 503 错误问题
如果在下载 imx.to 域名图片时遇到 503 Service Temporarily Unavailable 错误，请参考 [imx.to 域名 503 错误解决方案](./IMX_TO_503_FIX.md)。

## 开发和调试

```bash
# 开发模式运行
npm run serve

# 直接运行主入口
node index.js
```
