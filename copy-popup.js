const fs = require('fs');
const path = require('path');

const projectRoot = __dirname;
const distDir = path.join(projectRoot, 'dist');

// popup.js 복사
const popupJsSrc = path.join(projectRoot, 'popup.js');
const popupJsDest = path.join(distDir, 'popup.js');

if (fs.existsSync(popupJsSrc)) {
  fs.copyFileSync(popupJsSrc, popupJsDest);
  console.log('popup.js copied to dist/');
} else {
  console.error('popup.js not found in project root');
  process.exit(1);
}

