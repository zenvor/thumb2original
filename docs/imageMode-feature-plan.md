# imageMode 参数化功能设计方案

**创建日期**: 2025-11-18
**状态**: 实现中
**负责人**: Claude

---

## 一、功能概述

### 目标
统一 CLI 和 API 的图片模式控制，让用户在创建提取任务时就可以选择是否只提取原图。

### 核心改动
- API 支持 `imageMode` 参数（`all` | `originals_only`）
- 前端添加 imageMode 选择器
- 保持与 CLI 配置的一致性

---

## 二、现状分析

### 已实现功能 ✅

1. **ExtractionService** 已经支持 `imageMode`
   - 文件：`server/services/ExtractionService.js`
   - 行号：38, 83-88, 119-127
   - 功能：接收 `options.imageMode` 并传递给处理逻辑

2. **图片处理逻辑** 完整实现
   - 文件：`lib/imageModeProcessor.js`
   - 功能：`processUrlsByImageMode()` 函数处理 URL 转换
   - 支持：28+ 个网站的原图转换规则

3. **数据库存储** 支持
   - 通过 `task.options.imageMode` 存储模式
   - 可追溯每个任务使用的模式

### 缺少功能 ❌

1. **API 路由** 未接收 `imageMode` 参数
   - 文件：`server/routes/extractions.js`
   - 问题：只接收了 `url`, `mode`, `ignoreInlineImages`

2. **前端** 未传递 `imageMode`
   - 问题：前端调用 API 时未传递此参数

---

## 三、实现规划

### Phase 1: API 支持 imageMode 参数（核心）✅

**优先级**: 🔥 高
**工作量**: 10 分钟
**负责人**: 后端

#### 改动文件
`server/routes/extractions.js`

#### 改动内容

**1. 接收参数**（第 17 行）
```javascript
// 修改前
const { url, mode, ignoreInlineImages } = ctx.request.body

// 修改后
const { url, mode, ignoreInlineImages, imageMode } = ctx.request.body
```

**2. 添加参数验证**（第 40 行之后）
```javascript
// 验证 imageMode
if (imageMode && !['all', 'originals_only'].includes(imageMode)) {
  ctx.status = 400
  ctx.body = { error: 'imageMode must be "all" or "originals_only"' }
  return
}
```

**3. 传递参数**（第 43 行）
```javascript
// 修改前
const task = await extractionService.createExtraction(url, {
  mode: mode || 'basic',
  ignoreInlineImages: ignoreInlineImages || false,
  trigger: 'api'
})

// 修改后
const task = await extractionService.createExtraction(url, {
  mode: mode || 'basic',
  ignoreInlineImages: ignoreInlineImages || false,
  imageMode: imageMode || 'all',  // 新增
  trigger: 'api'
})
```

---

### Phase 2: 前端支持（UI + 调用）

**优先级**: 🔥 高
**工作量**: 30 分钟
**负责人**: 前端

#### 2.1 UI 设计

在创建任务页面添加 imageMode 选择器：

```
┌─────────────────────────────────────┐
│ Create Extraction Task              │
├─────────────────────────────────────┤
│ URL: [_________________________]    │
│                                     │
│ Mode: ○ Basic  ⦿ Advanced          │
│                                     │
│ Image Mode:                         │
│   ⦿ All images                      │
│   ○ Original images only            │
│                                     │
│ ☐ Ignore inline images              │
│                                     │
│ [Extract Images]                    │
└─────────────────────────────────────┘
```

#### 2.2 API 调用示例

```javascript
const response = await fetch('/api/extractions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: userInputUrl,
    mode: selectedMode,              // 'basic' | 'advanced'
    ignoreInlineImages: ignoreInline, // boolean
    imageMode: selectedImageMode      // 'all' | 'originals_only' (新增)
  })
})
```

#### 2.3 任务详情页显示

在任务详情中显示使用的 imageMode：

```
Task ID: 1731801234567-abc123xyz
Status: Done ✓
Mode: Advanced
Image Mode: Original images only  ← 显示使用的模式
Images: 42
```

