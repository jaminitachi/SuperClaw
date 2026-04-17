# SuperClaw v4 Team Structure

## DEV TEAM (개발 요청)
| Role | Agent File | Model | Provider |
|------|-----------|-------|----------|
| architect | dev-architect.md | opus | claude |
| frontend | dev-frontend.md | sonnet | claude (--debate 시에만 codex/gemini) |
| backend | dev-backend.md | sonnet | claude (--debate 시에만 codex/gemini) |
| qa | dev-qa.md | sonnet | claude |

## RESEARCH TEAM (연구 요청)
| Role | Agent File | Model | Provider |
|------|-----------|-------|----------|
| reviewer | research-reviewer.md | opus | claude |
| writer | research-writer.md | opus | claude |
| assistant | research-assistant.md | haiku | claude |

## INFRA TEAM (시스템 관리)
| Role | Agent File | Model | Provider |
|------|-----------|-------|----------|
| monitor | infra-monitor.md | haiku | claude |
| mac-control | infra-mac.md | sonnet | claude |

## VERIFY TEAM (품질 보증)
| Role | Agent File | Model | Provider |
|------|-----------|-------|----------|
| verifier | verify.md | sonnet | claude |

## PO Protocol
1. Analyze request → classify (dev/research/infra)
2. Select team → assign roles
3. QA writes tests first (TDD RED)
4. Implementation team codes (TDD GREEN)
5. Architect reviews (TDD REFACTOR)
6. Verifier independently confirms
7. PO evaluates → iterate or accept
