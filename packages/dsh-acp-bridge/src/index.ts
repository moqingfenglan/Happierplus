#!/usr/bin/env node
import { runBridge } from './bridge.js';
import { log } from './log.js';

try {
  runBridge();
} catch (error) {
  log('fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
