/* global console */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
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

const expectedLicense = 'AGPL-3.0-only';
const packageManifest = JSON.parse(readFileSync('package.json', 'utf8'));
const lockManifest = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const lockRoot = lockManifest.packages?.[''];

if (packageManifest.license !== expectedLicense) {
  findings.push(`package.json: expected license ${expectedLicense}`);
}
if (lockRoot?.license !== packageManifest.license) {
  findings.push('package-lock.json: root license does not match package.json');
}
if (lockManifest.version !== packageManifest.version || lockRoot?.version !== packageManifest.version) {
  findings.push('package-lock.json: root version does not match package.json');
}

const packageFiles = new Set(packageManifest.files ?? []);
const expectedPackageFiles = ['dist/*.js', 'dist/*.d.ts', 'NOTICE'];
for (const requiredFile of expectedPackageFiles) {
  if (!packageFiles.has(requiredFile)) {
    findings.push(`package.json: files must include ${requiredFile}`);
  }
}
for (const packageFile of packageFiles) {
  if (!expectedPackageFiles.includes(packageFile)) {
    findings.push(`package.json: unexpected publication path ${packageFile}`);
  }
}

const licenseText = readFileSync('LICENSE', 'utf8');
if (!licenseText.includes('GNU AFFERO GENERAL PUBLIC LICENSE')
  || !licenseText.includes('Version 3, 19 November 2007')
  || !licenseText.includes('END OF TERMS AND CONDITIONS')) {
  findings.push('LICENSE: canonical AGPLv3 markers are missing');
}

const noticeText = readFileSync('NOTICE', 'utf8');
if (!noticeText.includes(`SPDX: ${expectedLicense}`)) {
  findings.push(`NOTICE: expected SPDX identifier ${expectedLicense}`);
}
const expectedSourceUrl = `https://github.com/gr3p1p3/universal_webmcp/tree/v${packageManifest.version}`;
if (!noticeText.includes(expectedSourceUrl)) {
  findings.push(`NOTICE: expected versioned source URL ${expectedSourceUrl}`);
}

const packOutput = execFileSync(
  'npm',
  ['pack', '--dry-run', '--json', '--ignore-scripts'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: join(tmpdir(), 'universal-webmcp-npm-cache'),
    },
  },
);
const [packResult] = JSON.parse(packOutput);
const requiredPackedFiles = [
  'LICENSE',
  'NOTICE',
  'README.md',
  'dist/browser.d.ts',
  'dist/browser.iife.js',
  'dist/browser.js',
  'dist/index.d.ts',
  'dist/index.js',
  'package.json',
];
const packedFiles = new Set(packResult?.files?.map(({ path }) => path) ?? []);
for (const requiredFile of requiredPackedFiles) {
  if (!packedFiles.has(requiredFile)) {
    findings.push(`npm pack: missing required file ${requiredFile}`);
  }
}
for (const packedFile of packedFiles) {
  const isExpected = requiredPackedFiles.includes(packedFile)
    || /^dist\/chunk-[A-Za-z0-9_-]+\.js$/.test(packedFile);
  if (!isExpected) findings.push(`npm pack: unexpected file ${packedFile}`);
  if (packedFile.endsWith('.js')
    && !readFileSync(packedFile, 'utf8').includes(`SPDX-License-Identifier: ${expectedLicense}`)) {
    findings.push(`npm pack: missing ${expectedLicense} banner in ${packedFile}`);
  }
}

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

console.log(
  `Publication audit passed (${files.length} candidates; ${packedFiles.size} package files; ${packResult.size} bytes).`,
);
