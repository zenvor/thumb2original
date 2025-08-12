# crawler-runner 重构计划

> 目标：在不破坏对外 API 的前提下，按单一职责与 KISS 原则逐步解耦，优先保障数据可靠性与基本用户体验。

## 一、当前状态

- 已完成：`lib/htmlProcessor.js` 违反单一职责的问题，拆分为：
  - `lib/pageLoader.js`（页面加载/反检测/滚动）
  - `lib/imageExtractor.js`（图片 URL 提取、本地 HTML 提取）
  - `lib/imageModeProcessor.js`（下载模式处理、缩略图→原图）
  - `lib/localHtmlProcessor.js`（本地 HTML 模式：扫描与处理）
  - `lib/htmlProcessor.js` 仅做聚合导出，保持对外 API 不变。

- 待处理：`scraper.js` 与 `lib/` 模块存在大量重复实现；`lib/downloadManager.js` 职责过重；`lib/imageDownloader.js` 策略混杂；`index.js` 入口承担过多业务逻辑。

## 二、重构原则

- 采用现代异步模式（Promise/async-await），避免状态机式复杂度。
- 单一职责：一个模块只做一件事并做好。
- 统一错误处理与日志风格，便于排障与观测。
- 简洁优先（KISS），避免为不确定需求做过度抽象。
- 渐进式变更，保持对外 API 与运行路径可用。

## 三、按优先级的重构建议

### A. 高优先级（先做）

1) 移除重复实现：`scraper.js`
- 问题：`scraper.js` 包含页面加载、图片提取、下载管理等逻辑，与 `lib/` 下模块重复（违反 DRY）。
- 行动：
  - 审核入口调用点（`package.json` → `index.js`），确认运行路径不依赖 `scraper.js`。
  - 迁移 `scraper.js` 中仍有价值而未合并的细节（若有）至对应模块；否则标记为废弃。
  - 将 `scraper.js` 移至 `legacy/` 或直接删除（推荐删除以降低维护负担）。

2) 拆分过重模块：`lib/downloadManager.js`
- 问题：集成了文件落盘、并发/重试调度、抓取编排 `scrapeUrl()` 多个职责。
- 建议拆分：
  - `lib/fileManager.js`：落盘、格式识别、WebP→PNG 转换、命名（`saveImage()` 等）。
  - `lib/downloadQueue.js`：并发控制、重试/退避、速率限制（只负责任务调度，不含下载细节）。
  - `lib/scraperOrchestrator.js`：编排单 URL 的完整抓取流程（依赖 `pageLoader`/`imageExtractor`/`imageModeProcessor`/`downloadQueue`）。
- 兼容策略：
  - `lib/downloadManager.js` 改为“门面层”聚合导出：`downloadManager()`、`scrapeUrl()` 内部委托至新模块，保持现有对外 API。

### B. 中优先级（随后）

3) 简化入口：`index.js`
- 问题：入口含浏览器启动参数构建、目录可写性校验、模式分支等业务细节。
- 拆分：
  - `lib/browserLauncher.js`：封装 Puppeteer 启动与 Stealth 插件启用。
  - `lib/configValidator.js`：默认值填充、路径校验、冲突检查（不引第三方依赖，保持轻量）。
- 入口仅做：初始化日志 → 校验配置 → 启动浏览器 → 调用编排器。

4) 策略下沉：`lib/imageDownloader.js`
- 问题：同时包含 Puppeteer 下载、Axios 下载、HTML 跳转处理、重试等逻辑，边界混乱。
- 拆分：
  - `lib/downloader/puppeteerDownloader.js`
  - `lib/downloader/axiosDownloader.js`
  - `lib/downloader/htmlPageHandler.js`（解析 HTML 页面内真正图片 URL）
  - 由 `downloadQueue` 统一承载重试/退避/并发，不在具体下载器重复实现。
- 选择策略：工厂/简单选择函数根据 `siteConfig` 或 URL 选择下载器。

### C. 低优先级（最后）

5) 配置管理统一化
- 汇总 `config/`、站点配置、运行时覆盖；提供默认值、校验与类型提示（JSDoc 类型即可）。
- 统一延迟/重试参数命名与单位（ms/秒），减少认知成本。

6) 日志与错误处理一致性
- 基于现有 `pino`：统一 level、category、字段（如下载 ID、URL、文件路径）。
- 约定错误分类：可重试/不可重试/用户配置错误/外部依赖错误。

## 四、目录与导出建议（示例）

```
lib/
  browserLauncher.js
  configValidator.js
  fileManager.js
  downloadQueue.js
  scraperOrchestrator.js
  downloader/
    axiosDownloader.js
    puppeteerDownloader.js
    htmlPageHandler.js
  // 既有：
  pageLoader.js
  imageExtractor.js
  imageModeProcessor.js
  localHtmlProcessor.js
  htmlProcessor.js        // 继续作为聚合导出保持兼容
  downloadManager.js      // 暂留为门面层，内部委托
```

导出兼容策略：
- 保持 `import { loadAndScrollPage, extractImageUrls, processUrlsByImageMode, processLocalHtmlMode } from 'lib/htmlProcessor.js'` 不变。
- 保持 `downloadManager`、`scrapeUrl` 的导入路径与签名不变。

## 五、实施顺序与验收标准

1) 移除 `scraper.js` 重复（或归档到 `legacy/`）
- 验收：`npm start` 跑通；`single_page`/本地 HTML 模式均可执行；无编译/运行期引用 `scraper.js`。

2) 拆分 `downloadManager.js`
- 验收：
  - 并发/重试/速率限制在 `downloadQueue` 生效（可通过日志观测）。
  - 文件保存由 `fileManager` 负责，WebP→PNG 仍正常。
  - `downloadManager`、`scrapeUrl` 对外行为与返回值不变。

3) 简化 `index.js`、细分 `imageDownloader.js`
- 验收：入口仅做编排；下载策略在新子模块内可单测；重试策略不再在多处重复。

## 六、风险与回滚

- 风险：隐藏耦合（共享工具/常量）在拆分后暴露；
- 缓解：小步提交、完善日志、为关键函数添加轻量单测/集成自检脚本；
- 回滚：保持门面层与聚合导出，必要时仅回退内部委托实现。

## 七、后续可选优化（非必要）

- 简易健康检查与自检脚本（下载几张公共图片验证链路）。
- 站点配置热更新（非必须）。

---

- 当前入口：`package.json` → `scripts.start` → `index.js`
- 文档：`LOCAL_HTML_MODE.md` 说明应随 `localHtmlProcessor` 变更同步。

如需，我可以按上述顺序逐步提交重构 PR（每步保持可运行）。
