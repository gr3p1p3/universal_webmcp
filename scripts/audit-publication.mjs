/* global console */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import process from 'node:process';

const forbiddenPaths = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)\.idea\//,
  /(^|\/)\.vscode\//,
  /(^|\/)graphify-out\//,
  /(^|\/)docs\//,
  /(^|\/)ELI5\.md$/i,
  /(^|\/)\.npmrc$/,
  /\.(?:pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)(?:credentials|service-account[^/]*)\.json$/i,
  /\.(?:private|internal)\.md$/i,
];

const secretSignatures = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['OpenAI-style secret key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['npm token', /\bnpm_[A-Za-z0-9]{20,}\b/],
  ['local macOS path', /\/Users\/[^/\s]+(?:\/|$)/],
  ['local Linux path', /\/home\/[^/\s]+(?:\/|$)/],
  ['local Windows path', /[A-Z]:\\Users\\[^\\\s]+(?:\\|$)/i],
];

const textExtensions = new Set([
  '',
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
]);

const output = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
);
const files = output.split('\0').filter(Boolean);
const findings = [];

for (const file of files) {
  if (!existsSync(file)) continue;

  if (forbiddenPaths.some((pattern) => pattern.test(file))) {
    findings.push(`${file}: forbidden publication path`);
    continue;
  }

  // This file necessarily contains the signatures it checks for.
  if (file === 'scripts/audit-publication.mjs') continue;

  const stats = statSync(file);
  if (!stats.isFile() || stats.size > 5_000_000 || !textExtensions.has(extname(file).toLowerCase())) {
    continue;
  }

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const [label, pattern] of secretSignatures) {
      if (pattern.test(line)) {
        findings.push(`${file}:${index + 1}: ${label}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error('Publication audit failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  console.error('Only rule names are shown; inspect the listed lines locally.');
  process.exit(1);
}

console.log(`Publication audit passed (${files.length} candidate files checked).`);
