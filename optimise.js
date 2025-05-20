const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { PurgeCSS } = require('purgecss');
const esbuild = require('esbuild');
const postcss = require('postcss');
const autoprefixer = require('autoprefixer');
const { minify: htmlMinify } = require('html-minifier-terser');

// Paths
const SRC_HTML = path.join(__dirname, 'src', 'index.html');
const OUT_HTML = path.join(__dirname, 'index.html');
const ASSETS_DIR = path.join(__dirname, 'assets');
const OUT_CSS = path.join(ASSETS_DIR, 'style.min.css');
const OUT_JS = path.join(ASSETS_DIR, 'script.min.js');

// Ensure assets dir exists
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR);

// Read src/index.html
const htmlContent = fs.readFileSync(SRC_HTML, 'utf8');
const dom = new JSDOM(htmlContent);
const document = dom.window.document;

// Extract CSS and JS
const styleTag = document.querySelector('style');
const scriptTag = document.querySelector('script');
const css = styleTag ? styleTag.textContent : '';
const js = scriptTag ? scriptTag.textContent : '';

async function processCSS() {
  // Purge unused CSS based on HTML content
  const tempHtmlPath = path.join(__dirname, 'assets', 'purge-tmp.html');
  fs.writeFileSync(tempHtmlPath, dom.serialize(), 'utf8');
  const purgeCSSResult = await new PurgeCSS().purge({
    content: [tempHtmlPath],
    css: [{ raw: css }],
    defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || []
  });
  fs.unlinkSync(tempHtmlPath);

  const purgedCSS = purgeCSSResult[0] ? purgeCSSResult[0].css : css;

  // Autoprefixer via PostCSS
  const result = await postcss([autoprefixer]).process(purgedCSS, { from: undefined });

  // Write to temp CSS file for esbuild input
  const tempCssPath = path.join(ASSETS_DIR, 'style-tmp.css');
  fs.writeFileSync(tempCssPath, result.css, 'utf8');

  // Minify CSS using esbuild
  await esbuild.build({
    entryPoints: [tempCssPath],
    outfile: OUT_CSS,
    minify: true,
    bundle: false,
    write: true,
    logLevel: 'silent'
  });

  fs.unlinkSync(tempCssPath);
}

async function processJS() {
  // Write JS to temp file for esbuild input
  const tempJsPath = path.join(ASSETS_DIR, 'script-tmp.js');
  fs.writeFileSync(tempJsPath, js, 'utf8');

  // Minify, bundle, and tree-shake JS using esbuild
  await esbuild.build({
    entryPoints: [tempJsPath],
    outfile: OUT_JS,
    minify: true,
    bundle: true,           // Enable bundling (needed for tree shaking)
    treeShaking: true,      // Optional, true by default with bundling
    format: 'iife',         // Good for browser <script>
    target: ['es2017'],     // Or lower for broader support
    write: true,
    logLevel: 'silent'
  });

  fs.unlinkSync(tempJsPath);
}

(async () => {
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
  const finalHtml = await htmlMinify(dom.serialize(), {
    collapseWhitespace: true,
    removeComments: true,
    minifyCSS: false,
    minifyJS: false
  });

  // Write output HTML
  fs.writeFileSync(OUT_HTML, finalHtml, 'utf8');
  console.log('Build complete: index.html and assets/style.min.css + script.min.js created/updated.');
})();