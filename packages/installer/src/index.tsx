import { render } from 'ink';
import React from 'react';
import meow from 'meow';
import { isNodeVersionSupported, MIN_NODE_VERSION, detectPlatform } from './shared/platform.js';
import { App } from './ui/app.js';

const checkNodeVersion = (): void => {
  if (!isNodeVersionSupported()) {
    console.error(
      `\nNode.js ${MIN_NODE_VERSION} or later is required.\n` +
      `You are running ${process.version}.\n` +
      `Please update Node.js: https://nodejs.org\n`,
    );
    process.exit(1);
  }
};

const main = (): void => {
  checkNodeVersion();

  const cli = meow(
    `
    Usage
      $ ai-browser-copilot-setup

    Options
      --yes          Skip confirmation prompts
      --tools        Comma-separated list of AI tools to configure
      --update       Update existing installation
      --uninstall    Remove installation and configs
      --extension-id Chrome extension ID (for development)

    Examples
      $ ai-browser-copilot-setup
      $ ai-browser-copilot-setup --yes
      $ ai-browser-copilot-setup --tools vscode,cursor
      $ ai-browser-copilot-setup --update
      $ ai-browser-copilot-setup --uninstall
  `,
    {
      importMeta: import.meta,
      flags: {
        yes: { type: 'boolean', default: false },
        tools: { type: 'string' },
        update: { type: 'boolean', default: false },
        uninstall: { type: 'boolean', default: false },
        extensionId: { type: 'string' },
      },
    },
  );

  const platform = detectPlatform();

  render(React.createElement(App, { platform, flags: cli.flags }));
};

main();
