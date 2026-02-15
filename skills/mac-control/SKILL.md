---
name: mac-control
description: Full macOS automation via Peekaboo and AppleScript - screenshots, UI interaction, app control
allowed-tools: Read, Write, Edit, Bash, Grep, Glob
---

<Purpose>
Enable agentic Mac control through the Peekaboo CLI for UI automation and AppleScript for system
control. This skill provides 15 MCP tools covering screenshots, UI element inspection, mouse/keyboard
input, app lifecycle management, window positioning, OCR text extraction, and arbitrary AppleScript
execution. It turns Claude Code into a full macOS automation agent that can see the screen, understand
UI layouts, click buttons, type text, and orchestrate multi-step visual workflows.
</Purpose>

<Use_When>
- User says "screenshot", "take a picture of the screen", "show me what's on screen"
- User says "click on", "press the button", "type into", "fill in the form"
- User says "open app", "launch Safari", "quit Finder", "close the app"
- User says "move window", "resize", "arrange windows", "tile windows"
- User says "control mac", "automate", "what does the screen show"
- User says "run AppleScript", "osascript", "JXA"
- User needs OCR text extraction from a visual element
- Multi-step UI automation: navigating menus, filling forms, clicking through wizards
</Use_When>

<Do_Not_Use_When>
- Pure code/file operations -- use standard Read/Write/Edit tools directly
- Terminal commands that don't need UI -- use Bash tool directly
- Sending notifications to Telegram -- use telegram-control skill instead
- Web scraping where a URL is known -- use WebFetch tool instead
- User explicitly wants CLI-only approach without visual automation
</Do_Not_Use_When>

<Why_This_Exists>
Claude Code operates in a terminal but many tasks require interacting with the macOS GUI:
verifying a web app looks correct in Safari, filling out system preference dialogs, taking
annotated screenshots for documentation, reading text from images, or automating repetitive
GUI workflows. Without this skill, users must manually perform these visual tasks and describe
results back to Claude. With it, Claude can see, understand, and interact with the full macOS
desktop autonomously.
</Why_This_Exists>

<Execution_Policy>
- Safety first: ALWAYS screenshot before clicking to verify target is correct
- Execute sequentially: inspect -> verify -> act -> confirm
- Max retries: 2 for UI actions that fail (element not found, click missed)
- Pause 500ms between rapid UI actions to let the OS catch up
- Cancel: If 3 consecutive actions fail on the same UI element, stop and report
- Never send keyboard shortcuts without confirming the correct app is frontmost
- For destructive actions (quit app, delete): confirm with user first
</Execution_Policy>

<Steps>
1. **Phase 1 - Identify Target**: Determine what app, window, or UI element to interact with
   - Clarify the user's intent: which app, which button, what text to type
   - If ambiguous: use `sc_app_frontmost` to get current focused app
   - Use `sc_app_list` to verify the target app is running

2. **Phase 2 - Screenshot Current State**: Capture the screen to understand the visual layout
   - Tool: `sc_screenshot` with optional `window` parameter for specific app
   - Output: file path to screenshot image plus OCR text of visible content
   - SAFETY RULE: Always do this before any click/type action to verify state

3. **Phase 3 - Map UI Elements**: Inspect accessible UI elements for precise targeting
   - Tool: `sc_see` with optional `app` parameter
   - Output: list of elements with IDs, roles, titles, and frame coordinates
   - Format: `[element_id] role: title @ (x,y wxh)`
   - Use element IDs for reliable clicking instead of raw coordinates

4. **Phase 4 - Execute Action**: Perform the requested UI interaction
   - Click: `sc_click` with `element` (ID from sc_see) OR `x`/`y` coordinates
   - Type: `sc_type` with `text` string (types at current cursor position)
   - Hotkey: `sc_hotkey` with `keys` string (e.g., "cmd+c", "cmd+shift+s")
   - OCR: `sc_ocr` with optional `window` to extract text from screen
   - AppleScript: `sc_osascript` with `script` and optional `language` ("applescript"|"jxa")
   - Notify: `sc_notify` with `title` and `message` for macOS notification center