---

### Phase 3: "Try to match original" 功能（可选）

**优先级**: 📌 低（后续评估）
**状态**: 暂不实现

**设计思路**：
- 对已完成的 `imageMode: 'all'` 任务
- 提供一个按钮重新匹配原图
- 调用新接口：`POST /api/extractions/:id/rematch-originals`

**决策标准**：
- 如果用户经常"后悔"没选原图模式 → 实现
- 如果用户习惯提前选择 → 不实现

---

## 四、API 规范

### 4.1 创建提取任务

**接口**: `POST /api/extractions`

**请求参数**:
```json
{
  "url": "https://example.com/page",      // 必填，目标 URL
  "mode": "basic",                        // 可选，默认 "basic"
  "ignoreInlineImages": false,            // 可选，默认 false
  "imageMode": "all"                      // 可选，默认 "all" (新增)
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 默认值 | 可选值 | 说明 |
|------|------|------|--------|--------|------|
| url | string | ✅ | - | - | 目标 URL |
| mode | string | ❌ | `basic` | `basic`, `advanced` | 提取模式：`basic` 仅返回 URL，`advanced` 分析图片 |
| ignoreInlineImages | boolean | ❌ | `false` | `true`, `false` | 是否忽略内联图片 |
| **imageMode** | string | ❌ | `all` | `all`, `originals_only` | **图片模式：`all` 所有图片，`originals_only` 仅原图** |

**响应示例**:
```json
{
  "id": "1731801234567-abc123xyz",
  "url": "https://example.com/page",
  "hash": "a1b2c3...",
  "status": "pending",
  "message": null,
  "status_changed_at": null,
  "trigger": "api",
  "options": {
    "mode": "advanced",
    "imageMode": "originals_only",
    "ignoreInlineImages": false
  },
  "images": null,
  "images_count": 0,
  "user_id": null,
  "project_id": null
}
```

**错误响应**:
```json
{
  "error": "imageMode must be \"all\" or \"originals_only\""
}
```

### 4.2 查询任务详情

**接口**: `GET /api/extractions/:id`

**响应示例**:
```json
{
  "id": "1731801234567-abc123xyz",
  "url": "https://pixiv.net/artworks/123456",
  "status": "done",
  "options": {
    "mode": "advanced",
    "imageMode": "originals_only",   // 可以看到使用的模式
    "ignoreInlineImages": false
  },
  "images": [
    {
      "id": "img-001",
      "url": "https://i.pximg.net/img-original/...",
      "name": "123456_p0",
      "type": "png",
      "width": 2000,
      "height": 3000
    }
  ],
  "images_count": 1
}
```

---

## 五、与 CLI 模式的一致性

### CLI 配置
文件：`config/config.js:113`

```javascript
export const scraperConfig = {
  imageMode: 'originals_only'  // 在配置文件中设置
}
```

### API 调用
```javascript
{
  imageMode: 'originals_only'  // 在请求参数中传递
}
```

### 共享逻辑

两种模式都通过以下流程处理：

1. `ExtractionService.createExtraction()`
2. `processUrlsByImageMode()` 处理 URL
3. `imageUrlConverter.js` 转换规则（28+ 网站）

**支持的网站**：
- Pixiv, Pixhost, Imx.to, Vipr.im, Imgbox
- Eporner, Pichunter, Chpic
- XNXX, Pornpics, X3vid, Duitang
- 等 28+ 个网站

---

## 六、测试计划

### 6.1 API 测试

**测试 1: all 模式（默认）**
```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "advanced"
  }'

# 预期：task.options.imageMode = "all"
```

**测试 2: originals_only 模式**
```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.pixiv.net/artworks/123456",
    "mode": "advanced",
    "imageMode": "originals_only"
  }'

# 预期：
# - task.options.imageMode = "originals_only"
# - 返回的图片 URL 应该是原图链接 (img-original)
```

**测试 3: 参数验证**
```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "imageMode": "invalid_value"
  }'

