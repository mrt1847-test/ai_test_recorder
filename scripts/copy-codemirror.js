const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = [
  ['node_modules/codemirror/lib/codemirror.js', 'vendor/codemirror/codemirror.js'],
  ['node_modules/codemirror/lib/codemirror.css', 'vendor/codemirror/codemirror.css'],
  ['node_modules/codemirror/addon/edit/matchbrackets.js', 'vendor/codemirror/matchbrackets.js'],
  ['node_modules/codemirror/mode/javascript/javascript.js', 'vendor/codemirror/javascript.js'],
  ['node_modules/codemirror/mode/python/python.js', 'vendor/codemirror/python.js'],
  ['node_modules/codemirror/theme/eclipse.css', 'vendor/codemirror/eclipse.css'],
];

for (const [srcRel, destRel] of targets) {
  const src = path.resolve(root, srcRel);
  const dest = path.resolve(root, destRel);
  const dir = path.dirname(dest);
  if (!fs.existsSync(src)) {
    console.error(`Missing source: ${srcRel}`);
    process.exitCode = 1;
    continue;
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`Copied ${srcRel} -> ${destRel}`);
}