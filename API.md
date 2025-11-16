# thumb2original API Documentation

## Overview

The thumb2original API provides asynchronous image extraction from web pages, similar to extract.pics. It supports two modes:
- **basic**: Fast URL extraction only
- **advanced**: Full image analysis with metadata and download capabilities

## Base URL

```
http://localhost:3000
```

## API Endpoints

### 1. Create Extraction Task

**Endpoint:** `POST /api/extractions`

Create a new image extraction task.

**Request Body:**

```json
{
  "url": "https://example.com",
  "mode": "basic",
  "ignoreInlineImages": false
}
```

**Parameters:**

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `url` | string | ✅ | - | The URL to extract images from |
| `mode` | string | ❌ | `basic` | Extraction mode: `basic` or `advanced` |
| `ignoreInlineImages` | boolean | ❌ | `false` | Skip inline images (SVG, Base64, etc.) |

**Response:** `201 Created`

```json
{
  "id": "1763310197936-lt5msnia2",
  "url": "https://example.com",
  "hash": "327c3fda87ce286848a574982ddd0b7c7487f816",
  "status": "pending",
  "message": null,
  "status_changed_at": null,
  "trigger": "api",
  "options": {
    "mode": "basic",
    "imageMode": "all"
  },
  "images": null,
  "images_count": 0,
  "user_id": null,
  "project_id": null,
  "created_at": "2025-11-16T16:23:17.936Z",
  "updated_at": "2025-11-16T16:23:17.936Z"
}
```

### 2. Get Extraction Status

**Endpoint:** `GET /api/extractions/:id`

Query the status and results of an extraction task.

**Response:** `200 OK`

**When running:**
```json
{
  "id": "1763310197936-lt5msnia2",
  "url": "https://example.com",
  "status": "running",
  ...
}
```

**When complete (basic mode):**
```json
{
  "id": "1763310197936-lt5msnia2",
  "status": "done",
  "images": [
    {
      "id": "abc123",
      "url": "https://example.com/image1.jpg"
    },
    {
      "id": "def456",
      "url": "https://example.com/image2.png"
    }
  ],
  "images_count": 2,
  ...
}
```

**When complete (advanced mode):**
```json
{
  "id": "1763310197936-lt5msnia2",
  "status": "done",
  "images": [
    {
      "id": "abc123",
      "url": "https://example.com/image1.jpg",
      "name": "image1",
      "basename": "image1.jpeg",
      "type": "jpeg",
      "size": 2073600,
      "width": 1920,
      "height": 1080
    }
  ],
  "images_count": 1,
  ...
}
```

### 3. Real-time Progress (WebSocket)

**Endpoint:** `ws://localhost:8080/?taskId=<TASK_ID>`

Subscribe to real-time progress updates via WebSocket.

**Connection:** Connect to WebSocket server on port 8080 with taskId as query parameter.

**Message Types:**

```javascript
// Connection established
{"type":"connected","message":"WebSocket connection established","taskId":"..."}

// Progress updates
{"type":"progress","message":"Loading page...","progress":20}
{"type":"progress","message":"Scrolling down...","progress":40}
{"type":"progress","message":"Finding images...","progress":60}
{"type":"progress","message":"Analyzing images...","progress":80}

// Task complete
{"type":"complete","images_count":21,"status":"done"}

// Task failed
{"type":"error","message":"Error message"}
```

**Example (JavaScript):**

```javascript
const ws = new WebSocket(`ws://localhost:8080/?taskId=${taskId}`)

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)

  if (data.type === 'connected') {
    console.log('WebSocket connected:', data.message)
  } else if (data.type === 'progress') {
    console.log(`Progress: ${data.progress}% - ${data.message}`)
  } else if (data.type === 'complete') {
    console.log('Task completed!', data)
    ws.close()
  } else if (data.type === 'error') {
    console.error('Task failed:', data.message)
    ws.close()
  }
}

ws.onerror = (error) => {
  console.error('WebSocket error:', error)
}

