const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(__dirname, 'build-report.log');
if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);

// === Insert date/time heading at top of log file ===
const now = new Date();
let hours = now.getHours();
const minutes = now.getMinutes().toString().padStart(2, '0');
const ampm = hours >= 12 ? 'PM' : 'AM';
hours = hours % 12;
hours = hours ? hours : 12;
const datePart = now.toISOString().slice(0, 10);
const timePart = `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
fs.appendFileSync(LOG_FILE, `BUILD STARTED AT: ${datePart} ${timePart}\n`, 'utf8');

const buildStartTime = new Date(); // Capture the actual build start date/time

// Logging helpers
let stepStartTime = null;
function logSection(title) {
  const msg = `\n========== ${title} ==========\n`;
  fs.appendFileSync(LOG_FILE, msg, 'utf8');
  console.log(msg);
  stepStartTime = Date.now();
}
function logStep(message, status = 'INFO') {
  const msg = `[${status}] ${message}`;
  fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
  console.log(msg);
}
function logRemovedBlock(label, code) {
  const msg = `[REMOVED] ${label}:\n${code.trim()}`;
  fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
  console.log(msg);
}
function logStepDone(successMsg) {
  if (stepStartTime !== null) {
    const duration = ((Date.now() - stepStartTime) / 1000).toFixed(2);
    const msg = `---- Step completed in ${duration}s: ${successMsg}`;
    fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
    console.log(msg);
    stepStartTime = null;
  } else {
    const msg = `---- Step completed: ${successMsg}`;
    fs.appendFileSync(LOG_FILE, msg + '\n', 'utf8');
    console.log(msg);
  }
}

function requireWithLog(dep) {
  try {
    const pkg = require(dep);
    logStep(`Dependency loaded: ${dep}`, 'SUCCESS');
    return pkg;
  } catch (err) {
    logStep(`Dependency loaded: ${dep} - FAILED: ${err.message}`, 'FAIL');
    throw err;
  }
}

// Dependency loading
logSection('DEPENDENCY LOADING');
const { JSDOM } = requireWithLog('jsdom');
const esbuild = requireWithLog('esbuild');
const { PurgeCSS } = requireWithLog('purgecss');
const { minify: htmlMinify } = requireWithLog('html-minifier-terser');
const cssDiff = requireWithLog('diff');
const lightningcss = requireWithLog('lightningcss');
const Terser = requireWithLog('terser');
logStepDone('All dependencies loaded.');

const SRC_HTML = path.join(__dirname, 'src', 'index.html');
const OUT_HTML = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'assets');
const OUT_CSS = path.join(ASSETS_DIR, 'style.min.css');
const OUT_JS = path.join(ASSETS_DIR, 'script.min.js');

const TMP_HTML_PATH = path.join(ASSETS_DIR, 'tmp-for-purge.html');
const TMP_CSS_PATH = path.join(ASSETS_DIR, 'tmp-style.css');

// Ensure assets dir exists
logSection('ASSET DIRECTORY CHECK');
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR);
logStep('Assets directory exists or created.');
logStepDone('Asset directory check done.');

// Read src/index.html
logSection('READ SOURCE HTML');
let htmlContent;
try {
  htmlContent = fs.readFileSync(SRC_HTML, 'utf8');
  logStep('Read src/index.html - SUCCESS');
  logStepDone('Source HTML read.');
} catch (err) {
  logStep(`Read src/index.html - FAILED: ${err.message}`, 'FAIL');
  throw err;
}

const dom = new JSDOM(htmlContent);
const document = dom.window.document;

// Extract all inline CSS from <style> tags
logSection('EXTRACT INLINE CSS');
const styleTags = [...document.querySelectorAll('style')];
const css = styleTags.map(tag => tag.textContent).join('\n');
logStep(`Extracted CSS from ${styleTags.length} <style> tag(s).`);
logStepDone('Inline CSS extraction done.');

// Extract JS from the first <script> tag
const scriptTag = document.querySelector('script');
const js = scriptTag ? scriptTag.textContent : '';

// Create temporary HTML and CSS for PurgeCSS run
logSection('GENERATE TEMP FILES FOR PURGECSS');
const domTmp = new JSDOM(htmlContent);
const docTmp = domTmp.window.document;
[...docTmp.querySelectorAll('style')].forEach(tag => tag.remove());
const linkTag = docTmp.createElement('link');
linkTag.rel = 'stylesheet';
linkTag.href = './tmp-style.css'; // relative for PurgeCSS context
docTmp.head.appendChild(linkTag);
const tmpHtmlContent = domTmp.serialize();
fs.writeFileSync(TMP_HTML_PATH, tmpHtmlContent, 'utf8');
fs.writeFileSync(TMP_CSS_PATH, css, 'utf8');
logStep('Temporary HTML and CSS files for PurgeCSS created.');
logStepDone('Temp file generation done.');

async function processCSS() {
  logSection('PURGE UNUSED CSS (PurgeCSS)');
  try {
    const originalSize = Buffer.byteLength(css, 'utf8');
    logStep('Running PurgeCSS to remove unused CSS selectors...');
    const purgeResult = await new PurgeCSS().purge({
      content: [TMP_HTML_PATH],
      css: [TMP_CSS_PATH]
    });
    let purgedCSS = purgeResult[0].css;

    // Log removed CSS blocks
    const diff = cssDiff.diffLines(css, purgedCSS);
    let removedBlocks = 0;
    diff.forEach(part => {
      if (part.removed && part.value.trim()) {
        removedBlocks++;
        logRemovedBlock('CSS code removed', part.value);
      }
    });
    if (removedBlocks) {
      logStep('PurgeCSS removed unused CSS code.', 'SUCCESS');
    } else {
      logStep('No unused CSS selectors were found by PurgeCSS.', 'SUCCESS');
    }
    logStepDone('PurgeCSS step finished.');

    logSection('AUTOPREFIX & MINIFY CSS (Lightning CSS)');
    logStep('Running Lightning CSS for autoprefixing and minification...');
    const { code } = lightningcss.transform({
      filename: 'style.css',
      code: Buffer.from(purgedCSS),
      minify: true,
      targets: {
        chrome: 90,
        firefox: 90,
        safari: 13,
        edge: 90
      },
      drafts: {},
      sourceMap: false
    });

    fs.writeFileSync(OUT_CSS, code);

    const minifiedSize = fs.statSync(OUT_CSS).size;
    const totalSavedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);
    logStep(`Lightning CSS autoprefixed & minified CSS. Saved ${totalSavedKB} KB.`, 'SUCCESS');
    logStepDone('Lightning CSS step finished.');

    // Clean up temp files
    fs.unlinkSync(TMP_HTML_PATH);
    fs.unlinkSync(TMP_CSS_PATH);
    logStep('Temporary files cleaned up.');
    logStepDone('CSS processing complete.');
  } catch (err) {
    logStep(`CSS processing FAILED: ${err.message}`, 'FAIL');
    throw err;
  }
}

async function processJS() {
  logSection('JS MINIFICATION & TREE SHAKING (esbuild + Terser)');
  try {
    const originalSize = Buffer.byteLength(js, 'utf8');
    logStep('Starting esbuild JS processing for tree shaking...');

    // Write JS to a temporary file for esbuild input
    const tempJsPath = path.join(ASSETS_DIR, 'script-tmp.js');
    fs.writeFileSync(tempJsPath, js, 'utf8');

    // Build a version with tree shaking enabled (for final use)
    const UNMIN_JS_TS = path.join(ASSETS_DIR, 'script.unmin.treeshake.js');
    await esbuild.build({
      entryPoints: [tempJsPath],
      outfile: UNMIN_JS_TS,
      minify: false,
      bundle: true,
      treeShaking: true,
      format: 'iife',
      target: ['es2017'],
      write: true,
      logLevel: 'silent'
    });

    // Build a version without tree shaking (for diff comparison)
    const UNMIN_JS_NOTS = path.join(ASSETS_DIR, 'script.unmin.nots.js');
    await esbuild.build({
      entryPoints: [tempJsPath],
      outfile: UNMIN_JS_NOTS,
      minify: false,
      bundle: true,
      treeShaking: false,
      format: 'iife',
      target: ['es2017'],
      write: true,
      logLevel: 'silent'
    });

    // Diff block: log code removed by tree shaking by comparing Nots vs TS outputs
    const notsContent = fs.readFileSync(UNMIN_JS_NOTS, 'utf8');
    const tsContent = fs.readFileSync(UNMIN_JS_TS, 'utf8');
    const changes = cssDiff.diffLines(notsContent, tsContent);
    let jsCodeRemoved = 0;
    changes.forEach(part => {
      if (part.removed && part.value.trim()) {
        jsCodeRemoved++;
        logRemovedBlock('JS code removed by tree shaking', part.value);
      }
    });
    if (jsCodeRemoved) {
      logStep('Esbuild tree shaking removed unused JS code.', 'SUCCESS');
    } else {
      logStep('No unused JS code was found by esbuild tree shaking.', 'SUCCESS');
    }

    // Now let Terser perform compression & mangling on the tree-shaken bundle
    logStep('Terser: Starting compression & mangling on tree-shaken code...');
    const terserResult = await Terser.minify(tsContent, {
      compress: {
        // More aggressive options possible here (e.g., drop_console: true, passes: 2)
      },
      mangle: true
    });
    if (terserResult.error) {
      logStep(`Terser minification FAILED: ${terserResult.error}`, 'FAIL');
      throw terserResult.error;
    }
    logStep('Terser: Compression & mangling completed successfully.');

    // Write the Terser-minified code to the output file
    fs.writeFileSync(OUT_JS, terserResult.code, 'utf8');

    const minifiedSize = fs.statSync(OUT_JS).size;
    const totalSavedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);
    logStep(`JS optimised. Saved ${totalSavedKB} KB.`, 'SUCCESS');

    // Clean up temporary files
    fs.unlinkSync(tempJsPath);
    fs.unlinkSync(UNMIN_JS_TS);
    fs.unlinkSync(UNMIN_JS_NOTS);

    logStepDone('JS processing complete.');
  } catch (err) {
    logStep(`JS processing FAILED: ${err.message}`, 'FAIL');
    throw err;
  }
}

(async () => {
  logSection('BUILD START');
  try {
    await processCSS();
    await processJS();

    // Remove old <style> and <script> tags from DOM (for minified HTML output)
    document.querySelectorAll('style').forEach(tag => tag.remove());
    if (scriptTag) scriptTag.remove();

    // Add <link> and <script> references
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/style.min.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'assets/script.min.js';
    script.defer = true;
    document.body.appendChild(script);

    logSection('MINIFY HTML');
    const originalSize = Buffer.byteLength(dom.serialize(), 'utf8');
    const finalHtml = await htmlMinify(dom.serialize(), {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: false,
      minifyJS: false
    });
    const minifiedSize = Buffer.byteLength(finalHtml, 'utf8');
    const savedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);

    // Write output HTML
    fs.writeFileSync(OUT_HTML, finalHtml, 'utf8');
    logStep(`HTML minified and index.html written. Saved ${savedKB} KB.`, 'SUCCESS');
    logStepDone('HTML minification done.');

    logSection('BUILD COMPLETE');

    // Calculate total original and optimized sizes
    const srcHtmlSize = fs.statSync(SRC_HTML).size;
    const srcCssSize = Buffer.byteLength(css, 'utf8');
    const srcJsSize = Buffer.byteLength(js, 'utf8');
    const totalOriginal = srcHtmlSize + srcCssSize + srcJsSize;

    const optHtmlSize = fs.statSync(OUT_HTML).size;
    const optCssSize = fs.statSync(OUT_CSS).size;
    const optJsSize = fs.statSync(OUT_JS).size;
    const totalOptimized = optHtmlSize + optCssSize + optJsSize;

    const totalSaved = totalOriginal - totalOptimized;
    const totalSavedKB = (totalSaved / 1024).toFixed(2);

    logStep(`All build steps finished successfully. You saved ${totalSavedKB} KB in total.`, 'SUCCESS');

    const totalBuildTime = ((Date.now() - buildStartTime) / 1000).toFixed(2);
    const finalMsg = `All Steps completed in ${totalBuildTime}s: Build finished.`;
    fs.appendFileSync(LOG_FILE, `---- ${finalMsg}\n`, 'utf8');
    console.log(`---- ${finalMsg}`);
    console.log('\nBuild complete: index.html and assets/style.min.css + script.min.js created/updated.\nSee build-report.log for details.');
  } catch (err) {
    logStep(`Build FAILED: ${err.stack || err.message}`, 'FAIL');
    logStepDone('Build failed.');
    console.error('Build failed. See build-report.log for details.');
    process.exit(1);
  }
})();