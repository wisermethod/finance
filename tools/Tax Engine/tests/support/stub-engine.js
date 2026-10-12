#!/usr/bin/env node
/**
 * Test double for the engine's stdio server. Not shipped behaviour.
 * Reads stub-config.json beside this file and writes received.json there:
 * the argv, execArgv, and environment this process actually received.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, 'stub-config.json');
if (!existsSync(configPath)) {
  process.stderr.write('stub-engine: no stub-config.json beside this script\n');
  process.exit(2);
}

const config = JSON.parse(readFileSync(configPath, 'utf8'));
const reportPath = join(here, 'received.json');
const report = {
  argv: process.argv.slice(1),
  execArgv: process.execArgv,
  env: process.env,
  methods: []
};
writeFileSync(reportPath, `${JSON.stringify(report)}\n`);

if (config.mode === 'crash') process.exit(1);

function textResult(id, text, isError) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      content: [{ type: 'text', text }],
      isError: Boolean(isError)
    }
  };
}

function responseFor(id) {
  if (config.mode === 'ok') return textResult(id, JSON.stringify(config.result), false);
  if (config.mode === 'needs-facts') {
    return textResult(id, JSON.stringify({
      ok: false,
      error: {
        code: 'NEEDS_FACTS',
        message: 'cannot evaluate: missing fact(s): filingStatus',
        data: {
          missing: [{
            factId: 'filingStatus',
            type: 'enum',
            enumValues: ['single', 'mfj', 'mfs', 'hoh', 'qss'],
            description: 'Filing status.'
          }]
        }
      }
    }), true);
  }
  if (config.mode === 'no-rule') {
    return textResult(id, JSON.stringify({
      ok: false,
      error: {
        code: 'NO_APPLICABLE_RULE',
        message: 'no applicable rule "us.federal.net_tax" as of 2023-12-31 (known versions: v2 [2025-01-01, open))',
        data: {
          ruleId: 'us.federal.net_tax',
          asOf: '2023-12-31'
        }
      }
    }), true);
  }
  if (config.mode === 'schema-text') {
    const text = [
      'MCP error -32602: Input validation error: Invalid arguments for tool calculate_tax: [',
      '  {',
      '    "code": "unrecognized_keys",',
      '    "keys": ["notARealFact"],',
      '    "path": ["income"],',
      '    "message": "Unrecognized key(s) in object: \'notARealFact\'"',
      '  }',
      ']'
    ].join('\n');
    return textResult(id, text, true);
  }
  if (config.mode === 'schema-rpc') {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32602,
        message: "Invalid arguments: unrecognized key 'notARealFact'",
        data: {
          keys: ['notARealFact'],
          path: ['income']
        }
      }
    };
  }
  return null;
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).replace(/\r$/, '');
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method) {
      report.methods.push(msg.method);
      if (msg.method === 'tools/call') report.call = msg;
      writeFileSync(reportPath, `${JSON.stringify(report)}\n`);
    }
    if (config.mode === 'hang') continue;
    if (msg.id === undefined) continue;
    if (msg.method === 'initialize') {
      process.stdout.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'opentax', version: '0.1.0' }
        }
      })}\n`);
      continue;
    }
    if (msg.method === 'tools/call') {
      if (config.mode === 'garbage') {
        process.stdout.write('this is not json\n');
        continue;
      }
      const body = responseFor(msg.id);
      if (body) process.stdout.write(`${JSON.stringify(body)}\n`);
    }
  }
});
