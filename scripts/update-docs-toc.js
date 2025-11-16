#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const docsDir = path.join(repoRoot, 'docs');
const readmePath = path.join(repoRoot, 'README.md');

function collectDocs(dir, base = 'docs') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    const rel = path.posix.join(base, entry.name);
    if (entry.isDirectory()) {
      items.push(...collectDocs(full, rel));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      const content = fs.readFileSync(full, 'utf8');
      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : entry.name.replace(/\.md$/i, '');
      items.push({ title, rel });
    }
  }
  return items.sort((a, b) => a.title.localeCompare(b.title));
}

function generateList(items) {
  return items.map((i) => `- [${i.title}](${i.rel})`).join('\n');
}

function updateReadme(readme, list) {
  const start = '<!-- docs:start -->';
  const end = '<!-- docs:end -->';
  const block = `${start}\n${list}\n${end}`;
  if (readme.includes(start) && readme.includes(end)) {
    const regex = new RegExp(`${start}[\s\S]*?${end}`);
    return readme.replace(regex, block);
  }
  // If markers missing, append a new section
  return readme + `\n\n## 📚 Documentation\n\n${block}\n`;
}

function main() {
  if (!fs.existsSync(docsDir)) {
    console.error('No docs directory found, skipping.');
    process.exit(0);
  }
  const docs = collectDocs(docsDir);
  const list = generateList(docs);
  const readme = fs.readFileSync(readmePath, 'utf8');
  const updated = updateReadme(readme, list);
  if (updated !== readme) {
    fs.writeFileSync(readmePath, updated, 'utf8');
    console.log('README.md updated with docs TOC.');
  } else {
    console.log('README.md already up to date.');
  }
}

main();


