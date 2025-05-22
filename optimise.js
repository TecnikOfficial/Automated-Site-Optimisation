const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(__dirname, 'build-report.log');
if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);

function logReport(message) {
  const now = new Date();
  let hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  const seconds = now.getSeconds().toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${month}-${day} ${hours.toString().padStart(2, '0')}:${minutes}:${seconds} ${ampm}`;
  fs.appendFileSync(LOG_FILE, `[${timestamp}] ${message}\n`, 'utf8');
}

function requireWithLog(dep) {
  try {
    const pkg = require(dep);
    logReport(`Dependency loaded: ${dep} - SUCCESS`);
    return pkg;
  } catch (err) {
    logReport(`Dependency loaded: ${dep} - FAILED: ${err.message}`);
    throw err;
  }
}

const { JSDOM } = requireWithLog('jsdom');
const esbuild = requireWithLog('esbuild');
const { PurgeCSS } = requireWithLog('purgecss');
const { minify: htmlMinify } = requireWithLog('html-minifier-terser');
const cssDiff = requireWithLog('diff');

const SRC_HTML = path.join(__dirname, 'src', 'index.html');
const OUT_HTML = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'assets');
const OUT_CSS = path.join(ASSETS_DIR, 'style.min.css');
const OUT_JS = path.join(ASSETS_DIR, 'script.min.js');

const TMP_HTML_PATH = path.join(ASSETS_DIR, 'tmp-for-purge.html');
const TMP_CSS_PATH = path.join(ASSETS_DIR, 'tmp-style.css');

if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR);

logReport('Assets directory checked/created.');

let htmlContent;
try {
  htmlContent = fs.readFileSync(SRC_HTML, 'utf8');
  logReport('Read src/index.html - SUCCESS');
} catch (err) {
  logReport(`Read src/index.html - FAILED: ${err.message}`);
  throw err;
}

const dom = new JSDOM(htmlContent);
const document = dom.window.document;

// Extract ALL inline CSS from ALL <style> tags
const styleTags = [...document.querySelectorAll('style')];
const css = styleTags.map(tag => tag.textContent).join('\n');

// Extract JS from the first <script> tag (customize if you want all scripts)
const scriptTag = document.querySelector('script');
const js = scriptTag ? scriptTag.textContent : '';

// --- CREATE TMP HTML (no <style>, with <link> to TMP_CSS_PATH) ---
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

async function processCSS() {
  try {
    logReport('CSS processing started.');
    const originalSize = Buffer.byteLength(css, 'utf8');

    // PurgeCSS: remove unused CSS
    const purgeResult = await new PurgeCSS().purge({
      content: [TMP_HTML_PATH],
      css: [TMP_CSS_PATH]
    });
    const purgedCSS = purgeResult[0].css;

    // Log only removed CSS blocks
    const diff = cssDiff.diffLines(css, purgedCSS);
    let removed = false;
    diff.forEach(part => {
      if (part.removed && part.value.trim()) {
        logReport('PURGECSS REMOVED CSS BLOCK:\n' + part.value.trim());
        removed = true;
      }
    });
    if (removed) {
      logReport('CSS REMOVED: Unused CSS selectors/rules WERE REMOVED by PurgeCSS.');
    } else {
      logReport('CSS REMOVED: No unused CSS was removed by PurgeCSS.');
    }

    // Minify the purged CSS with esbuild
    const tempPurgedCssPath = path.join(ASSETS_DIR, 'purged-tmp.css');
    fs.writeFileSync(tempPurgedCssPath, purgedCSS, 'utf8');
    await esbuild.build({
      entryPoints: [tempPurgedCssPath],
      outfile: OUT_CSS,
      minify: true,
      bundle: false,
      write: true,
      logLevel: 'silent',
      loader: { '.css': 'css' }
    });
    fs.unlinkSync(tempPurgedCssPath);

    const minifiedSize = fs.statSync(OUT_CSS).size;
    const totalSavedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);
    logReport(`CSS purged, processed & minified completely. Total saved: ${totalSavedKB} KB.`);

    // Clean up temp files
    fs.unlinkSync(TMP_HTML_PATH);
    fs.unlinkSync(TMP_CSS_PATH);
  } catch (err) {
    logReport(`CSS processing FAILED: ${err.message}`);
    throw err;
  }
}

async function processJS() {
  try {
    logReport('JS processing started.');
    const originalSize = Buffer.byteLength(js, 'utf8');

    // Write JS to temp file for esbuild input
    const tempJsPath = path.join(ASSETS_DIR, 'script-tmp.js');
    fs.writeFileSync(tempJsPath, js, 'utf8');

    // Unminified bundle with tree shaking
    const UNMIN_JS_TS = path.join(ASSETS_DIR, 'script.unmin.treeshake.js');
    // Unminified bundle without tree shaking
    const UNMIN_JS_NOTS = path.join(ASSETS_DIR, 'script.unmin.nots.js');

    // With tree shaking (unminified)
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

    // Without tree shaking (unminified)
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

    // DIFF BLOCK: Log removed code (unminified)
    const tsContent = fs.readFileSync(UNMIN_JS_TS, 'utf8');
    const notsContent = fs.readFileSync(UNMIN_JS_NOTS, 'utf8');
    const changes = cssDiff.diffLines(notsContent, tsContent);
    let jsCodeRemoved = false;
    changes.forEach(part => {
      if (part.removed && part.value.trim()) {
        jsCodeRemoved = true;
        logReport('JS TREE SHAKING REMOVED CODE BLOCK (unminified):\n' + part.value.trim());
      }
    });
    if (jsCodeRemoved) {
      logReport('JS Tree shaking complete: Unused JS code WAS REMOVED.');
    } else {
      logReport('JS Tree shaking complete: No unused JS code was found.');
    }

    // Now minify only the tree-shaken JS for production
    await esbuild.build({
      entryPoints: [UNMIN_JS_TS],
      outfile: OUT_JS,
      minify: true,
      bundle: false,
      write: true,
      logLevel: 'silent'
    });

    // Calculate actual KB saved
    const minifiedSize = fs.statSync(OUT_JS).size;
    const totalSavedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);

    // Clean up
    fs.unlinkSync(tempJsPath);
    fs.unlinkSync(UNMIN_JS_TS);
    fs.unlinkSync(UNMIN_JS_NOTS);

    logReport(`JS processed & minified completely. Total saved: ${totalSavedKB} KB.`);
  } catch (err) {
    logReport(`JS processing FAILED: ${err.message}`);
    throw err;
  }
}

(async () => {
  logReport('--- Build started ---');
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

    // Minify HTML
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
    logReport(`HTML minified and index.html written successfully. You saved ${savedKB} KB.`);

    logReport('--- Build completed successfully ---');
    console.log('Build complete: index.html and assets/style.min.css + script.min.js created/updated.\nSee build-report.log for details.');
  } catch (err) {
    logReport(`Build FAILED: ${err.stack || err.message}`);
    console.error('Build failed. See build-report.log for details.');
    process.exit(1);
  }
})();