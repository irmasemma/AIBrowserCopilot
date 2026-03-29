# Is AI Browser CoPilot Safe?

## What does this extension do?
AI Browser CoPilot connects your browser to your AI assistant (like Claude) so the AI can read pages, fill forms, and extract data on your behalf.

## Does it send my data anywhere?
No. All data stays on your machine. The extension communicates with a local program (the browser bridge) running on your computer. Nothing is sent to external servers.

## What permissions does it need and why?
- **activeTab**: Read the page you're currently viewing (only when your AI requests it)
- **tabs**: See which tabs are open so your AI can help you navigate
- **sidePanel**: Show the extension's control panel
- **storage**: Save your preferences and activity log locally
- **nativeMessaging**: Communicate with the local browser bridge

## Can the AI access my banking or email?
No. Banking, email, and authentication sites are blocked by default. The AI cannot read or interact with these sites.

## Can I control what the AI can do?
Yes. Every tool has an on/off toggle in the side panel. You choose which capabilities your AI has.

## Is there an activity log?
Yes. Every action the AI takes is logged in the side panel with timestamp, tool used, and target URL. You can review everything at any time.

## Who built this?
AI Browser CoPilot is built by an independent developer. It's not affiliated with Anthropic, Google, or any AI company.
