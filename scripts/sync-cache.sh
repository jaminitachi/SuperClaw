#!/bin/bash
# sync-cache.sh — Sync source files to Claude Code plugin cache
# Run after modifying scripts, agents, skills, or tools that aren't built by esbuild

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$SRC_DIR/package.json').version")
CACHE_DIR="$HOME/.claude/plugins/cache/superclaw/superclaw/$VERSION"

if [ ! -d "$CACHE_DIR" ]; then
  echo "Cache directory not found: $CACHE_DIR"
  echo "Run 'npm run setup' first, or check your plugin version."
  exit 1
fi

echo "=== SuperClaw Cache Sync ==="
echo "  Source: $SRC_DIR"
echo "  Cache:  $CACHE_DIR"
echo ""

synced=0

sync_file() {
  local rel="$1"
  local src="$SRC_DIR/$rel"
  local dst="$CACHE_DIR/$rel"

  if [ ! -f "$src" ]; then
    return
  fi

  mkdir -p "$(dirname "$dst")"

  if [ ! -f "$dst" ] || ! cmp -s "$src" "$dst"; then
    cp "$src" "$dst"
    echo "  SYNCED: $rel"
    synced=$((synced + 1))
  fi
}

# Scripts (hooks, keyword detector, etc.)
for f in "$SRC_DIR"/scripts/*.mjs "$SRC_DIR"/scripts/*.sh; do
  [ -f "$f" ] && sync_file "scripts/$(basename "$f")"
done

# Scripts lib (shared utilities used by hooks)
for f in "$SRC_DIR"/scripts/lib/*.mjs; do
  [ -f "$f" ] && sync_file "scripts/lib/$(basename "$f")"
done

# Agents
for f in "$SRC_DIR"/agents/*.md; do
  [ -f "$f" ] && sync_file "agents/$(basename "$f")"
done

# Skills
find "$SRC_DIR/skills" -name "SKILL.md" 2>/dev/null | while read -r f; do
  rel="${f#$SRC_DIR/}"
  sync_file "$rel"
done

# Tools
for f in "$SRC_DIR"/tools/*.mjs "$SRC_DIR"/tools/*.sh; do
  [ -f "$f" ] && sync_file "tools/$(basename "$f")"
done

# Hooks
sync_file "hooks/hooks.json"

# Top-level docs
for f in DELEGATION.md README.md ROADMAP-v3.md; do
  sync_file "$f"
done

echo ""
if [ $synced -eq 0 ]; then
  echo "  Already up to date."
else
  echo "  $synced file(s) synced."
fi
echo ""
echo "NOTE: Restart Claude Code for hook changes to take full effect."
