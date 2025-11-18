# "Try to Match Original" 功能使用指南

## API 使用流程

### 1. 创建提取任务（使用 all 模式）

```bash
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "advanced",
    "imageMode": "all"
  }'
```

**响应**：
```json
{
  "id": "task-123",
  "url": "https://example.com",
  "status": "pending",
  "options": {
    "mode": "advanced",
    "imageMode": "all"
  }
}
```

### 2. 等待任务完成

```bash
curl http://localhost:3000/api/extractions/task-123
```

**响应**（任务完成后）：
```json
{
  "id": "task-123",
  "status": "done",
  "images": [...],
  "images_count": 50,
  "images_all": [...],
  "images_all_count": 50,
  "images_original": null,
  "images_original_count": 0,
  "original_matched": false
}
```

### 3. 点击 "Try to Match Original" - 匹配原图

```bash
curl -X POST http://localhost:3000/api/extractions/task-123/match-original
```

**响应**：
```json
{
  "success": true,
  "matched_count": 45,
  "images": [
    {
      "id": "img-001",
      "url": "https://example.com/original/image1.jpg",
      "name": "image1",
      "type": "jpeg",
      "width": 2000,
      "height": 3000,
      "size": 6000000
    },
    ...
  ]
}
```

### 4. 查看原图视图

```bash
curl http://localhost:3000/api/extractions/task-123?view=original
```

**响应**：
```json
{
  "id": "task-123",
  "status": "done",
  "images": [...],  // 原图列表
  "images_count": 45,
  "current_view": "original",
  "original_matched": true
}
```

### 5. 切换回 all 视图

```bash
curl http://localhost:3000/api/extractions/task-123?view=all
```

**响应**：
```json
{
  "id": "task-123",
  "status": "done",
  "images": [...],  // all 模式的图片列表
  "images_count": 50,
  "current_view": "all"
}
```

---

## 前端实现指导

### 按钮状态管理

```javascript
// 状态定义
const [currentView, setCurrentView] = useState('all')  // 'all' | 'original'
const [isMatching, setIsMatching] = useState(false)
const [task, setTask] = useState(null)

// 检查是否可以匹配原图
const canMatchOriginal = task?.status === 'done' && !task?.original_matched

// 检查是否已匹配
const isOriginalMatched = task?.original_matched === true
```

### 按钮点击逻辑

```javascript
async function handleMatchOriginal() {
  if (isMatching) return

  // 如果已经匹配过，直接切换视图
  if (isOriginalMatched) {
    const newView = currentView === 'all' ? 'original' : 'all'
    setCurrentView(newView)

    // 重新获取任务数据
    const response = await fetch(`/api/extractions/${taskId}?view=${newView}`)
    const data = await response.json()
    setTask(data)
    return
  }

  // 首次匹配：调用 match-original 接口
  setIsMatching(true)
  try {
    const response = await fetch(`/api/extractions/${taskId}/match-original`, {
      method: 'POST'
    })
    const result = await response.json()

    if (result.success) {
      // 匹配成功，切换到原图视图
      setCurrentView('original')

      // 刷新任务数据
      const taskResponse = await fetch(`/api/extractions/${taskId}`)
      const taskData = await taskResponse.json()
      setTask(taskData)
    }
  } catch (error) {
    console.error('Failed to match original:', error)
  } finally {
    setIsMatching(false)
  }
}
```

### 按钮 UI

```jsx
<button
  onClick={handleMatchOriginal}
  disabled={!canMatchOriginal && !isOriginalMatched}
>
  {isMatching ? (
    <>
      <Spinner /> Matching...
    </>
  ) : isOriginalMatched ? (
    currentView === 'all' ?
      'Switch to Original View' :
      'Switch to All View'
  ) : (
    'Try to Match Original'
  )}
</button>

{/* 显示匹配状态 */}
{isOriginalMatched && (
  <div className="match-info">
    ✓ Matched {task.images_original_count} original images
    {currentView === 'original' && ' (Currently viewing)'}
  </div>
)}
```

---

## 测试用例

### 测试 1: 完整流程

```bash
# 1. 创建任务
TASK_ID=$(curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com", "mode": "advanced"}' \
  | jq -r '.id')

# 2. 等待完成（轮询）
while true; do
  STATUS=$(curl -s http://localhost:3000/api/extractions/$TASK_ID | jq -r '.status')
  echo "Status: $STATUS"
  [ "$STATUS" = "done" ] && break
  sleep 2
done

# 3. 匹配原图
curl -X POST http://localhost:3000/api/extractions/$TASK_ID/match-original

# 4. 查看原图
curl http://localhost:3000/api/extractions/$TASK_ID?view=original

# 5. 切换回 all
curl http://localhost:3000/api/extractions/$TASK_ID?view=all
```

### 测试 2: 重复匹配（应该返回缓存）

```bash
# 第二次调用应该直接返回缓存结果
curl -X POST http://localhost:3000/api/extractions/$TASK_ID/match-original

# 响应应该包含 "from_cache": true
```

### 测试 3: 未完成任务不能匹配

```bash
# 创建任务后立即匹配（应该失败）
TASK_ID=$(curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' \
  | jq -r '.id')

curl -X POST http://localhost:3000/api/extractions/$TASK_ID/match-original
# 预期：400 错误 "Task is not completed yet"
```

---

## 数据流图

```
创建任务 (all 模式)
    ↓
┌─────────────────────┐
│ Task Created        │
│ images_all: [...]   │
│ images_original: null│
│ original_matched: false│
└─────────────────────┘
    ↓
用户点击 "Try to Match Original"
    ↓
┌─────────────────────┐
│ POST /match-original│
│ - 转换 URL          │
│ - 下载并分析原图    │
│ - 存储到数据库      │
└─────────────────────┘
    ↓
┌─────────────────────┐
│ Task Updated        │
│ images_all: [...]   │
│ images_original: [...]│
│ original_matched: true│
│ images: images_original│ ← 当前显示原图
└─────────────────────┘
    ↓
用户切换视图
    ↓
GET /extractions/:id?view=all  或  ?view=original
    ↓
返回对应视图的图片列表
```

---

## 注意事项

1. **首次匹配会触发下载和分析**，耗时较长（取决于图片数量）
2. **再次点击直接切换视图**，不会重新下载
3. **原图 URL 转换失败时会降级使用原 URL**
4. **只有 advanced 模式才会分析图片属性**（size, width, height, type）
5. **数据持久化在内存中**，服务器重启会丢失