# 预期：400 错误，错误消息：
# {"error": "imageMode must be \"all\" or \"originals_only\""}
```

### 6.2 功能测试

| 测试场景 | URL 示例 | imageMode | 预期结果 |
|---------|---------|-----------|---------|
| Pixiv 缩略图 → 原图 | pixiv.net/artworks/123 | `originals_only` | 返回 `img-original` 链接 |
| Pixiv 缩略图 → 缩略图 | pixiv.net/artworks/123 | `all` | 返回 `img-master` 链接 |
| Pixhost 缩略图 → 原图 | pixhost.to/show/123 | `originals_only` | 返回原图链接 |
| 不支持转换的网站 | unsupported.com/img | `originals_only` | 返回原始链接 |

---

## 七、优势总结

✅ **统一体验**: API 和 CLI 行为完全一致
✅ **灵活性**: 用户可以按需选择模式
✅ **简单实现**: 大部分逻辑已完成，只需暴露参数
✅ **向后兼容**: 默认值 `all` 保持现有行为
✅ **可追溯**: `task.options.imageMode` 记录使用的模式
✅ **易于扩展**: 未来可添加更多图片模式

---

## 八、实施时间表

| 阶段 | 任务 | 工作量 | 负责人 | 状态 |
|------|------|--------|--------|------|
| Phase 1 | 修改 API 路由支持 imageMode | 10 分钟 | 后端 | 🔄 进行中 |
| Phase 1 | API 测试 | 15 分钟 | 后端 | ⏳ 待开始 |
| Phase 2 | 前端 UI 添加选择器 | 20 分钟 | 前端 | ⏳ 待开始 |
| Phase 2 | 前端调用 API 传递参数 | 10 分钟 | 前端 | ⏳ 待开始 |
| Phase 2 | 前端任务详情显示 imageMode | 10 分钟 | 前端 | ⏳ 待开始 |
| Phase 3 | "Try to match original" 功能 | 2-3 小时 | 后端 | 📌 暂不实施 |

**预计完成时间**: Phase 1-2 共 1 小时

---

## 九、后续优化建议

### 9.1 短期优化
- [ ] 在日志中记录 imageMode 使用情况
- [ ] 添加统计：各模式使用频率
- [ ] 前端添加 tooltip 解释两种模式的区别

### 9.2 长期优化
- [ ] 支持更多图片模式（如 `medium_quality`, `low_quality`）
- [ ] 支持自定义转换规则
- [ ] 批量任务支持不同的 imageMode
- [ ] 根据用户反馈决定是否实现 Phase 3

---

## 十、相关文件清单

### 后端文件
- `server/routes/extractions.js` - API 路由（需修改）
- `server/services/ExtractionService.js` - 提取服务（已支持）
- `lib/imageModeProcessor.js` - 图片模式处理（已实现）
- `utils/imageUrlConverter.js` - URL 转换规则（已实现）
- `config/config.js` - CLI 配置

### 前端文件
- 创建任务页面组件（待确认）
- 任务详情页面组件（待确认）
- API 调用模块（待确认）

### 文档
- `/tmp/exploration_report.md` - 功能探索报告
- `/tmp/quick_reference.md` - 快速参考指南
- `/tmp/code_snippets.md` - 代码片段集合

---

## 附录

### A. imageMode 值说明

| 值 | 说明 | 适用场景 |
|----|------|---------|
| `all` | 获取所有图片（包括缩略图） | 默认模式，快速浏览 |
| `originals_only` | 仅获取原图（尝试转换缩略图） | 高质量图片下载，收藏用途 |

### B. 转换规则示例

**Pixiv**:
```
缩略图: https://i.pximg.net/c/240x480/img-master/...
原图:   https://i.pximg.net/img-original/...
```

**Pixhost**:
```
缩略图: https://img123.pixhost.to/thumbs/456/789.jpg
原图:   https://img123.pixhost.to/images/456/789.jpg
```

更多规则详见：`utils/imageUrlConverter.js`

---

**文档版本**: 1.0
**最后更新**: 2025-11-18
