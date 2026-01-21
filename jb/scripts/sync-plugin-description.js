#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const readmePath = path.join(rootDir, 'README.md');
const pluginXmlPath = path.join(
  rootDir,
  'jb',
  'src',
  'main',
  'resources',
  'META-INF',
  'plugin.xml',
);

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '');
}

function slugify(value) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '-');
  return normalized.replace(/[^\p{L}\p{N}-]+/gu, '');
}

function addHeadingIds(html) {
  return html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (match, level, attrs, inner) => {
    if (/\bid=/.test(attrs)) {
      return match;
    }
    const text = stripTags(inner);
    const slug = slugify(text);
    if (!slug) {
      return match;
    }
    const normalizedAttrs = attrs.trim();
    const attrText = normalizedAttrs ? ` ${normalizedAttrs}` : '';
    return `<h${level}${attrText} id="${slug}">${inner}</h${level}>`;
  });
}

function stripImages(html) {
  return html.replace(/<img\b[^>]*>/gi, '');
}

function renderMarkdown(markdown) {
  try {
    // eslint-disable-next-line global-require
    const MarkdownIt = require('markdown-it');
    const md = new MarkdownIt({ html: true, linkify: true });
    return md.render(markdown);
  } catch (error) {
    console.warn('[BabelMarkdown] markdown-it not available, using <pre> fallback.');
    return `<pre>${escapeHtml(markdown)}</pre>\n`;
  }
}

function replaceIdeMentions(markdown) {
  const ideaLabel = '\u60a8\u7684 IDEA';
  return markdown
    .replace(/Visual Studio Code/gi, ideaLabel)
    .replace(/VS\s*Code/gi, ideaLabel);
}

function main() {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const normalizedMarkdown = replaceIdeMentions(readme);
  let html = renderMarkdown(normalizedMarkdown);
  html = addHeadingIds(html);
  html = stripImages(html);
  const descriptionPrefix =
    'Babel Markdown is a translation preview tool for Markdown documents.';
  const descriptionBody = `${descriptionPrefix}\n${html.trim()}`;

  if (descriptionBody.includes(']]>')) {
    throw new Error('README render contains "]]>", which breaks CDATA.');
  }

  const pluginXml = fs.readFileSync(pluginXmlPath, 'utf8');
  const descriptionRegex = /(^\s*)<description><!\[CDATA\[[\s\S]*?\]\]><\/description>/m;

  if (!descriptionRegex.test(pluginXml)) {
    throw new Error('Unable to locate <description><![CDATA[...]]></description> in plugin.xml.');
  }

  const updated = pluginXml.replace(descriptionRegex, (_, indent) => {
    const trimmed = descriptionBody.trimEnd();
    return `${indent}<description><![CDATA[\n${trimmed}\n${indent}]]></description>`;
  });

  if (updated !== pluginXml) {
    fs.writeFileSync(pluginXmlPath, updated);
    console.log('[BabelMarkdown] Synced plugin description from README.md.');
  } else {
    console.log('[BabelMarkdown] Plugin description already up to date.');
  }
}

try {
  main();
} catch (error) {
  console.error(`[BabelMarkdown] ${error.message}`);
  process.exit(1);
}
