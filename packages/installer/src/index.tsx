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
      $ agenthub-setup

    Options
      --yes          Skip confirmation prompts
      --tools        Comma-separated list of AI tools to configure
      --update       Update existing installation
      --uninstall    Remove installation and configs
      --extension-id Chrome extension ID (for development)
      --from-local   Install from a local folder instead of GitHub releases.
                     Accepts either a folder containing the binaries directly
                     or the project root (looks in packages/*/bin/).

    Examples
      $ agenthub-setup
      $ agenthub-setup --yes
      $ agenthub-setup --tools vscode,cursor
      $ agenthub-setup --update
      $ agenthub-setup --uninstall
      $ agenthub-setup --from-local . --extension-id <id>
  `,
    {
      importMeta: import.meta,
      flags: {
        yes: { type: 'boolean', default: false },
        tools: { type: 'string' },
        update: { type: 'boolean', default: false },
        uninstall: { type: 'boolean', default: false },
        extensionId: { type: 'string' },
        fromLocal: { type: 'string' },
      },
    },
  );

  const platform = detectPlatform();

  render(React.createElement(App, { platform, flags: cli.flags }));
};

main();
