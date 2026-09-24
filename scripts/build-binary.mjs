import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = join(__dirname, '..');

// Ensure dist directory exists
const distDir = join(root, 'dist');
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

// 1. Build bundle first
execSync('node scripts/build-bundle.mjs', { stdio: 'inherit', cwd: root });

// 2. Generate sea-config.json
const platformMap = {
  win32: 'windows',
  linux: 'linux',
  darwin: 'darwin',
};
const plat = platformMap[os.platform()] || os.platform();
const ext = os.platform() === 'win32' ? '.exe' : '';
const outName = `elevate-${plat}-${os.arch()}${ext}`;

const seaConfig = {
  main: 'dist/bundle.mjs',
  output: `dist/${outName}`,
  mainFormat: 'module',
  useVfs: true,
};

const configPath = join(distDir, 'sea-config.json');
writeFileSync(configPath, JSON.stringify(seaConfig, null, 2));

// 3. Run node --build-sea
console.log(`Building standalone binary: ${outName}...`);
execSync(`node --build-sea dist/sea-config.json`, { stdio: 'inherit', cwd: root });

console.log(`\n🎉 Executable created: dist/${outName}`);
