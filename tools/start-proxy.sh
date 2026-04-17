#!/bin/bash
# Claude Code API 프록시 캡처 시작
#
# 터미널 1: bash ~/superclaw/tools/start-proxy.sh
# 터미널 2: bash ~/superclaw/tools/start-claude-proxied.sh

PORT=${1:-8888}
CAPTURE_DIR=~/superclaw/data/logs/api-captures

echo "======================================"
echo " Claude Code API Proxy Capture"
echo "======================================"
echo ""
echo "프록시 포트: $PORT"
echo "캡처 저장: $CAPTURE_DIR"
echo ""
echo "다른 터미널에서 실행:"
echo "  bash ~/superclaw/tools/start-claude-proxied.sh"
echo ""
echo "캡처 파일 보기:"
echo "  ls -lt $CAPTURE_DIR/*.json | head"
echo ""
echo "종료: Ctrl+C"
echo "======================================"
echo ""

mkdir -p "$CAPTURE_DIR"

# mitmdump: 헤드리스 모드 (터미널에 로그 출력)
# --ssl-insecure: 업스트림 SSL 검증 스킵
# -s: 캡처 스크립트
mitmdump \
  -p "$PORT" \
  --ssl-insecure \
  --set flow_detail=0 \
  -s ~/superclaw/tools/claude-proxy-capture.py
