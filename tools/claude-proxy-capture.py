"""
mitmproxy addon: Claude Code API 요청/응답 raw JSON 캡처

사용법:
  mitmdump -s ~/superclaw/tools/claude-proxy-capture.py -p 8888 --ssl-insecure

그 후 다른 터미널에서:
  HTTPS_PROXY=http://localhost:8888 NODE_TLS_REJECT_UNAUTHORIZED=0 claude

캡처 결과: ~/superclaw/data/logs/api-captures/ 에 저장
"""

import json
import os
import time
from datetime import datetime
from pathlib import Path

from mitmproxy import http, ctx

CAPTURE_DIR = Path.home() / "superclaw" / "data" / "logs" / "api-captures"
CAPTURE_DIR.mkdir(parents=True, exist_ok=True)

# Anthropic API만 캡처
TARGET_HOSTS = ["api.anthropic.com"]

counter = 0


def request(flow: http.HTTPFlow) -> None:
    """요청 캡처"""
    global counter
    if not any(h in flow.request.pretty_host for h in TARGET_HOSTS):
        return

    counter += 1
    ts = datetime.now().strftime("%H%M%S")
    prefix = f"{ts}_{counter:04d}"

    # 요청 메타데이터
    meta = {
        "timestamp": datetime.now().isoformat(),
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "headers": dict(flow.request.headers),
    }

    # 요청 본문 파싱
    body_raw = flow.request.get_text()
    try:
        body = json.loads(body_raw)
    except (json.JSONDecodeError, TypeError):
        body = body_raw

    # 요약 출력 (터미널에 표시)
    if isinstance(body, dict):
        model = body.get("model", "?")
        msgs = body.get("messages", [])
        tools = body.get("tools", [])
        system_parts = body.get("system", [])

        # system prompt 길이
        sys_len = 0
        if isinstance(system_parts, list):
            for s in system_parts:
                if isinstance(s, dict):
                    sys_len += len(s.get("text", ""))
                elif isinstance(s, str):
                    sys_len += len(s)
        elif isinstance(system_parts, str):
            sys_len = len(system_parts)

        # 마지막 유저 메시지
        last_user = ""
        for m in reversed(msgs):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str):
                    last_user = content[:200]
                elif isinstance(content, list):
                    for c in content:
                        if isinstance(c, dict) and c.get("type") == "text":
                            last_user = c.get("text", "")[:200]
                            break
                break

        ctx.log.info(
            f"\n{'='*80}\n"
            f"[REQ #{counter}] → {model}\n"
            f"  system: {sys_len:,} chars\n"
            f"  messages: {len(msgs)} ({sum(1 for m in msgs if m.get('role')=='user')} user, "
            f"{sum(1 for m in msgs if m.get('role')=='assistant')} assistant)\n"
            f"  tools: {len(tools)} defined\n"
            f"  last_user: {last_user[:120]}...\n"
            f"{'='*80}"
        )

    # 파일 저장
    req_file = CAPTURE_DIR / f"{prefix}_req.json"
    with open(req_file, "w") as f:
        json.dump({"meta": meta, "body": body}, f, indent=2, ensure_ascii=False)

    # flow에 메타 저장 (응답에서 참조)
    flow.metadata["capture_prefix"] = prefix
    flow.metadata["capture_counter"] = counter


def response(flow: http.HTTPFlow) -> None:
    """응답 캡처"""
    if not any(h in flow.request.pretty_host for h in TARGET_HOSTS):
        return

    prefix = flow.metadata.get("capture_prefix", "unknown")
    num = flow.metadata.get("capture_counter", "?")

    # 응답 메타데이터
    meta = {
        "timestamp": datetime.now().isoformat(),
        "status_code": flow.response.status_code,
        "headers": dict(flow.response.headers),
    }

    # 응답 본문
    body_raw = flow.response.get_text()
    try:
        body = json.loads(body_raw)
    except (json.JSONDecodeError, TypeError):
        body = body_raw

    # 요약 출력
    if isinstance(body, dict):
        stop = body.get("stop_reason", "?")
        usage = body.get("usage", {})
        content = body.get("content", [])

        # 컨텐츠 요약
        content_types = {}
        for c in content:
            t = c.get("type", "unknown")
            content_types[t] = content_types.get(t, 0) + 1

        # 텍스트 미리보기
        text_preview = ""
        for c in content:
            if c.get("type") == "text":
                text_preview = c.get("text", "")[:200]
                break
            elif c.get("type") == "tool_use":
                text_preview = f"[tool_use: {c.get('name', '?')}]"
                break

        def fmt(v):
            return f"{v:,}" if isinstance(v, int) else str(v)

        ctx.log.info(
            f"\n{'─'*80}\n"
            f"[RES #{num}] ← {flow.response.status_code} | stop: {stop}\n"
            f"  usage: in={fmt(usage.get('input_tokens', '?'))} "
            f"out={fmt(usage.get('output_tokens', '?'))} "
            f"cache_read={fmt(usage.get('cache_read_input_tokens', 0))} "
            f"cache_create={fmt(usage.get('cache_creation_input_tokens', 0))}\n"
            f"  content: {content_types}\n"
            f"  preview: {text_preview[:150]}...\n"
            f"  saved: {prefix}_res.json\n"
            f"{'─'*80}"
        )

    # 파일 저장
    res_file = CAPTURE_DIR / f"{prefix}_res.json"
    with open(res_file, "w") as f:
        json.dump({"meta": meta, "body": body}, f, indent=2, ensure_ascii=False)
