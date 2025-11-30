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
  // side_panel.js가 소스에 없으면 popup.js를 복사해서 생성
  const sidePanelSrc = resolve(projectRoot, 'side_panel.js');
  if (!existsSync(sidePanelSrc)) {
    const popupSrc = resolve(projectRoot, 'popup.js');
    if (existsSync(popupSrc)) {
      console.log(`[Build] side_panel.js가 없어서 popup.js를 복사하여 생성합니다.`);
      copyFileSync(popupSrc, sidePanelSrc);
    }
  }

  const files = [
    'manifest.json',
    'background.js',
    'devtools.html',
    'devtools.js',
    'panel.html',
    'panel.js',
    'popup.html',
    'popup.js',
    'side_panel.html',
    'side_panel.js',
    'style.css'
  ];

  files.forEach((file) => {
    const src = resolve(projectRoot, file);
    const dest = resolve(distDir, file);
    
    if (!existsSync(src)) {
      console.warn(`[Build] 경고: ${file} 파일을 찾을 수 없습니다.`);
      return;
    }
    
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

