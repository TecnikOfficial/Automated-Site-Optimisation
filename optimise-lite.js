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

const buildStartTime = new Date(); // Capture build start time

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

// Dependency loading (Purged: PurgeCSS and Terser removed)
logSection('DEPENDENCY LOADING');
const { JSDOM } = requireWithLog('jsdom');
const esbuild = requireWithLog('esbuild');
const { minify: htmlMinify } = requireWithLog('html-minifier-terser');
const cssDiff = requireWithLog('diff');
const lightningcss = requireWithLog('lightningcss');
logStepDone('All dependencies loaded.');

const SRC_HTML = path.join(__dirname, 'src', 'index.html');
const OUT_HTML = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'assets');
const OUT_CSS = path.join(ASSETS_DIR, 'style.min.css');
const OUT_JS = path.join(ASSETS_DIR, 'script.min.js');

// Ensure assets directory exists
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

// Process CSS: Autoprefix & Minify (using Lightning CSS only)
async function processCSS() {
  logSection('AUTOPREFIX & MINIFY CSS (Lightning CSS)');
  try {
    const originalSize = Buffer.byteLength(css, 'utf8');
    logStep('Running Lightning CSS for autoprefixing and minification...');
    const { code } = lightningcss.transform({
      filename: 'style.css',
      code: Buffer.from(css),
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
    logStepDone('CSS processing complete.');
  } catch (err) {
    logStep(`CSS processing FAILED: ${err.message}`, 'FAIL');
    throw err;
  }
}

// Process JS: Bundle & Minify using esbuild (with tree shaking disabled)
async function processJS() {
  logSection('JS MINIFICATION (esbuild, without tree shaking)');
  try {
    const originalSize = Buffer.byteLength(js, 'utf8');
    logStep('Starting esbuild JS processing for bundling and minification...');

    // Write JS code to a temporary file for esbuild input
    const tempJsPath = path.join(ASSETS_DIR, 'script-tmp.js');
    fs.writeFileSync(tempJsPath, js, 'utf8');

    // Build JS using esbuild without tree shaking
    await esbuild.build({
      entryPoints: [tempJsPath],
      outfile: OUT_JS,
      bundle: true,
      minify: true,
      treeShaking: false,
      format: 'iife',
      target: ['es2017'],
      logLevel: 'silent',
      write: true
    });

    const minifiedSize = fs.statSync(OUT_JS).size;
    const totalSavedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);
    logStep(`JS minified with esbuild. Saved ${totalSavedKB} KB.`, 'SUCCESS');

    // Clean up temporary file
    fs.unlinkSync(tempJsPath);
    logStepDone('JS processing complete with esbuild.');
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

    // Add new <link> and <script> references for the build output
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'assets/style.min.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'assets/script.min.js';
    script.defer = true;
    document.body.appendChild(script);

    logSection('MINIFY HTML');
    const originalHtmlSize = Buffer.byteLength(dom.serialize(), 'utf8');
    const finalHtml = await htmlMinify(dom.serialize(), {
      collapseWhitespace: true,
      removeComments: true,
      minifyCSS: false,
      minifyJS: false
    });
    const minifiedHtmlSize = Buffer.byteLength(finalHtml, 'utf8');
    const savedHtmlKB = ((originalHtmlSize - minifiedHtmlSize) / 1024).toFixed(2);

    // Write the final HTML output
    fs.writeFileSync(OUT_HTML, finalHtml, 'utf8');
    logStep(`HTML minified and index.html written. Saved ${savedHtmlKB} KB.`, 'SUCCESS');
    logStepDone('HTML minification done.');

    logSection('BUILD COMPLETE');

    // Calculate total sizes for reporting
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