ws.onclose = () => {
  console.log('WebSocket connection closed')
}
```

### 4. Download Single Image

**Endpoint:** `POST /api/downloads/single`

Download a single image from a completed advanced mode extraction.

**Requirements:**
- Task must have `status: "done"`
- Task must be in `advanced` mode

**Request Body:**

```json
{
  "extractionId": "1763310197936-lt5msnia2",
  "imageId": "abc123"
}
```

**Response:** `200 OK` (image/jpeg, image/png, etc.)

Headers:
```
Content-Type: image/jpeg
Content-Disposition: attachment; filename="image1.jpeg"
```

Body: Image binary data

### 5. Download Multiple Images (ZIP)

**Endpoint:** `POST /api/downloads/multiple`

Download multiple images as a ZIP archive from a completed advanced mode extraction.

**Requirements:**
- Task must have `status: "done"`
- Task must be in `advanced` mode

**Request Body:**

```json
{
  "extractionId": "1763310197936-lt5msnia2",
  "imageIds": ["abc123", "def456", "ghi789"]
}
```

**Response:** `200 OK` (application/zip)

Headers:
```
Content-Type: application/zip
Content-Disposition: attachment; filename="example.com-1763310197936.zip"
```

Body: ZIP file binary data

### 6. Health Check

**Endpoint:** `GET /health`

Check API server health and statistics.

**Response:** `200 OK`

```json
{
  "status": "ok",
  "uptime": 7.920261842,
  "memory": {
    "rss": 225685504,
    "heapTotal": 34828288,
    "heapUsed": 19945432,
    "external": 3844035,
    "arrayBuffers": 4279036
  },
  "tasks": {
    "total": 5,
    "pending": 0,
    "running": 1,
    "done": 3,
    "failed": 1
  },
  "cache": {
    "extractionCount": 2,
    "imageCount": 15,
    "totalSizeBytes": 5242880,
    "totalSizeMB": "5.00"
  }
}
```

## Task Status

| Status | Description |
|--------|-------------|
| `pending` | Task created, waiting to start |
| `running` | Task is currently being executed |
| `done` | Task completed successfully |
| `failed` | Task failed with an error |

## Extraction Modes

### basic Mode

**Use case:** Need only image URLs, fast processing

**Features:**
- ✅ Extract image URLs
- ❌ No image download
- ❌ No metadata analysis
- ❌ No download endpoints

**Response fields:**
- `id`: Unique image identifier
- `url`: Image URL

### advanced Mode

**Use case:** Need full image information and download capability

**Features:**
- ✅ Extract image URLs
- ✅ Download and analyze images
- ✅ Get metadata (width, height, format, size)
- ✅ Temporary buffer cache (1 hour)
- ✅ Download endpoints available

**Response fields:**
- `id`: Unique image identifier
- `url`: Image URL
- `name`: Filename without extension
- `basename`: Full filename with extension
- `type`: Image format (jpeg, png, webp, etc.)
- `size`: Image size in pixels (width × height)
- `width`: Image width
- `height`: Image height

## Error Responses

### 400 Bad Request

```json
{
  "error": "URL is required"
}
```

### 404 Not Found

```json
{
  "error": "Task not found"
}
```

### 500 Internal Server Error

```json
{
  "error": "Internal server error"
}
```

## Usage Examples

### Example 1: Basic Mode (Fast URL Extraction)

```bash
# 1. Create extraction task
curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "basic"
  }'

# Response: {"id":"1763310197936-lt5msnia2", ...}

# 2. Query status (poll until done)
curl http://localhost:3000/api/extractions/1763310197936-lt5msnia2

# 3. Use the image URLs from the response
```

### Example 2: Advanced Mode with Real-time Progress

```javascript
// Create extraction task
const response = await fetch('http://localhost:3000/api/extractions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: 'https://example.com',
    mode: 'advanced'
  })
})

const task = await response.json()
console.log('Task created:', task.id)

