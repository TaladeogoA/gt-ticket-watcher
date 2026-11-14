import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const logFile = path.join(config.dataDir, 'watcher.log');

function write(level: string, message: string): void {
  const line = `${new Date().toISOString()} ${level} ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.appendFileSync(logFile, line + '\n');
  } catch {
    // Logging must never crash the watcher.
  }
}

export const log = {
  info: (m: string) => write('INFO ', m),
  warn: (m: string) => write('WARN ', m),
  error: (m: string) => write('ERROR', m),
};
