#!/bin/bash
# sc-sync-pmset.sh — Scan launchd plist schedules and set pmset repeat wake times.
# Called by superclaw daemon on startup. Requires NOPASSWD sudoers for /usr/bin/pmset.
# macOS only.

set -uo pipefail

PLIST_DIR="$HOME/Library/LaunchAgents"
WAKE_TIMES=()

for plist in "$PLIST_DIR"/com.user.sc-*.plist; do
    [ -f "$plist" ] || continue
    HOUR=$(/usr/libexec/PlistBuddy -c "Print :StartCalendarInterval:Hour" "$plist" 2>/dev/null)
    MIN=$(/usr/libexec/PlistBuddy -c "Print :StartCalendarInterval:Minute" "$plist" 2>/dev/null)
    [ -z "$HOUR" ] && continue

    WAKE_MIN=$((MIN - 5))
    WAKE_HOUR=$HOUR
    if [ $WAKE_MIN -lt 0 ]; then
        WAKE_MIN=$((WAKE_MIN + 60))
        WAKE_HOUR=$(( (WAKE_HOUR - 1 + 24) % 24 ))
    fi
    WAKE_TIMES+=("$(printf '%02d:%02d' $WAKE_HOUR $WAKE_MIN)")
done

if [ ${#WAKE_TIMES[@]} -eq 0 ]; then
    echo "[sc-sync-pmset] No schedules found. Skipping."
    exit 0
fi

EARLIEST=$(printf '%s\n' "${WAKE_TIMES[@]}" | sort | head -1)

if [ -n "$EARLIEST" ]; then
    sudo -n /usr/bin/pmset repeat wakeorpoweron MTWRFSU "${EARLIEST}:00" 2>/dev/null
    if [ $? -eq 0 ]; then
        echo "[sc-sync-pmset] Set wakeorpoweron at ${EARLIEST} daily (earliest of ${#WAKE_TIMES[@]} schedules)"
    else
        echo "[sc-sync-pmset] pmset failed (sudoers not configured). Run: sudo pmset repeat wakeorpoweron MTWRFSU ${EARLIEST}:00"
    fi
fi
