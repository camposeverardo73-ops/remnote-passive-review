import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!manifest.repoUrl || !/^https:\/\/github\.com\//i.test(manifest.repoUrl)) {
  errors.push('manifest.repoUrl must be a real GitHub repository URL before marketplace submission');
}
if (manifest.requestNative !== false) errors.push('requestNative must remain false for this sandboxed release');
if (manifest.enableOnMobile !== true) errors.push('enableOnMobile must be true for the mobile RC');

const pdfVersion = pkg.dependencies?.['pdfjs-dist'];
function versionTuple(v) {
  const m = String(v ?? '').match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m.slice(1).map(Number) : null;
}
function lt(a,b) {
  for (let i=0;i<3;i++) { if (a[i] !== b[i]) return a[i] < b[i]; }
  return false;
}
const pdfTuple = versionTuple(pdfVersion);
if (!pdfTuple || lt(pdfTuple, [4,2,67])) {
  errors.push(`pdfjs-dist ${pdfVersion ?? 'missing'} is below the security floor 4.2.67; upgrade lockfile and re-run build`);
}

const screenshots = path.join(root, 'marketplace-screenshots');
if (!fs.existsSync(screenshots)) {
  errors.push('marketplace-screenshots/ is missing; add clean real screenshots before submission');
} else {
  const imageFiles = fs.readdirSync(screenshots).filter((name) => /\.(png|jpe?g|webp)$/i.test(name));
  if (imageFiles.length < 5) errors.push(`marketplace-screenshots requires at least 5 real screenshots; found ${imageFiles.length}`);
}

const result = { errors, warnings };
console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exit(1);
