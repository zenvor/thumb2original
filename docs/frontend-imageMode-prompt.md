# 前端 imageMode 功能实现提示词

> 将以下提示词发送给 AI，让其修改前端代码以支持 imageMode 参数

---

## 📝 任务描述

我需要在前端添加对 `imageMode` 参数的支持，让用户在创建图片提取任务时可以选择提取模式：
- **All images**: 提取所有图片（包括缩略图）
- **Original images only**: 仅提取原图（会尝试将缩略图转换为原图）

## 🎯 实现要求

### 1. 在创建任务页面添加 imageMode 选择器

**位置**: 创建提取任务的表单中

**UI 布局**:
```
┌─────────────────────────────────────┐
│ Create Extraction Task              │
├─────────────────────────────────────┤
│ URL: [_________________________]    │
│                                     │
│ Mode:                               │
│   ○ Basic  ⦿ Advanced               │
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

**要求**:
- 使用单选按钮（Radio buttons）或下拉选择器（Select）
- 默认选中 "All images"
- 添加简短的说明文字或 tooltip，解释两种模式的区别

**说明文字建议**:
- **All images**: "Extract all images including thumbnails (faster)"
- **Original images only**: "Try to convert thumbnails to original images (28+ sites supported)"

### 2. 修改 API 调用代码

**当前的 API 调用代码**可能类似于：
```javascript
const response = await fetch('/api/extractions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: userInputUrl,
    mode: selectedMode,                // 'basic' | 'advanced'
    ignoreInlineImages: ignoreInline   // boolean
  })
})
```

**修改为**:
```javascript
const response = await fetch('/api/extractions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: userInputUrl,
    mode: selectedMode,                // 'basic' | 'advanced'
    ignoreInlineImages: ignoreInline,  // boolean
    imageMode: selectedImageMode       // 'all' | 'originals_only' (新增)
  })
})
```

**注意**:
- `selectedImageMode` 的值应该是 `'all'` 或 `'originals_only'`（字符串，带下划线）
- 默认值为 `'all'`

### 3. 在任务详情页显示 imageMode

**位置**: 任务详情页面

**显示内容**:
```
Task ID: 1731801234567-abc123xyz
URL: https://example.com/page
Status: Done ✓
Mode: Advanced
Image Mode: Original images only    ← 新增此行
Images: 42
Created: 2025-11-18 10:30:00
```

**要求**:
- 从任务数据的 `task.options.imageMode` 获取值
- 显示友好的文字：
  - `'all'` → "All images"
  - `'originals_only'` → "Original images only"

**示例代码**:
```javascript
const imageModeText = task.options.imageMode === 'originals_only'
  ? 'Original images only'
  : 'All images'

// 在 UI 中显示
<div>Image Mode: {imageModeText}</div>
```

### 4. 表单状态管理

**如果使用 React**:
```javascript
const [imageMode, setImageMode] = useState('all') // 默认值

// Radio buttons
<input
  type="radio"
  value="all"
  checked={imageMode === 'all'}
  onChange={(e) => setImageMode(e.target.value)}
/>

<input
  type="radio"
  value="originals_only"
  checked={imageMode === 'originals_only'}
  onChange={(e) => setImageMode(e.target.value)}
/>
```

**如果使用 Vue**:
```vue
<template>
  <div>
    <label>
      <input type="radio" v-model="imageMode" value="all" />
      All images
    </label>
    <label>
      <input type="radio" v-model="imageMode" value="originals_only" />
      Original images only
    </label>
  </div>
</template>

<script>
export default {
  data() {
    return {
      imageMode: 'all' // 默认值
    }
  }
}
</script>
```

**如果使用原生 JavaScript**:
```javascript
const imageModeAll = document.getElementById('imageMode-all')
const imageModeOriginal = document.getElementById('imageMode-original')

// 获取选中的值
function getSelectedImageMode() {
  return imageModeOriginal.checked ? 'originals_only' : 'all'
}

// 在提交表单时
const selectedImageMode = getSelectedImageMode()
```

## 📋 完整实现清单

请按照以下步骤实现：

- [ ] **步骤 1**: 在创建任务表单中添加 imageMode 选择器（Radio buttons 或 Select）
- [ ] **步骤 2**: 设置默认值为 `'all'`
- [ ] **步骤 3**: 添加状态管理（useState/data/变量）
- [ ] **步骤 4**: 修改 API 调用代码，添加 `imageMode` 参数
- [ ] **步骤 5**: 在任务详情页显示 imageMode 信息
- [ ] **步骤 6**: （可选）添加 tooltip 或说明文字
- [ ] **步骤 7**: 测试表单提交和任务创建

## 🎨 UI 设计建议

### 选项 1: Radio Buttons（推荐）
```html
<div class="form-group">
  <label class="form-label">Image Mode</label>
  <div class="radio-group">
    <label class="radio-option">
      <input type="radio" name="imageMode" value="all" checked />
      <span>All images</span>
      <small>Extract all images including thumbnails</small>
    </label>
    <label class="radio-option">
      <input type="radio" name="imageMode" value="originals_only" />
      <span>Original images only</span>
      <small>Try to convert to originals (28+ sites supported)</small>
    </label>
  </div>
