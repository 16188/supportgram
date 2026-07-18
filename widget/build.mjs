import * as esbuild from 'esbuild';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function build() {
  try {
    const result = await esbuild.build({
      entryPoints: [path.join(__dirname, 'src/widget.js')],
      outfile: path.join(__dirname, '../public/widget.js'),
      bundle: true,
      minify: true,
      format: 'iife',
      target: 'es2018',
      banner: {
        js: '/* supportgram widget */',
      },
    });

    // Read the output file for size reporting
    const bundleContent = readFileSync(path.join(__dirname, '../public/widget.js'));
    const gzipped = gzipSync(bundleContent);

    console.log('\n✓ Widget build successful');
    console.log(`  Raw size: ${(bundleContent.length / 1024).toFixed(2)} KB`);
    console.log(`  Gzipped:  ${(gzipped.length / 1024).toFixed(2)} KB`);
    console.log(`  Output:   ${path.join(__dirname, '../public/widget.js')}\n`);

    if (gzipped.length > 15 * 1024) {
      console.warn('⚠ Warning: Gzipped size exceeds 15 KB target');
    }
  } catch (err) {
    console.error('Build failed:', err.message);
    process.exit(1);
  }
}

build();
