---
name: sc-screenshot
description: Quick screenshot capture with optional Telegram send
allowed-tools: Read, Bash
---

# /sc-screenshot - Quick Screenshot Command

Take a screenshot of the current screen and optionally send it to Telegram.

## Activation

Triggered by: `/sc-screenshot`, "take a screenshot", "capture screen", "screenshot and send"

## Arguments

- No arguments: Take screenshot and display the file path
- `send` or `telegram`: Take screenshot AND send to Telegram
- `display N`: Capture specific display (default: 1)

## Steps

1. **Capture screenshot**: Call `sc_screenshot` with the default display (or specified display number).
   ```
   sc_screenshot({ display: 1 })
   ```
   This returns the path to the saved screenshot image file.

2. **Read the image**: Use the Read tool on the returned file path to display the screenshot contents to the user. This allows visual inspection of what was captured.

3. **Send to Telegram** (if requested): If the user said "send", "telegram", or included "send" in the command args, send the screenshot via Telegram:
   ```
   sc_send_message({
     channel: "telegram",
     message: "Screenshot captured",
     image: "/path/to/screenshot.png"
   })
   ```
   Report delivery status.

4. **Report**: Show the user:
   - Screenshot file path
   - File size
   - Whether it was sent to Telegram (and delivery status)

## Error Handling

- If Peekaboo is not installed, report: "Peekaboo not found. Install with: brew install peekaboo"
- If screenshot capture fails, suggest checking screen recording permissions in System Settings > Privacy & Security
- If Telegram send fails, still show the local screenshot path so the user has the file
- If the specified display number does not exist, fall back to display 1

## Notes

- Screenshots are saved to ~/superclaw/data/screenshots/ by default
- The Read tool can display image files, so the user will see the screenshot inline
- This is a quick command wrapper around the mac-control skill's screenshot capability
