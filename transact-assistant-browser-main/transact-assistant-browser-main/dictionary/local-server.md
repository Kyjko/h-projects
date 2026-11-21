# Local Server for Visual Emulation

When the agent needs to capture a screenshot of a locally generated HTML file (e.g., for BrowserWeb emulation), it must serve the file over HTTP because `file://` URLs are blocked by the screenshot tools.

## Workflow
1. **Start Server**: Run `python3 -m http.server 8000` in the background.
2. **Capture**: Use `mcp__screenshot-website-fast__take_screenshot` with `url: "http://localhost:8000/<filename>.html"`.
3. **Stop Server**: Kill the python process once the image is captured.

## Port
Default port: `8000`
