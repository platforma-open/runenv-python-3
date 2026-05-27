// Pre-fetch ImmuneBuilder model weights into shared/immunebuilder-weights/
// so the runenv build can stage them via copyFiles into share/immunebuilder-weights/
// of the published environment. Avoids the unstable on-first-use download from
// Zenodo when the 3d-structure-prediction block runs against a package-deployed
// runtime.
//
// Idempotent: re-runs skip files whose on-disk size already matches the
// expected Zenodo blob size. Partial downloads land in a .part sidecar and
// are atomically renamed on success.

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const targetDir = resolve(__dirname, '..', 'shared', 'immunebuilder-weights');

// Sizes are the byte length of the Zenodo blobs (record 7258553). They double
// as an integrity check + early-fail signal for truncated downloads; ImmuneBuilder
// itself only checks that the file is non-empty and doesn't start with "EMPTY",
// which is too loose to catch partial downloads.
const FILES = [
  { name: 'antibody_model_1', size: 61050011 },
  { name: 'antibody_model_2', size: 214267291 },
  { name: 'antibody_model_3', size: 214267291 },
  { name: 'antibody_model_4', size: 214267291 },
  { name: 'nanobody_model_1', size: 61050011 },
  { name: 'nanobody_model_2', size: 214267291 },
  { name: 'nanobody_model_3', size: 214267291 },
  { name: 'nanobody_model_4', size: 214267291 },
];

const BASE = 'https://zenodo.org/record/7258553/files';

async function downloadOne({ name, size }) {
  const dest = join(targetDir, name);
  if (existsSync(dest) && statSync(dest).size === size) {
    console.log(`  ✓ ${name} (cached)`);
    return;
  }
  const url = `${BASE}/${name}?download=1`;
  console.log(`  ↓ ${name} from ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const tmp = `${dest}.part`;
  try {
    await pipeline(res.body, createWriteStream(tmp));
    const got = statSync(tmp).size;
    if (got !== size) {
      throw new Error(`${name}: expected ${size} bytes, got ${got}`);
    }
    await rename(tmp, dest);
    console.log(`  ✓ ${name} (${got} bytes)`);
  } catch (err) {
    if (existsSync(tmp)) unlinkSync(tmp);
    throw err;
  }
}

mkdirSync(targetDir, { recursive: true });
console.log(`Fetching ImmuneBuilder weights into ${targetDir}`);
for (const f of FILES) {
  await downloadOne(f);
}
console.log('ImmuneBuilder weights ready');