</div>
```

### 选项 2: Select Dropdown
```html
<div class="form-group">
  <label for="imageMode">Image Mode</label>
  <select id="imageMode" class="form-control">
    <option value="all" selected>All images</option>
    <option value="originals_only">Original images only</option>
  </select>
  <small class="form-text">
    Original mode supports 28+ sites including Pixiv, Pixhost, Imgbox, etc.
  </small>
</div>
```

### 选项 3: Toggle Switch
```html
<div class="form-group">
  <label class="toggle-label">
    <input type="checkbox" id="imageMode-toggle" />
    <span>Try to match original images</span>
  </label>
  <small>Enable for high-quality original images (supports 28+ sites)</small>
</div>
```

**如果使用 Toggle**，转换代码：
```javascript
const imageMode = imageModeToggle.checked ? 'originals_only' : 'all'
```

## 📊 API 响应示例

创建任务后，后端返回的数据结构：

```json
{
  "id": "1731801234567-abc123xyz",
  "url": "https://example.com/page",
  "hash": "a1b2c3d4e5f6...",
  "status": "pending",
  "message": null,
  "trigger": "api",
  "options": {
    "mode": "advanced",
    "imageMode": "originals_only",    ← 这个字段
    "ignoreInlineImages": false
  },
  "images": null,
  "images_count": 0,
  "created_at": "2025-11-18T02:30:00.000Z",
  "updated_at": "2025-11-18T02:30:00.000Z"
}
```

## ⚠️ 注意事项

1. **值的格式**:
   - 正确: `'all'`, `'originals_only'`
   - 错误: `'All'`, `'originals-only'`, `'original'`

2. **默认值**:
   - 如果不传 `imageMode`，后端默认使用 `'all'`
   - 建议前端也显式传递默认值

3. **错误处理**:
   - 如果传递了无效的值，后端会返回 400 错误：
     ```json
     {"error": "imageMode must be \"all\" or \"originals_only\""}
     ```
   - 前端应该捕获并显示错误信息

4. **兼容性**:
   - 这是一个新增参数，不会影响现有功能
   - 不传该参数时，行为与之前完全一致

## 🧪 测试要点

实现完成后，请测试：

1. **默认值测试**: 不选择任何选项，直接提交，应该使用 `'all'` 模式
2. **选择测试**: 选择 "Original images only"，检查 API 请求中 `imageMode: 'originals_only'`
3. **任务详情测试**: 创建任务后，在详情页应该看到 "Image Mode: Original images only"
4. **错误处理测试**: 如果后端返回错误，前端应该正确显示

## 📚 参考文档

- 后端实现：`server/routes/extractions.js`
- API 文档：`docs/imageMode-feature-plan.md`
- 测试指南：`docs/imageMode-testing-guide.md`

## ❓ 常见问题

**Q: 前端代码文件在哪里？**
A: 请告诉我你的前端框架（React/Vue/原生JS）和文件路径，我会根据实际情况修改。

**Q: 我应该使用哪种 UI 组件？**
A: 推荐使用 Radio buttons，最直观。如果空间有限，可以用 Select dropdown。

**Q: 需要添加图标吗？**
A: 可选。可以在 "Original images only" 旁边添加一个 ⭐ 或 🔍 图标表示高级功能。

**Q: 是否需要在所有页面都显示？**
A: 只需要在：
  1. 创建任务页面（表单）
  2. 任务详情页面（显示）

---

## 🚀 实施步骤（给 AI 的指令）

请按照以下步骤修改前端代码：

1. **定位创建任务的表单组件**（可能是 CreateTask.jsx、NewExtraction.vue 等）
2. **在表单中添加 imageMode 选择器**（使用 Radio buttons 或 Select）
3. **添加状态管理**（useState、data 或普通变量）
4. **修改 API 调用代码**，在 body 中添加 `imageMode` 字段
5. **定位任务详情页组件**（可能是 TaskDetail.jsx、ExtractionView.vue 等）
6. **在详情页显示 imageMode 信息**（从 `task.options.imageMode` 读取）
7. **测试功能**（创建任务并检查 API 请求）

完成后，请告诉我修改了哪些文件。
