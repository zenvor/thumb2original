# 本地 HTML 爬虫模式使用说明

## 功能概述

本地 HTML 爬虫模式允许程序自动读取 `html` 目录下的所有 HTML 文件，从中提取图片 URL，并使用主爬虫程序进行统一处理和下载。

## 配置方法

在 `config/config.js` 文件中修改 `scraperConfig` 配置：

```javascript
const scraperConfig = {
  // 设置为本地HTML爬虫模式
  scrapeMode: 'local_html',
  
  // 图片模式：'all' (所有图片) | 'originals_only' (仅原图)
  imageMode: 'originals_only',
  
  // 本地HTML文件目录路径
  htmlDirectory: './html',
  
  // HTML文件排序方式
  htmlSortOrder: 'name', // 'name' | 'mtime_asc' | 'mtime_desc'
  
  // 记忆功能配置
  enableMemory: true, // 是否启用记忆功能，跳过已处理的HTML文件
  memoryDirectory: './memory', // 记忆目录路径
  forceReprocess: false, // 是否强制重新处理所有文件（忽略记忆）
  
  // 其他配置保持不变...
}
```

## 工作流程

1. **扫描HTML文件**：程序会递归扫描 `htmlDirectory` 指定的目录及其子目录，查找所有 `.html` 文件

2. **提取图片URL**：从每个HTML文件中提取 `<img>` 标签的 `src` 属性值

3. **URL处理**：根据 `imageMode` 配置，将缩略图URL转换为原图URL（如果设置为 `originals_only`）

4. **下载管理**：使用与网络爬虫相同的下载逻辑，包括并发控制、重试机制等

5. **文件组织**：每个HTML文件的图片会下载到独立的文件夹中，文件夹名称格式为：`页面标题_HTML文件名`

## 目录结构示例

```
thumb2original/
├── html/
│   └── ★★★_GirlsDelta_★★★_RikiTake_★★★_G-Queen_★★★/
│       ├── 1753610178224-3617c0cc-ffa0-4e6e-a2d6-a9e44a318df4.html
│       ├── 1753610178224-a4e68d7e-2eba-4632-ae03-6e901a05617b.html
│       └── ...
└── download/
    ├── Scraped Content_1753610178224-3617c0cc-ffa0-4e6e-a2d6-a9e44a318df4/
    │   ├── 5808e47c2e48e.jpeg
    │   ├── 5808e47d021da.jpeg
    │   └── ...
    └── Scraped Content_1753610178224-a4e68d7e-2eba-4632-ae03-6e901a05617b/
        ├── 5808e14037b0b.jpeg
        └── ...
```

## 运行方法

1. 确保已安装依赖：
   ```bash
   npm install
   ```

2. 安装Chrome浏览器（如果尚未安装）：
   ```bash
   npx puppeteer browsers install chrome
   ```

3. 运行爬虫：
   ```bash
   npm start
   ```

## 记忆功能说明

### 功能概述
记忆功能可以记录已经处理过的HTML文件，避免重复处理，提高效率。

### 配置选项
- `enableMemory`: 是否启用记忆功能（默认：true）
- `memoryDirectory`: 记忆目录路径（默认：./memory）
- `forceReprocess`: 是否强制重新处理所有文件，忽略记忆（默认：false）

### 工作原理
1. **分散式记忆**：每个HTML文件对应独立的JSONL记忆文件，实时记录处理状态
2. **跳过已处理文件**：下次运行时，会自动跳过已完成的文件
3. **断点续传**：支持从中断处继续下载，已下载的图片不会重复下载
4. **持久化存储**：记忆信息保存在JSONL文件中，程序重启后仍然有效

### 使用场景
- **大批量处理**：处理大量HTML文件时，可以分批次运行，避免重复工作
- **断点续传**：程序意外中断后，可以从上次停止的地方继续处理
- **增量更新**：新增HTML文件时，只处理新文件，不重复处理旧文件

### 管理命令
```javascript
// 强制重新处理所有文件
forceReprocess: true

// 或者手动删除记忆目录
// rm -rf memory/
```

## 特性说明

- **递归扫描**：支持扫描多层嵌套的子目录
- **去重处理**：自动去除重复的图片URL
- **错误处理**：单个HTML文件处理失败不会影响其他文件
- **进度显示**：实时显示处理进度和下载状态
- **文件命名**：使用页面标题和HTML文件名组合命名下载文件夹
- **智能记忆**：自动记录已处理文件，避免重复处理
- **兼容性**：与现有的网络爬虫功能完全兼容，可随时切换模式

## 注意事项

- 确保 `htmlDirectory` 路径正确且存在
- HTML文件中的图片URL应该是有效的网络地址
- 大量HTML文件处理可能需要较长时间，请耐心等待
- 建议在处理前备份重要数据