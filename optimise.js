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
const { PurgeCSS } = requireWithLog('purgecss');
const esbuild = requireWithLog('esbuild');
const postcss = requireWithLog('postcss');
const autoprefixer = requireWithLog('autoprefixer');
const { minify: htmlMinify } = requireWithLog('html-minifier-terser');
const cssDiff = requireWithLog('diff');

const SRC_HTML = path.join(__dirname, 'src', 'index.html');
const OUT_HTML = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'assets');
const OUT_CSS = path.join(ASSETS_DIR, 'style.min.css');
const OUT_JS = path.join(ASSETS_DIR, 'script.min.js');

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

// Extract CSS and JS from HTML
const styleTag = document.querySelector('style');
const scriptTag = document.querySelector('script');
const css = styleTag ? styleTag.textContent : '';
const js = scriptTag ? scriptTag.textContent : '';

async function processCSS() {
  try {
    logReport('CSS processing started.');
    const originalSize = Buffer.byteLength(css, 'utf8');

    // Write extracted CSS to temp file
    const tempCssPath = path.join(ASSETS_DIR, 'temp-style.css');
    fs.writeFileSync(tempCssPath, css, 'utf8');

    // Remove <style> from DOM and write new HTML to temp file for PurgeCSS
    const domForPurge = new JSDOM(htmlContent);
    const purgeDoc = domForPurge.window.document;
    const purgeStyle = purgeDoc.querySelector('style');
    if (purgeStyle) purgeStyle.remove();
    const tempHtmlPath = path.join(ASSETS_DIR, 'purge-tmp.html');
    fs.writeFileSync(tempHtmlPath, domForPurge.serialize(), 'utf8');

    // Run PurgeCSS
    const purgeCSSResult = await new PurgeCSS().purge({
      content: [tempHtmlPath],
      css: [tempCssPath],
      defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || []
    });

    fs.unlinkSync(tempHtmlPath);
    fs.unlinkSync(tempCssPath);

    const purgedCSS = purgeCSSResult[0] ? purgeCSSResult[0].css : css;

    // Log removed CSS code blocks (diagnostic)
    const diff = cssDiff.diffLines(css, purgedCSS);
    let cssRemoved = false;
    diff.forEach(part => {
      if (part.removed && part.value.trim()) {
        cssRemoved = true;
        logReport('PURGECSS REMOVED CSS BLOCK:\n' + part.value.trim());
      }
    });
    if (cssRemoved) {
      logReport('CSS REMOVED: Unused CSS selectors/rules WERE REMOVED by PurgeCSS.');
    } else {
      logReport('CSS REMOVED: No unused CSS was removed by PurgeCSS.');
    }

    // Autoprefixer via PostCSS
    const result = await postcss([autoprefixer]).process(purgedCSS, { from: undefined });

    // Write post-processed CSS to a temp file for minification
    const minifyInputPath = path.join(ASSETS_DIR, 'style-tmp.css');
    fs.writeFileSync(minifyInputPath, result.css, 'utf8');

    // Minify CSS using esbuild
    await esbuild.build({
      entryPoints: [minifyInputPath],
      outfile: OUT_CSS,
      minify: true,
      bundle: false,
      write: true,
      logLevel: 'silent'
    });

    fs.unlinkSync(minifyInputPath);

    // Calculate actual KB saved
    const minifiedSize = fs.statSync(OUT_CSS).size;
    const totalSavedKB = ((originalSize - minifiedSize) / 1024).toFixed(2);
    logReport(`CSS processed & minified completely. Total saved: ${totalSavedKB} KB.`);
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

    // Remove old <style> and <script> tags from DOM
    if (styleTag) styleTag.remove();
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