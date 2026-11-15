// Wraps electron-builder's installer in Recto's own setup window (build/setup.cs).
// The plain installer moves to release/plain/; the custom one takes its name in release/.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const { productName, version } = require(path.join(root, 'package.json'));
const release = path.join(root, 'release');
const plain = path.join(release, 'plain');
const name = `${productName} Setup ${version}.exe`;

const size = dir => fs.readdirSync(dir, { withFileTypes: true })
  .reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);

fs.mkdirSync(plain, { recursive: true });
fs.renameSync(path.join(release, name), path.join(plain, name));
fs.writeFileSync(path.join(plain, 'size.txt'), String(size(path.join(release, 'win-unpacked'))));

const csc = path.join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, [
  '/nologo', '/target:winexe', '/optimize',
  `/out:${path.join(release, name)}`,
  `/win32icon:${path.join(root, 'assets', 'icon.ico')}`,
  `/win32manifest:${path.join(__dirname, 'setup.manifest')}`,
  `/resource:${path.join(plain, name)},payload.exe`,
  `/resource:${path.join(plain, 'size.txt')},size.txt`,
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  path.join(__dirname, 'setup.cs'),
], { stdio: 'inherit' });
console.log(`custom setup: release/${name}`);
