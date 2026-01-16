#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const promptsPath = path.join(rootDir, 'prompts.json');
const promptsTsPath = path.join(rootDir, 'src', 'constants', 'prompts.ts');
const packageJsonPath = path.join(rootDir, 'package.json');
const jbSettingsPath = path.join(
  rootDir,
  'jb',
  'src',
  'main',
  'kotlin',
  'com',
  'babelmarkdown',
  'aikilan',
  'settings',
  'BabelMarkdownSettings.kt',
);

function readPrompts() {
  const raw = fs.readFileSync(promptsPath, 'utf8');
  const json = JSON.parse(raw);
  if (!json || typeof json.defaultTranslationPrompt !== 'string' || json.defaultTranslationPrompt.trim() === '') {
    throw new Error('prompts.json missing "defaultTranslationPrompt" string.');
  }
  return json.defaultTranslationPrompt;
}

function escapeTemplateLiteral(value) {
  return value.replace(/`/g, '\\`');
}

function escapeKotlinString(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$');
}

function updatePromptsTs(prompt) {
  const content = fs.readFileSync(promptsTsPath, 'utf8');
  const pattern = /DEFAULT_TRANSLATION_PROMPT\s*=\s*`[\s\S]*?`/;
  if (!pattern.test(content)) {
    throw new Error('Failed to locate DEFAULT_TRANSLATION_PROMPT in prompts.ts.');
  }
  const updated = content.replace(
    pattern,
    `DEFAULT_TRANSLATION_PROMPT = \`${escapeTemplateLiteral(prompt)}\``,
  );
  fs.writeFileSync(promptsTsPath, updated);
}

function updatePackageJson(prompt) {
  const raw = fs.readFileSync(packageJsonPath, 'utf8');
  const json = JSON.parse(raw);
  const properties =
    json?.contributes?.configuration?.properties || {};
  if (!properties['babelMdViewer.translation.promptTemplate']) {
    throw new Error('Failed to locate babelMdViewer.translation.promptTemplate in package.json.');
  }
  properties['babelMdViewer.translation.promptTemplate'].default = prompt;
  fs.writeFileSync(packageJsonPath, `${JSON.stringify(json, null, 2)}\n`);
}

function updateJbSettings(prompt) {
  const content = fs.readFileSync(jbSettingsPath, 'utf8');
  const pattern = /(const\s+val\s+DEFAULT_TRANSLATION_PROMPT\s*=\s*)"(?:[^"\\]|\\.)*"/s;
  if (!pattern.test(content)) {
    throw new Error('Failed to locate DEFAULT_TRANSLATION_PROMPT in BabelMarkdownSettings.kt.');
  }
  const updated = content.replace(
    pattern,
    `$1\"${escapeKotlinString(prompt)}\"`,
  );
  fs.writeFileSync(jbSettingsPath, updated);
}

function main() {
  const prompt = readPrompts();
  updatePromptsTs(prompt);
  updatePackageJson(prompt);
  updateJbSettings(prompt);
  console.log('[BabelMarkdown] Synced prompts to VS Code and JB settings.');
}

try {
  main();
} catch (error) {
  console.error(`[BabelMarkdown] ${error.message}`);
  process.exit(1);
}
