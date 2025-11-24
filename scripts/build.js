import { build } from 'esbuild';
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const distDir = resolve(projectRoot, 'dist');

function ensureCleanDist() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
}

function copyStaticAssets() {
  const files = [
    'manifest.json',
    'background.js',
    'devtools.html',
    'devtools.js',
    'panel.html',
    'panel.js',
    'popup.html',
    'popup.js',
    'style.css'
  ];

  files.forEach((file) => {
    const src = resolve(projectRoot, file);
    const dest = resolve(distDir, file);
    copyFileSync(src, dest);
  });

  const iconsSrc = resolve(projectRoot, 'icons');
  if (existsSync(iconsSrc)) {
    cpSync(iconsSrc, resolve(distDir, 'icons'), { recursive: true });
  }

  const vendorSrc = resolve(projectRoot, 'vendor');
  if (existsSync(vendorSrc)) {
    cpSync(vendorSrc, resolve(distDir, 'vendor'), { recursive: true });
  }
}

async function buildContentScript() {
  ensureCleanDist();

  const entryPoint = resolve(projectRoot, 'src/content/index.js');
  const outFile = resolve(distDir, 'content.js');

  await build({
    entryPoints: [entryPoint],
    bundle: true,
    outfile: outFile,
    format: 'iife',
    target: ['chrome100'],
    sourcemap: true,
    logLevel: 'info'
  });

  copyStaticAssets();
}

buildContentScript().catch((error) => {
  console.error(error);
  process.exit(1);
});

