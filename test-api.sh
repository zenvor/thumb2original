#!/bin/bash
# API 服务器快速测试脚本

API_URL="http://localhost:3000"

echo "=========================================="
echo "thumb2original API 测试脚本"
echo "=========================================="
echo ""

# 检查服务器是否运行
echo "1️⃣  检查服务器健康状态..."
if curl -s ${API_URL}/health > /dev/null 2>&1; then
    echo "✅ 服务器运行正常"
    curl -s ${API_URL}/health | jq . || curl -s ${API_URL}/health
else
    echo "❌ 服务器未运行，请先执行: npm run server"
    exit 1
fi

echo ""
echo "2️⃣  创建测试任务..."
RESPONSE=$(curl -s -X POST ${API_URL}/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "config": {
      "scrapeMode": "single_page",
      "imageMode": "all",
      "targetUrl": "https://nuxt.com/",
      "maxRetries": 1,
      "concurrentDownloads": 5
    }
  }')

echo "$RESPONSE" | jq . || echo "$RESPONSE"

TASK_ID=$(echo "$RESPONSE" | grep -o '"taskId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TASK_ID" ]; then
    echo "❌ 创建任务失败"
    exit 1
fi

echo "✅ 任务已创建: $TASK_ID"

echo ""
echo "3️⃣  查看任务状态（每 2 秒刷新）..."
echo "按 Ctrl+C 停止监控"
echo ""

for i in {1..30}; do
    STATUS=$(curl -s ${API_URL}/api/tasks/${TASK_ID})
    TASK_STATUS=$(echo "$STATUS" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

    echo "[$i] 状态: $TASK_STATUS"
    echo "$STATUS" | jq . || echo "$STATUS"
    echo ""

    if [ "$TASK_STATUS" = "completed" ] || [ "$TASK_STATUS" = "failed" ]; then
        echo "✅ 任务已结束: $TASK_STATUS"
        break
    fi

    sleep 2
done

echo ""
echo "4️⃣  查看所有任务统计..."
curl -s ${API_URL}/api/tasks | jq '.stats' || curl -s ${API_URL}/api/tasks

echo ""
echo "=========================================="
echo "测试完成！"
echo "=========================================="