// Subscribe to real-time progress via WebSocket
const ws = new WebSocket(`ws://localhost:8080/?taskId=${task.id}`)

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)

  if (data.type === 'connected') {
    console.log('Connected to WebSocket')
  } else if (data.type === 'progress') {
    updateProgressBar(data.progress, data.message)
  } else if (data.type === 'complete') {
    console.log(`Found ${data.images_count} images!`)
    ws.close()

    // Fetch results
    fetchResults(task.id)
  } else if (data.type === 'error') {
    console.error('Task failed:', data.message)
    ws.close()
  }
}

ws.onerror = (error) => {
  console.error('WebSocket error:', error)
}

async function fetchResults(taskId) {
  const res = await fetch(`http://localhost:3000/api/extractions/${taskId}`)
  const data = await res.json()

  // Download first image
  const firstImage = data.images[0]
  downloadImage(taskId, firstImage.id)
}

async function downloadImage(extractionId, imageId) {
  const res = await fetch('http://localhost:3000/api/downloads/single', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ extractionId, imageId })
  })

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = 'image.jpg'
  a.click()
}
```

### Example 3: Download Multiple Images as ZIP

```bash
# 1. Create advanced mode extraction
TASK_ID=$(curl -X POST http://localhost:3000/api/extractions \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","mode":"advanced"}' \
  | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

# 2. Wait for completion (or use WebSocket)
sleep 10

# 3. Get results
IMAGES=$(curl http://localhost:3000/api/extractions/$TASK_ID | \
  jq -r '.images[].id' | head -5)

# 4. Download as ZIP
curl -X POST http://localhost:3000/api/downloads/multiple \
  -H "Content-Type: application/json" \
  -d "{\"extractionId\":\"$TASK_ID\",\"imageIds\":$(echo $IMAGES | jq -R 'split(" ")')}" \
  -o images.zip
```

## Rate Limiting & Caching

- **Task Cleanup:** Completed tasks are automatically deleted after 1 hour
- **Image Cache:** Image buffers are cached for 1 hour after extraction
- **Cleanup Interval:** Automatic cleanup runs every 10 minutes

## Server Configuration

### Environment Variables

```bash
PORT=3000              # HTTP API server port (default: 3000)
WS_PORT=8080           # WebSocket server port (default: 8080)
HOST=0.0.0.0           # Bind address (default: 0.0.0.0)
NODE_ENV=production    # Environment mode
```

### Starting the Server

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm run server

# Using PM2
pm2 start server.js --name thumb2original-api
```

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       ├── POST /api/extractions (create task)
       │   └── Returns: task ID
       │
       ├── ws://localhost:8080/?taskId=xxx (WebSocket)
       │   └── Real-time progress updates
       │
       ├── GET /api/extractions/:id (query status)
       │   └── Returns: task details + images
       │
       └── POST /api/downloads/single|multiple
           └── Returns: image(s)

Server Architecture:
┌─────────────────────────────────────────┐
│ HTTP Server (Port 3000)                 │
│  ├── Routes (extractions, downloads)    │
│  ├── Services                           │
│  │   ├── ExtractionService (core)      │
│  │   └── DownloadService               │
│  ├── Storage                            │
│  │   ├── MemoryStorage (tasks)         │
│  │   └── ImageCache (buffers)          │
│  └── WebSocket Manager (progress)      │
└─────────────────────────────────────────┘
│
├─────────────────────────────────────────┐
│ WebSocket Server (Port 8080)            │
│  └── Real-time progress broadcasting    │
└─────────────────────────────────────────┘
```

## Troubleshooting

### Chrome/Puppeteer Not Found

If you see "Could not find Chrome" error:

```bash
# Install Chrome for Puppeteer
npx puppeteer browsers install chrome
```

### Port Already in Use

Change the port via environment variable:

```bash
PORT=3001 npm run server
```

### Memory Issues

Adjust cleanup intervals or reduce concurrent tasks in `server/app.js`.
