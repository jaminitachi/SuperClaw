#!/bin/bash
# 프록시를 통해 Claude Code 시작
#
# 먼저 start-proxy.sh를 다른 터미널에서 실행할 것

PORT=${1:-8888}

echo "======================================"
echo " Claude Code (Proxied)"
echo "======================================"
echo ""
echo "프록시: http://localhost:$PORT"
echo "모든 API 요청/응답이 캡처됩니다."
echo ""
echo "캡처 결과: ~/superclaw/data/logs/api-captures/"
echo "======================================"
echo ""

# 프록시 활성 확인
if ! curl -s -o /dev/null http://localhost:$PORT 2>/dev/null; then
  echo "⚠ 프록시가 실행 중이 아닙니다!"
  echo "  먼저 다른 터미널에서: bash ~/superclaw/tools/start-proxy.sh"
  exit 1
fi

HTTPS_PROXY=http://localhost:$PORT \
NODE_TLS_REJECT_UNAUTHORIZED=0 \
claude
