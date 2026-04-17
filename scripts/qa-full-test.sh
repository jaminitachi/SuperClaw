#!/bin/bash
# SuperClaw Full QA Pipeline
# Run after every build to verify all MCP tools work.
# Usage: npm run qa  OR  bash scripts/qa-full-test.sh
#
# Exit code: 0 = all pass, 1 = failures detected

set -euo pipefail

LOGFILE="$HOME/superclaw/data/logs/qa-$(date +%Y%m%d-%H%M%S).log"
mkdir -p "$(dirname "$LOGFILE")"

echo "=== SuperClaw QA Pipeline ===" | tee "$LOGFILE"
echo "Started: $(date)" | tee -a "$LOGFILE"
echo "" | tee -a "$LOGFILE"

# Test prompt that exercises ALL MCP tools
TEST_PROMPT='SuperClaw 전체 QA 테스트를 실행해. 각 도구를 호출하고 PASS/FAIL로 보고해.
Do NOT leave test data in the DB (test sc_memory_store in read-only mode only).

1. sc_status
2. sc_telegram_status
3. sc_memory_stats
4. sc_memory_search: query="consolidation" (읽기만 -- 쓰기 금지)
5. sc_learning_summary
6. sc_learning_recall: project="superclaw", limit=3
7. sc_verification_log: task="Auto QA", claimed_result="pass", verified_result="pass", passed=true
8. sc_cron_list
9. sc_cron_add: name="qa-temp-'$(date +%s)'", schedule="0 0 31 2 *", command="echo test"
10. sc_cron_remove: 방금 추가한 잡
11. sc_telegram_inbox: limit=1
12. sc_app_list
13. sc_app_frontmost
14. sc_notepad_read

마지막에 이 형식으로 출력해:
TOTAL: X/14 PASS
FAILED: [실패한 도구 이름들]'

RESULT=$(timeout 120 env -u CLAUDECODE claude -p "$TEST_PROMPT" \
  --model haiku \
  --max-turns 20 \
  --output-format json \
  --permission-mode bypassPermissions 2>/dev/null)

# Extract result
REPORT=$(echo "$RESULT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('result','ERROR: no result'))" 2>/dev/null)

echo "$REPORT" | tee -a "$LOGFILE"
echo "" | tee -a "$LOGFILE"
echo "Finished: $(date)" | tee -a "$LOGFILE"

# Check for failures
if echo "$REPORT" | grep -q "14/14 PASS"; then
  echo "" | tee -a "$LOGFILE"
  echo "✅ ALL TESTS PASSED" | tee -a "$LOGFILE"
  exit 0
elif echo "$REPORT" | grep -q "TOTAL:"; then
  PASS_COUNT=$(echo "$REPORT" | grep -oP '\d+(?=/14 PASS)' | head -1)
  echo "" | tee -a "$LOGFILE"
  echo "⚠️ ${PASS_COUNT:-?}/14 PASSED — check log: $LOGFILE" | tee -a "$LOGFILE"
  exit 1
else
  echo "" | tee -a "$LOGFILE"
  echo "❌ QA FAILED — unexpected output. Check log: $LOGFILE" | tee -a "$LOGFILE"
  exit 1
fi
