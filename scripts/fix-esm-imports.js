#!/usr/bin/env node
/**
 * Fix ESM imports by adding .js extensions to relative imports
 * This is needed because TypeScript doesn't add extensions when compiling to ESM
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

// Check if a path is a directory (has index.js)
function isDirectory(filePath, importPath) {
  const currentDir = dirname(filePath);
  const targetPath = join(currentDir, importPath);
  const indexPath = join(targetPath, 'index.js');
  return existsSync(targetPath) && existsSync(indexPath);
}

// Fix a single import path
function fixPath(filePath, importPath) {
  // Skip if already has .js, .mjs, .cjs, .json extension
  if (/\.(js|mjs|cjs|json)$/i.test(importPath)) {
    return importPath;
  }
  // Check if it's a directory import
  if (isDirectory(filePath, importPath)) {
    return `${importPath}/index.js`;
  }
  return `${importPath}.js`;
}

async function fixImports(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      await fixImports(fullPath);
    } else if (entry.name.endsWith('.js')) {
      let content = await readFile(fullPath, 'utf-8');
      let modified = false;

      // Fix: from './something' or from "../something"
      content = content.replace(
        /from\s+(['"])(\.\.?\/[^'"]+)\1/g,
        (match, quote, path) => {
          const fixed = fixPath(fullPath, path);
          if (fixed !== path) {
            modified = true;
            return `from ${quote}${fixed}${quote}`;
          }
          return match;
        }
      );

      // Fix: export ... from './something'
      content = content.replace(
        /export\s+(.+?)\s+from\s+(['"])(\.\.?\/[^'"]+)\2/g,
        (match, exported, quote, path) => {
          const fixed = fixPath(fullPath, path);
          if (fixed !== path) {
            modified = true;
            return `export ${exported} from ${quote}${fixed}${quote}`;
          }
          return match;
        }
      );

      if (modified) {
        await writeFile(fullPath, content);
        console.log(`Fixed: ${fullPath}`);
      }
    }
  }
}

fixImports(distDir)
  .then(() => console.log('ESM imports fixed'))
  .catch(err => {
    console.error('Error fixing imports:', err);
    process.exit(1);
  });
