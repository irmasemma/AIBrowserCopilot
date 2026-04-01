"use strict";

// src/lock-file-reader.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
function getLockDir() {
  switch ((0, import_node_os.platform)()) {
    case "win32":
      return (0, import_node_path.join)(process.env.LOCALAPPDATA ?? (0, import_node_path.join)((0, import_node_os.homedir)(), "AppData", "Local"), "ai-browser-copilot");
    case "darwin":
      return (0, import_node_path.join)((0, import_node_os.homedir)(), "Library", "Application Support", "ai-browser-copilot");
    default:
      return (0, import_node_path.join)((0, import_node_os.homedir)(), ".local", "share", "ai-browser-copilot");
  }
}
function getLockFilePath() {
  return (0, import_node_path.join)(getLockDir(), "server.lock");
}
function readLockFile(lockPath) {
  const filePath = lockPath ?? getLockFilePath();
  if (!(0, import_node_fs.existsSync)(filePath)) {
    return { exists: false };
  }
  try {
    const content = (0, import_node_fs.readFileSync)(filePath, "utf-8");
    const data = JSON.parse(content);
    return { exists: true, data };
  } catch {
    return { exists: false };
  }
}

// src/tool-scanner.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_os2 = require("node:os");
function appDataDir() {
  const plat = (0, import_node_os2.platform)();
  if (plat === "win32") return process.env.APPDATA ?? (0, import_node_path2.join)((0, import_node_os2.homedir)(), "AppData", "Roaming");
  if (plat === "darwin") return (0, import_node_path2.join)((0, import_node_os2.homedir)(), "Library", "Application Support");
  return (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".config");
}
function editorConfigPaths(appName) {
  return [(0, import_node_path2.join)(appDataDir(), appName, "User", "settings.json")];
}
function jetbrainsConfigPaths() {
  const base = appDataDir();
  const jbDir = (0, import_node_path2.join)(base, "JetBrains");
  if (!(0, import_node_fs2.existsSync)(jbDir)) return [(0, import_node_path2.join)(jbDir, "Unknown", "mcp.json")];
  try {
    const entries = (0, import_node_fs2.readdirSync)(jbDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (dirs.length === 0) return [(0, import_node_path2.join)(jbDir, "Unknown", "mcp.json")];
    return dirs.map((d) => (0, import_node_path2.join)(jbDir, d, "mcp.json"));
  } catch {
    return [(0, import_node_path2.join)(jbDir, "Unknown", "mcp.json")];
  }
}
var detectors = [
  {
    name: "Claude Desktop",
    slug: "claude-desktop",
    getConfigPaths() {
      const plat = (0, import_node_os2.platform)();
      if (plat === "win32") return [(0, import_node_path2.join)(process.env.APPDATA ?? (0, import_node_path2.join)((0, import_node_os2.homedir)(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")];
      if (plat === "darwin") return [(0, import_node_path2.join)((0, import_node_os2.homedir)(), "Library", "Application Support", "Claude", "claude_desktop_config.json")];
      return [(0, import_node_path2.join)((0, import_node_os2.homedir)(), ".config", "Claude", "claude_desktop_config.json")];
    },
    getMcpKeyPath() {
      return ["mcpServers"];
    }
  },
  {
    name: "Claude Code",
    slug: "claude-code",
    getConfigPaths() {
      return [(0, import_node_path2.join)((0, import_node_os2.homedir)(), ".claude.json")];
    },
    getMcpKeyPath() {
      return ["mcpServers"];
    }
  },
  {
    name: "VS Code",
    slug: "vscode",
    getConfigPaths() {
      return editorConfigPaths("Code");
    },
    getMcpKeyPath() {
      return ["mcp", "servers"];
    }
  },
  {
    name: "Cursor",
    slug: "cursor",
    getConfigPaths() {
      return editorConfigPaths("Cursor");
    },
    getMcpKeyPath() {
      return ["mcp", "servers"];
    }
  },
  {
    name: "Windsurf",
    slug: "windsurf",
    getConfigPaths() {
      return editorConfigPaths("Windsurf");
    },
    getMcpKeyPath() {
      return ["mcpServers"];
    }
  },
  {
    name: "JetBrains",
    slug: "jetbrains",
    getConfigPaths() {
      return jetbrainsConfigPaths();
    },
    getMcpKeyPath() {
      return ["mcpServers"];
    }
  },
  {
    name: "Zed",
    slug: "zed",
    getConfigPaths() {
      const plat = (0, import_node_os2.platform)();
      if (plat === "darwin") return [(0, import_node_path2.join)((0, import_node_os2.homedir)(), ".zed", "settings.json")];
      return [(0, import_node_path2.join)((0, import_node_os2.homedir)(), ".config", "zed", "settings.json")];
    },
    getMcpKeyPath() {
      return ["language_models", "mcp_servers"];
    }
  },
  {
    name: "Continue.dev",
    slug: "continue",
    getConfigPaths() {
      return [
        (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".continue", "config.json"),
        (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".continue", "config.yaml")
      ];
    },
    getMcpKeyPath() {
      return ["mcpServers"];
    }
  }
];
function resolveKeyPath(obj, keys) {
  let current = obj;
  for (const key of keys) {
    if (current === null || current === void 0 || typeof current !== "object") return void 0;
    current = current[key];
  }
  return current;
}
function hasCopilotEntry(mcpValue) {
  if (mcpValue === null || mcpValue === void 0) return false;
  if (Array.isArray(mcpValue)) {
    return mcpValue.some(
      (item) => typeof item === "object" && item !== null && ("ai-browser-copilot" in item || item.name === "ai-browser-copilot")
    );
  }
  if (typeof mcpValue === "object") {
    return "ai-browser-copilot" in mcpValue;
  }
  return false;
}
function scanDetector(detector) {
  const paths = detector.getConfigPaths();
  for (const configPath of paths) {
    if (!(0, import_node_fs2.existsSync)(configPath)) continue;
    try {
      const content = (0, import_node_fs2.readFileSync)(configPath, "utf-8");
      const parsed = JSON.parse(content);
      const mcpValue = resolveKeyPath(parsed, detector.getMcpKeyPath());
      const configured = hasCopilotEntry(mcpValue);
      return { tool: detector.name, slug: detector.slug, installed: true, configured, configPath };
    } catch {
      return { tool: detector.name, slug: detector.slug, installed: true, configured: false, configPath };
    }
  }
  return { tool: detector.name, slug: detector.slug, installed: false, configured: false, configPath: paths[0] };
}
function scanAITools() {
  return detectors.map(scanDetector);
}

// src/index.ts
function readMessage() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let lengthRead = false;
    let messageLength = 0;
    let bytesRead = 0;
    process.stdin.on("readable", () => {
      if (!lengthRead) {
        const header = process.stdin.read(4);
        if (!header) return;
        messageLength = header.readUInt32LE(0);
        lengthRead = true;
      }
      const remaining = messageLength - bytesRead;
      if (remaining <= 0) return;
      const chunk = process.stdin.read(remaining);
      if (chunk) {
        chunks.push(chunk);
        bytesRead += chunk.length;
        if (bytesRead >= messageLength) {
          const json = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve(JSON.parse(json));
          } catch (err) {
            reject(new Error(`Invalid JSON: ${err}`));
          }
        }
      }
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => {
      if (!lengthRead || bytesRead < messageLength) {
        reject(new Error("stdin closed before full message was read"));
      }
    });
  });
}
function writeMessage(data) {
  const json = JSON.stringify(data);
  const buffer = Buffer.from(json, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}
async function main() {
  try {
    const message = await readMessage();
    const action = message.action;
    switch (action) {
      case "read_lock_file": {
        const result = readLockFile();
        if (result.exists) {
          writeMessage({ exists: true, ...result.data });
        } else {
          writeMessage({ exists: false });
        }
        break;
      }
      case "scan_ai_tools": {
        const tools = scanAITools();
        writeMessage({ tools });
        break;
      }
      default:
        writeMessage({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    writeMessage({ error: String(err) });
  }
  process.exit(0);
}
main();
