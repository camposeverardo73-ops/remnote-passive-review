import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const warnings = [];
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('public/manifest.json'));

if (manifest.manifestVersion !== 1) errors.push('manifestVersion must be 1');
if (!manifest.version || typeof manifest.version !== 'object') errors.push('manifest.version must use {major,minor,patch}');
if (manifest.enableOnMobile !== true) errors.push('enableOnMobile must be true for this RC');
if (manifest.requestNative !== false) errors.push('requestNative must remain false');
if (!Array.isArray(manifest.requiredScopes) || manifest.requiredScopes.length !== 1) errors.push('expected one minimal declared scope');
const scope = manifest.requiredScopes?.[0];
if (scope?.type !== 'All' || scope?.level !== 'ReadCreateModify') errors.push('release scope must be All/ReadCreateModify');
if (!manifest.repoUrl) warnings.push('repoUrl is blank; supply a real project repository before marketplace submission if required');
if (String(manifest.repoUrl).includes('remnote-plugin-template-react')) errors.push('repoUrl still points at the RemNote template');

const forbiddenFiles = [
  'src/pilot-b2-provision.ts',
  'src/widgets/card_binding_inspector.tsx',
  'public/assets',
  'public/regions',
];
for (const rel of forbiddenFiles) {
  if (fs.existsSync(path.join(root, rel))) errors.push(`release source contains dev/private path: ${rel}`);
}

const runtimeFiles = [];
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx|js|jsx|css|json|svg)$/.test(entry.name)) runtimeFiles.push(full);
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'public'));
const patterns = [
  [/\/Users\//, 'absolute macOS user path'],
  [/127\.0\.0\.1/, '127.0.0.1 runtime dependency'],
  [/localhost/, 'localhost runtime dependency'],
  [/child_process/, 'child_process runtime dependency'],
  [/\bfrom\s+['\"]electron['\"]|require\(['\"]electron['\"]\)/, 'Electron runtime dependency'],
  [/\bfrom\s+['\"]fs['\"]|require\(['\"]fs['\"]\)/, 'Node fs runtime dependency'],
  [/BEGIN PRIVATE KEY|AKIA[0-9A-Z]{16}/, 'possible secret'],
];
for (const file of runtimeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const [re, label] of patterns) if (re.test(text)) errors.push(`${label}: ${path.relative(root, file)}`);
}

const userPrivateExts = [];
for (const file of runtimeFiles) {
  const rel = path.relative(path.join(root, 'public'), file);
  if (!rel.startsWith('..') && /\.(png|jpe?g|webp|pdf)$/i.test(file)) userPrivateExts.push(rel);
}
if (userPrivateExts.length) errors.push(`public release contains user media: ${userPrivateExts.join(', ')}`);

console.log(JSON.stringify({ errors, warnings }, null, 2));
if (errors.length) process.exit(1);
