"use strict";

// src/tool-scanner.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_os = require("node:os");
function appDataDir() {
  const plat = (0, import_node_os.platform)();
  if (plat === "win32") return process.env.APPDATA ?? (0, import_node_path.join)((0, import_node_os.homedir)(), "AppData", "Roaming");
  if (plat === "darwin") return (0, import_node_path.join)((0, import_node_os.homedir)(), "Library", "Application Support");
  return (0, import_node_path.join)((0, import_node_os.homedir)(), ".config");
}
function editorConfigPaths(appName) {
  return [(0, import_node_path.join)(appDataDir(), appName, "User", "settings.json")];
}
function jetbrainsConfigPaths() {
  const base = appDataDir();
  const jbDir = (0, import_node_path.join)(base, "JetBrains");
  if (!(0, import_node_fs.existsSync)(jbDir)) return [(0, import_node_path.join)(jbDir, "Unknown", "mcp.json")];
  try {
    const entries = (0, import_node_fs.readdirSync)(jbDir, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (dirs.length === 0) return [(0, import_node_path.join)(jbDir, "Unknown", "mcp.json")];
    return dirs.map((d) => (0, import_node_path.join)(jbDir, d, "mcp.json"));
  } catch {
    return [(0, import_node_path.join)(jbDir, "Unknown", "mcp.json")];
  }
}
var detectors = [
  {
    name: "Claude Desktop",
    slug: "claude-desktop",
    getConfigPaths() {
      const plat = (0, import_node_os.platform)();
      if (plat === "win32") return [(0, import_node_path.join)(process.env.APPDATA ?? (0, import_node_path.join)((0, import_node_os.homedir)(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json")];
      if (plat === "darwin") return [(0, import_node_path.join)((0, import_node_os.homedir)(), "Library", "Application Support", "Claude", "claude_desktop_config.json")];
      return [(0, import_node_path.join)((0, import_node_os.homedir)(), ".config", "Claude", "claude_desktop_config.json")];
    },
    getMcpKeyPath() {
      return ["mcpServers"];
    }
  },
  {
    name: "Claude Code",
    slug: "claude-code",
    getConfigPaths() {
      return [(0, import_node_path.join)((0, import_node_os.homedir)(), ".claude.json")];
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
      const plat = (0, import_node_os.platform)();
      if (plat === "darwin") return [(0, import_node_path.join)((0, import_node_os.homedir)(), ".zed", "settings.json")];
      return [(0, import_node_path.join)((0, import_node_os.homedir)(), ".config", "zed", "settings.json")];
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
        (0, import_node_path.join)((0, import_node_os.homedir)(), ".continue", "config.json"),
        (0, import_node_path.join)((0, import_node_os.homedir)(), ".continue", "config.yaml")
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
    if (!(0, import_node_fs.existsSync)(configPath)) continue;
    try {
      const content = (0, import_node_fs.readFileSync)(configPath, "utf-8");
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

// src/mcp-registrar.ts
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_os2 = require("node:os");
var getClaudeCodeConfigPath = () => (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".claude.json");
var getInstallDir = () => {
  switch ((0, import_node_os2.platform)()) {
    case "win32":
      return (0, import_node_path2.join)(process.env.LOCALAPPDATA ?? (0, import_node_path2.join)((0, import_node_os2.homedir)(), "AppData", "Local"), "ai-browser-copilot");
    case "darwin":
      return (0, import_node_path2.join)((0, import_node_os2.homedir)(), "Library", "Application Support", "ai-browser-copilot");
    default:
      return (0, import_node_path2.join)((0, import_node_os2.homedir)(), ".local", "share", "ai-browser-copilot");
  }
};
var getNativeHostBinaryName = () => {
  const arch = (0, import_node_os2.arch)();
  switch ((0, import_node_os2.platform)()) {
    case "win32":
      return `ai-browser-copilot-win-${arch === "arm64" ? "arm64" : "x64"}.exe`;
    case "darwin":
      return `ai-browser-copilot-macos-${arch === "arm64" ? "arm64" : "x64"}`;
    default:
      return `ai-browser-copilot-linux-${arch === "arm64" ? "arm64" : "x64"}`;
  }
};
var getNativeHostBinaryPath = () => (0, import_node_path2.join)(getInstallDir(), getNativeHostBinaryName());
var isPlainObject = (val) => typeof val === "object" && val !== null && !Array.isArray(val);
var detectIndent = (content) => {
  for (const line of content.split("\n")) {
    const m = line.match(/^(\s+)/);
    if (m) return m[1].includes("	") ? "	" : " ".repeat(m[1].length);
  }
  return "  ";
};
var hasEntry = (mcpServers) => {
  if (!isPlainObject(mcpServers)) return false;
  const entry = mcpServers["ai-browser-copilot"];
  return isPlainObject(entry) && typeof entry.command === "string";
};
var checkClaudeCodeRegistration = () => {
  const configPath = getClaudeCodeConfigPath();
  const binaryPath = getNativeHostBinaryPath();
  const binaryExists = (0, import_node_fs2.existsSync)(binaryPath);
  if (!(0, import_node_fs2.existsSync)(configPath)) {
    return { configExists: false, configPath, registered: false, scope: null, binaryPath, binaryExists };
  }
  let parsed;
  try {
    parsed = JSON.parse((0, import_node_fs2.readFileSync)(configPath, "utf-8"));
  } catch {
    return { configExists: true, configPath, registered: false, scope: null, binaryPath, binaryExists };
  }
  if (!isPlainObject(parsed)) {
    return { configExists: true, configPath, registered: false, scope: null, binaryPath, binaryExists };
  }
  if (hasEntry(parsed.mcpServers)) {
    return { configExists: true, configPath, registered: true, scope: "user", binaryPath, binaryExists };
  }
  const projects = parsed.projects;
  if (isPlainObject(projects)) {
    for (const proj of Object.values(projects)) {
      if (isPlainObject(proj) && hasEntry(proj.mcpServers)) {
        return { configExists: true, configPath, registered: true, scope: "project", binaryPath, binaryExists };
      }
    }
  }
  return { configExists: true, configPath, registered: false, scope: null, binaryPath, binaryExists };
};
var buildBackupPath = (filePath) => {
  const now = /* @__PURE__ */ new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `${filePath}.backup-${stamp}`;
};
var repairClaudeCodeRegistration = () => {
  const configPath = getClaudeCodeConfigPath();
  const binaryPath = getNativeHostBinaryPath();
  if (!(0, import_node_fs2.existsSync)(binaryPath)) {
    return {
      success: false,
      configPath,
      binaryPath,
      scope: "user",
      error: `Native host binary not found at ${binaryPath}. Run the installer to download it.`
    };
  }
  const newEntry = {
    command: binaryPath,
    args: []
  };
  let existing = {};
  let raw = "";
  let indentStr = "  ";
  let trailingNewline = true;
  let backupPath;
  if ((0, import_node_fs2.existsSync)(configPath)) {
    raw = (0, import_node_fs2.readFileSync)(configPath, "utf-8");
    try {
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) {
        return {
          success: false,
          configPath,
          binaryPath,
          scope: "user",
          error: "Existing config is not a JSON object \u2014 refusing to overwrite."
        };
      }
      existing = parsed;
    } catch (err) {
      return {
        success: false,
        configPath,
        binaryPath,
        scope: "user",
        error: `Existing config is not valid JSON \u2014 refusing to overwrite. ${String(err)}`
      };
    }
    indentStr = detectIndent(raw);
    trailingNewline = raw.endsWith("\n");
    backupPath = buildBackupPath(configPath);
    (0, import_node_fs2.copyFileSync)(configPath, backupPath);
  }
  const mcpServers = isPlainObject(existing.mcpServers) ? { ...existing.mcpServers } : {};
  mcpServers["ai-browser-copilot"] = newEntry;
  const merged = { ...existing, mcpServers };
  let output = JSON.stringify(merged, null, indentStr);
  if (trailingNewline) output += "\n";
  const tmp = `${configPath}.tmp`;
  (0, import_node_fs2.writeFileSync)(tmp, output, "utf-8");
  (0, import_node_fs2.renameSync)(tmp, configPath);
  const verify = checkClaudeCodeRegistration();
  if (!verify.registered || verify.scope !== "user") {
    return {
      success: false,
      configPath,
      binaryPath,
      scope: "user",
      backupPath,
      error: "Wrote config but post-write verification could not find the entry at user scope."
    };
  }
  return { success: true, configPath, binaryPath, scope: "user", backupPath };
};

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
      case "scan_ai_tools": {
        const tools = scanAITools();
        writeMessage({ tools });
        break;
      }
      case "check_mcp_registration": {
        const result = checkClaudeCodeRegistration();
        writeMessage(result);
        break;
      }
      case "repair_mcp_registration": {
        const result = repairClaudeCodeRegistration();
        writeMessage(result);
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