5. **Phase 5 - App & Window Management**: Control application lifecycle and window layout
   - Launch: `sc_app_launch` with `app` name (e.g., "Safari", "Terminal")
   - Quit: `sc_app_quit` with `app` name
   - List running: `sc_app_list` (no params, returns app name list)
   - Frontmost: `sc_app_frontmost` (no params, returns focused app name)
   - Windows: `sc_window_list` with `app` name -> returns indexed window list with positions/sizes
   - Move: `sc_window_move` with `app`, `x`, `y`, optional `windowIndex`
   - Resize: `sc_window_resize` with `app`, `width`, `height`, optional `windowIndex`

6. **Phase 6 - Verify Result**: Confirm the action succeeded
   - Take a follow-up screenshot with `sc_screenshot`
   - Compare visual state to expected outcome
   - Use `sc_ocr` to verify text appeared/changed as expected
   - If action failed: identify why (wrong element, app not focused, dialog appeared) and retry

7. **Phase 7 - Report Outcome**: Inform the user what was done
   - Describe the action taken and the visual result
   - Include screenshot path if relevant
   - If multi-step: summarize all steps completed
</Steps>

<Tool_Usage>
**Visual Inspection (3 tools):**
- `sc_screenshot` -- Capture screen or window; params: `window` (optional string), `format` (optional "png"|"jpg"). Returns file path and OCR text
- `sc_see` -- Inspect UI element tree via accessibility API; params: `app` (optional string). Returns element IDs, roles, titles, frame coordinates
- `sc_ocr` -- Extract text from screen region; params: `window` (optional string). Returns recognized text string

**Input (3 tools):**
- `sc_click` -- Click element or position; params: `element` (optional string, ID from sc_see), `x` (optional number), `y` (optional number). Provide element OR x+y
- `sc_type` -- Type text at cursor; params: `text` (string). Types the full string at current cursor position
- `sc_hotkey` -- Press keyboard shortcut; params: `keys` (string, e.g. "cmd+c", "cmd+shift+s", "ctrl+alt+delete")

**App Lifecycle (4 tools):**
- `sc_app_launch` -- Launch/activate app; params: `app` (string, e.g. "Safari")
- `sc_app_quit` -- Quit app; params: `app` (string)
- `sc_app_list` -- List running apps; no params. Returns newline-separated app names
- `sc_app_frontmost` -- Get focused app; no params. Returns single app name string

**Window Management (3 tools):**
- `sc_window_list` -- List app windows; params: `app` (string). Returns indexed list with name, position, size
- `sc_window_move` -- Move window; params: `app` (string), `x` (number), `y` (number), `windowIndex` (optional number, default 0)
- `sc_window_resize` -- Resize window; params: `app` (string), `width` (number), `height` (number), `windowIndex` (optional number, default 0)

**System (2 tools):**
- `sc_osascript` -- Execute AppleScript or JXA; params: `script` (string), `language` (optional "applescript"|"jxa")
- `sc_notify` -- Send macOS notification; params: `title` (string), `message` (string)
</Tool_Usage>

<Examples>
<Good>
User: "Click the Save button in Xcode"
Action: 1) sc_screenshot(window="Xcode") to see current state, 2) sc_see(app="Xcode") to find the Save button element ID, 3) sc_click(element="save-button-id") using the discovered ID, 4) sc_screenshot(window="Xcode") to verify the save completed
Why good: Screenshots before and after, uses element ID instead of guessing coordinates, verifies result
</Good>

<Good>
User: "Arrange Safari and Terminal side by side"
Action: 1) sc_app_launch(app="Safari"), 2) sc_app_launch(app="Terminal"), 3) sc_window_move(app="Safari", x=0, y=25), sc_window_resize(app="Safari", width=960, height=1050), 4) sc_window_move(app="Terminal", x=960, y=25), sc_window_resize(app="Terminal", width=960, height=1050), 5) sc_screenshot() to verify layout
Why good: Ensures both apps are running, positions precisely for side-by-side, verifies with screenshot
</Good>

<Good>
User: "What text is on screen right now?"
Action: 1) sc_screenshot() to capture, 2) sc_ocr() to extract all visible text, 3) Return the OCR results
Why good: Combines screenshot (for visual context) with OCR (for text extraction)
</Good>

