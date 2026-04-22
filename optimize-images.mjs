// optimize-images.mjs
// Genera versiones WebP redimensionadas (480/800/1200/1600) de las fotos
// originales en public/images/FOTOS BERLINGO y public/images/PNG, guardándolas
// en public/images/optimized/<ruta-espejo>/<basename>-<width>.webp.
// Las originales se dejan intactas para descarga / visualización original.
//
// Se ejecuta automáticamente antes del build (npm run build -> prebuild).
// Si falta `sharp`, el script se salta con un warning y el build continúa.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const SRC_DIRS = [
  path.join(ROOT, 'public', 'images', 'FOTOS BERLINGO'),
  path.join(ROOT, 'public', 'images', 'PNG'),
];
const OUT_BASE = path.join(ROOT, 'public', 'images', 'optimized');

const WIDTHS = [480, 800, 1200, 1600];
const EXT_RE = /\.(jpe?g|png)$/i;

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch (err) {
  console.warn('[optimize-images] sharp no está instalado. Omitiendo optimización.');
  console.warn('                  Ejecuta: npm install');
  process.exit(0);
}

async function* walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (EXT_RE.test(e.name)) yield full;
  }
}

async function processOne(srcPath) {
  const rel = path.relative(path.join(ROOT, 'public', 'images'), srcPath);
  const parsed = path.parse(rel);
  const outDir = path.join(OUT_BASE, parsed.dir);
  await fs.mkdir(outDir, { recursive: true });

  const srcStat = await fs.stat(srcPath);
  const img = sharp(srcPath);
  const meta = await img.metadata();
  const origWidth = meta.width || 1600;

  const tasks = [];
  for (const w of WIDTHS) {
    if (w > origWidth + 50) continue;
    const outFile = path.join(outDir, `${parsed.name}-${w}.webp`);
    try {
      const outStat = await fs.stat(outFile);
      if (outStat.mtimeMs >= srcStat.mtimeMs) continue;
    } catch { /* not exists */ }

    tasks.push(
      sharp(srcPath)
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 78, effort: 5 })
        .toFile(outFile)
        .then(() => console.log(`  ✓ ${path.relative(ROOT, outFile)}`))
    );
  }
  await Promise.all(tasks);
}

async function run() {
  console.log('[optimize-images] Procesando imágenes...');
  let count = 0;
  for (const dir of SRC_DIRS) {
    for await (const file of walk(dir)) {
      await processOne(file);
      count++;
    }
  }
  console.log(`[optimize-images] ${count} archivos procesados.`);
}

run().catch((err) => {
  console.error('[optimize-images] Error:', err);
  process.exit(0);
});
