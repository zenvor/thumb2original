# 前端添加 imageMode 参数支持

## 需要修改的地方

### 1. 创建任务表单 - 添加 imageMode 选择器

在创建提取任务的表单中添加一个单选按钮组或下拉选择器：

**选项**：
- `all` - All images (默认)
- `originals_only` - Original images only

**UI 参考**：
```
Image Mode:
  ⦿ All images
  ○ Original images only
```

### 2. API 调用 - 添加 imageMode 参数

修改创建任务的 API 调用：

```javascript
// 修改前
{
  url: userInputUrl,
  mode: selectedMode,
  ignoreInlineImages: ignoreInline
}

// 修改后（添加 imageMode）
{
  url: userInputUrl,
  mode: selectedMode,
  ignoreInlineImages: ignoreInline,
  imageMode: selectedImageMode  // 'all' | 'originals_only'
}
```

**默认值**：`'all'`

### 3. 任务详情页 - 显示 imageMode

在任务详情中显示使用的图片模式：

```javascript
// 从 task.options.imageMode 读取
const imageModeText = task.options.imageMode === 'originals_only'
  ? 'Original images only'
  : 'All images'

// 显示
Image Mode: {imageModeText}
```

## API 响应格式

```json
{
  "id": "...",
  "options": {
    "mode": "advanced",
    "imageMode": "originals_only",  // 新增字段
    "ignoreInlineImages": false
  }
}
```

## 完成
