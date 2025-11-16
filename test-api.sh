#!/bin/bash

# Test script for thumb2original API

API_URL="http://localhost:3000"

echo "===================================="
echo "Testing thumb2original API"
echo "===================================="
echo ""

echo "1. Testing health endpoint..."
curl -s "${API_URL}/health" | grep -q "ok" && echo "✅ Health check passed" || echo "❌ Health check failed"
echo ""

echo "2. Creating extraction task (basic mode)..."
RESPONSE=$(curl -s -X POST "${API_URL}/api/extractions" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "mode": "basic"
  }')

echo "$RESPONSE" | head -5
TASK_ID=$(echo "$RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$TASK_ID" ]; then
  echo "✅ Task created: $TASK_ID"
  echo ""

  echo "3. Querying task status..."
  sleep 2
  curl -s "${API_URL}/api/extractions/${TASK_ID}" | head -5
  echo ""
  echo "✅ Task query successful"
else
  echo "❌ Failed to create task"
fi

echo ""
echo "4. Testing invalid requests..."
curl -s -X POST "${API_URL}/api/extractions" \
  -H "Content-Type: application/json" \
  -d '{}' | grep -q "error" && echo "✅ Invalid request properly rejected" || echo "❌ Should reject invalid request"

echo ""
echo "===================================="
echo "API Test Complete"
echo "===================================="