<Bad>
User: "Click the submit button"
Action: sc_click(x=500, y=300) with hardcoded coordinates
Why bad: Never guess coordinates. Always use sc_see first to find the element ID, or at minimum sc_screenshot to verify the target location
</Bad>

<Bad>
User: "Press Cmd+Q"
Action: Immediately call sc_hotkey(keys="cmd+q") without checking frontmost app
Why bad: Could quit the wrong application. Always verify sc_app_frontmost first for destructive shortcuts
</Bad>
</Examples>

<Escalation_And_Stop_Conditions>
- **Stop** if Peekaboo CLI is not installed -- inform user: "Peekaboo is required for mac-control. Install via: brew install peekaboo"
- **Stop** if accessibility permissions are not granted -- inform user: "Grant accessibility access to Terminal/iTerm in System Settings > Privacy & Security > Accessibility"
- **Stop** after 3 consecutive failed clicks on the same element -- the UI state may have changed
- **Escalate** if sc_see returns no elements for a known-running app -- accessibility API may be blocked by the app
- **Escalate** if sc_osascript returns permission errors -- user needs to grant automation permissions
- **Confirm with user** before any destructive action: quitting apps, pressing Delete/Backspace on important content, or closing unsaved documents
</Escalation_And_Stop_Conditions>

<Final_Checklist>
- [ ] Screenshot taken BEFORE any click/type action (safety rule)
- [ ] Correct app is frontmost before sending keyboard shortcuts
- [ ] Element ID used for clicks when available (not raw coordinates)
- [ ] Result verified with follow-up screenshot or OCR
- [ ] No destructive actions performed without user confirmation
- [ ] All multi-step actions completed in correct sequence
- [ ] User informed of outcome with evidence (screenshot path or extracted text)
- [ ] Error state handled gracefully with clear user-facing message
</Final_Checklist>

<Advanced>
## Configuration

Peekaboo must be installed and accessible:
```bash
# Check if Peekaboo is installed
which peekaboo || brew install peekaboo

# Verify accessibility permissions
peekaboo check-permissions
```

Required macOS permissions (System Settings > Privacy & Security):
- **Accessibility**: Terminal.app or iTerm2 (for UI element interaction)
- **Screen Recording**: Terminal.app or iTerm2 (for screenshots)
- **Automation**: Terminal.app controlling target apps (for AppleScript)

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| sc_see returns empty | No accessibility permission | Grant in System Settings > Privacy > Accessibility |
| sc_screenshot is blank | No screen recording permission | Grant in System Settings > Privacy > Screen Recording |
| sc_click does nothing | Wrong element ID or stale state | Re-run sc_see to refresh element tree, then retry |
| sc_osascript permission error | Automation not allowed | Grant in System Settings > Privacy > Automation |
| sc_app_launch fails | App not installed or wrong name | Use exact app name from /Applications (e.g., "Google Chrome" not "Chrome") |
| Coordinates are wrong | Retina display scaling | Peekaboo handles scaling automatically; if issues persist, check display arrangement in System Settings |

## Common Patterns

**Navigate to URL in Safari:**
```
1. sc_app_launch(app="Safari")
2. sc_hotkey(keys="cmd+l")       -- Focus address bar
3. sc_type(text="https://example.com")
4. sc_hotkey(keys="return")       -- Navigate
5. Wait 2s for page load
6. sc_screenshot(window="Safari") -- Verify page loaded
```

**Fill a form:**
```
1. sc_see(app="TargetApp")        -- Map all form fields
2. sc_click(element="field-1-id") -- Focus first field
3. sc_type(text="value1")
4. sc_hotkey(keys="tab")          -- Move to next field
5. sc_type(text="value2")
6. sc_click(element="submit-id")  -- Submit
```

**Multi-monitor window arrangement:**
```
1. sc_window_list(app="AppName")  -- Get current positions
2. sc_window_move(app="AppName", x=1920, y=0)  -- Move to second display
3. sc_window_resize(app="AppName", width=1920, height=1080)
```

**Clipboard operations via AppleScript:**
```
sc_osascript(script='set the clipboard to "copied text"')
sc_osascript(script='return the clipboard')
```

**System information via AppleScript:**
```
sc_osascript(script='do shell script "sw_vers -productVersion"')
sc_osascript(script='tell application "System Events" to get name of every process whose background only is false')
```
</Advanced>
