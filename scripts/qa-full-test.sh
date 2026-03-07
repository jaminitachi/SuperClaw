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

1. sc_status
2. sc_telegram_status
3. sc_memory_stats
4. sc_memory_store: category="qa-auto", subject="Auto QA '$(date +%H%M%S)'", content="Automated test"
5. sc_memory_search: query="qa-auto"
6. sc_memory_recall: 방금 저장한 ID로
7. sc_memory_add_entity: name="QA-Auto-'$(date +%s)'", type="test"
8. sc_learning_store: category="successes", content="Auto QA passed '$(date)'"
9. sc_learning_summary
10. sc_verification_log: task="Auto QA", claimed_result="pass", verified_result="pass", passed=true
11. sc_cron_list
12. sc_cron_add: name="qa-temp-'$(date +%s)'", schedule="0 0 31 2 *", command="echo test"
13. sc_cron_remove: 방금 추가한 잡
14. sc_telegram_inbox: limit=1
15. sc_app_list
16. sc_app_frontmost

마지막에 이 형식으로 출력해:
TOTAL: X/16 PASS
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
if echo "$REPORT" | grep -q "16/16 PASS"; then
  echo "" | tee -a "$LOGFILE"
  echo "✅ ALL TESTS PASSED" | tee -a "$LOGFILE"
  exit 0
elif echo "$REPORT" | grep -q "TOTAL:"; then
  PASS_COUNT=$(echo "$REPORT" | grep -oP '\d+(?=/16 PASS)' | head -1)
  echo "" | tee -a "$LOGFILE"
  echo "⚠️ ${PASS_COUNT:-?}/16 PASSED — check log: $LOGFILE" | tee -a "$LOGFILE"
  exit 1
else
  echo "" | tee -a "$LOGFILE"
  echo "❌ QA FAILED — unexpected output. Check log: $LOGFILE" | tee -a "$LOGFILE"
  exit 1
fi
