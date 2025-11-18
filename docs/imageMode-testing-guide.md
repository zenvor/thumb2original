# imageMode 功能测试指南

## 一、启动服务器

```bash
# 启动 API 服务器
npm run server

# 或使用开发模式（自动重启）
npm run dev
```

服务器将在 `http://localhost:3000` 启动。

## 二、测试用例

### 测试 1: 默认模式（all）

**描述**: 不传 imageMode 参数，应该使用默认值 `all`

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "advanced"
  }'
```

**预期响应**:
```json
{
  "id": "...",
  "url": "https://example.com",
  "status": "pending",
  "options": {
    "mode": "advanced",
    "imageMode": "all",  // 应该是 "all"
    "ignoreInlineImages": false
  }
}
```

### 测试 2: originals_only 模式

**描述**: 明确指定 `imageMode: "originals_only"`

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.pixiv.net/artworks/123456789",
    "mode": "advanced",
    "imageMode": "originals_only"
  }'
```

**预期响应**:
```json
{
  "id": "...",
  "url": "https://www.pixiv.net/artworks/123456789",
  "status": "pending",
  "options": {
    "mode": "advanced",
    "imageMode": "originals_only",  // 应该是 "originals_only"
    "ignoreInlineImages": false
  }
}
```

**后续验证**:
- 等待任务完成后，查询任务详情
- 检查返回的图片 URL 是否为原图链接（如 `img-original`）

```bash
# 查询任务详情
curl http://localhost:3000/api/extractions/<task_id>
```

### 测试 3: all 模式（显式指定）

**描述**: 明确指定 `imageMode: "all"`

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.pixiv.net/artworks/123456789",
    "mode": "advanced",
    "imageMode": "all"
  }'
```

**预期响应**:
```json
{
  "id": "...",
  "options": {
    "mode": "advanced",
    "imageMode": "all"
  }
}
```

### 测试 4: 参数验证 - 无效的 imageMode

**描述**: 传递无效的 imageMode 值，应该返回 400 错误

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "imageMode": "invalid_mode"
  }'
```

**预期响应**: HTTP 400
```json
{
  "error": "imageMode must be \"all\" or \"originals_only\""
}
```

### 测试 5: 参数验证 - 缺少 URL

**描述**: 不传 URL 参数，应该返回 400 错误

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "imageMode": "all"
  }'
```

**预期响应**: HTTP 400
```json
{
  "error": "URL is required"
}
```

## 三、功能验证测试

### 测试 6: Pixiv 原图转换验证

**步骤 1**: 使用 `all` 模式创建任务
```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.pixiv.net/artworks/114514810",
    "mode": "advanced",
    "imageMode": "all"
  }'
```

**步骤 2**: 记录返回的 task_id，等待几秒钟

**步骤 3**: 查询任务结果
```bash
curl http://localhost:3000/api/extractions/<task_id>
```

**预期**: 图片 URL 包含 `img-master`（缩略图）

---

**步骤 4**: 使用 `originals_only` 模式创建任务
```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.pixiv.net/artworks/114514810",
    "mode": "advanced",
    "imageMode": "originals_only"
  }'
```

**步骤 5**: 查询任务结果

**预期**: 图片 URL 包含 `img-original`（原图）

### 测试 7: Pixhost 原图转换验证

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://pixhost.to/show/123/456",
    "mode": "advanced",
    "imageMode": "originals_only"
  }'
```

**预期**: URL 中的 `/thumbs/` 被替换为 `/images/`

## 四、自动化测试脚本

创建测试脚本 `test-imagemode.sh`:

```bash
#!/bin/bash

API_URL="http://localhost:3000/api/extractions"

echo "=== 测试 1: 默认模式 ==="
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  | jq '.options.imageMode'

echo -e "\n=== 测试 2: originals_only 模式 ==="
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "imageMode": "originals_only"}' \
  | jq '.options.imageMode'

echo -e "\n=== 测试 3: 参数验证 ==="
curl -X POST $API_URL \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "imageMode": "invalid"}' \
  | jq '.error'

echo -e "\n所有测试完成!"
```

运行测试：
```bash
chmod +x test-imagemode.sh
./test-imagemode.sh
```

## 五、日志验证

检查服务器日志，确认 imageMode 参数被正确处理：

```
[taskId] ⚙️ Config built: { imageMode: 'originals_only', ... }
[taskId] ✅ After imageMode processing: X images (mode: originals_only)
```

## 六、测试清单

- [ ] 测试 1: 默认模式（all）
- [ ] 测试 2: originals_only 模式
- [ ] 测试 3: all 模式（显式）
- [ ] 测试 4: 无效参数验证
- [ ] 测试 5: 缺少 URL 验证
- [ ] 测试 6: Pixiv 原图转换
- [ ] 测试 7: Pixhost 原图转换
- [ ] 日志输出验证

## 七、常见问题

**Q: 为什么 imageMode 是 originals_only 但返回的还是缩略图？**

A: 可能的原因：
1. 网站不在支持列表中（28+ 个网站）
2. URL 格式不匹配转换规则
3. 转换后的原图 URL 下载失败，回退到缩略图

查看日志中的 `imageUrlConverter` 输出来诊断。

**Q: 如何查看支持的网站列表？**

A: 查看文件 `utils/imageUrlConverter.js`，包含：
- Pixiv, Pixhost, Imx.to, Vipr.im, Imgbox
- Eporner, Pichunter, Chpic
- XNXX, Pornpics, X3vid, Duitang
- 等 28+ 个网站

**Q: CLI 模式下如何使用？**

A: 修改 `config/config.js`:
```javascript
imageMode: 'originals_only'
```

然后运行：
```bash
npm start
```
