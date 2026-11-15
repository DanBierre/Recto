// The Explorer right-click entries, as reg.exe argument lists. Per user (HKCU), so no admin needed.
const KEYS = [
  ['*', 'Edit with Recto', '%1'],
  ['Directory', 'Open with Recto', '%1'],
  ['Directory\\Background', 'Open with Recto', '%V'],
];

function menuCommands(exe, on) {
  return KEYS.flatMap(([cls, label, arg]) => {
    const key = `HKCU\\Software\\Classes\\${cls}\\shell\\Recto`;
    if (!on) return [['delete', key, '/f']];
    return [
      ['add', key, '/ve', '/d', label, '/f'],
      ['add', key, '/v', 'Icon', '/d', exe, '/f'],
      ['add', `${key}\\command`, '/ve', '/d', `"${exe}" "${arg}"`, '/f'],
    ];
  });
}

module.exports = { menuCommands };
