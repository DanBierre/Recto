// Render assets/icon.svg (a pen nib on a paper tile) to assets/icon.png. Run: npx electron scripts/icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 512;
const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), 'utf8');
// The tile fills 440 of the 512 pixels, so the icon keeps a little air around it like other Windows icons.
const html = `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${SIZE}px;height:${SIZE}px;display:grid;place-items:center">
  <div style="width:440px;height:440px">${svg.replace('<svg ', '<svg width="440" height="440" ')}</div>
</div></body></html>`;

app.whenReady().then(async () => {
  // Offscreen rendering, so nothing flashes on screen and capture works without a visible window.
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: true } });
  let img = null;
  win.webContents.on('paint', (_e, _dirty, image) => { img = image; });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise(r => setTimeout(r, 600));
  if (!img) { console.error('No frame painted'); app.exit(1); return; }
  fs.mkdirSync(path.join(__dirname, '..', 'assets'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.png'), img.resize({ width: SIZE, height: SIZE }).toPNG());
  app.quit();
});
