import { readLockFile } from './lock-file-reader.js';
import { scanAITools } from './tool-scanner.js';

// Chrome Native Messaging protocol: 4-byte LE length prefix + JSON

function readMessage(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let lengthRead = false;
    let messageLength = 0;
    let bytesRead = 0;

    process.stdin.on('readable', () => {
      if (!lengthRead) {
        const header = process.stdin.read(4) as Buffer | null;
        if (!header) return;
        messageLength = header.readUInt32LE(0);
        lengthRead = true;
      }

      const remaining = messageLength - bytesRead;
      if (remaining <= 0) return;

      const chunk = process.stdin.read(remaining) as Buffer | null;
      if (chunk) {
        chunks.push(chunk);
        bytesRead += chunk.length;
        if (bytesRead >= messageLength) {
          const json = Buffer.concat(chunks).toString('utf-8');
          try {
            resolve(JSON.parse(json));
          } catch (err) {
            reject(new Error(`Invalid JSON: ${err}`));
          }
        }
      }
    });

    process.stdin.on('error', reject);
    process.stdin.on('end', () => {
      if (!lengthRead || bytesRead < messageLength) {
        reject(new Error('stdin closed before full message was read'));
      }
    });
  });
}

function writeMessage(data: unknown): void {
  const json = JSON.stringify(data);
  const buffer = Buffer.from(json, 'utf-8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buffer.length, 0);
  process.stdout.write(header);
  process.stdout.write(buffer);
}

async function main(): Promise<void> {
  try {
    const message = await readMessage();
    const action = message.action as string;

    switch (action) {
      case 'read_lock_file': {
        const result = readLockFile();
        if (result.exists) {
          writeMessage({ exists: true, ...result.data });
        } else {
          writeMessage({ exists: false });
        }
        break;
      }

      case 'scan_ai_tools': {
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
