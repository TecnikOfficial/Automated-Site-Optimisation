
# optimise.js - Automated Site Optimiser [<img src="https://cdn.jsdelivr.net/gh/TecnikOfficial/Automated-Site-Optimiser@refs/heads/main/assets/img/rocket.webp" alt="Rocket" width="40" height="40">](https://tecnikofficial.github.io/Automated-Site-Optimiser/)

optimise.js helps you build fast, efficient static sites with automated HTML, CSS, and JS optimization and deployment.

## 🚀 How optimise.js Works - ▶️ [Watch Tutorial](https://youtu.be/D3TvT5rhfbQ?feature=shared)

The `optimise.js` script helps make your website faster and more efficient by automatically optimizing your HTML, CSS, and JavaScript files:

1. 📝 **Reads the Source HTML:** Looks for CSS and JS in `src/index.html`.
2. 🎨 **Extracts and Processes CSS:**
   - 🚮 Removes unused CSS rules
   - 🌐 Adds prefixes (Better Browser compatibility)
   - ✂️ Minifies CSS and saves as `assets/style.min.css`
3. ⚡ **Processes JavaScript:**
   - ✂️ Minifies and bundles JS while removing dead JS code.
   - 💾 Saves as `assets/script.min.js`
4. 🏗️ **Updates the HTML:**
   - 🧹 Removes old `<style>` and `<script>` tags
   - 🔗 Inserts references to optimized files
5. 🧼 **Minifies the HTML:**
   - 🗑️ Shrinks HTML and removes comments
   - 💾 Saves as `index.html`
6. 📦 **Final Output:**  
   - Optimized `index.html`, `assets/style.min.css`, and `assets/script.min.js`

> ⚠️ **Note:**  
> For `optimise.js` to work, put all HTML, CSS (in a `<style>` tag), and JS (in a `<script>` tag) inline inside `src/index.html`.<br>
> (Optional) Attach functions to the `window` object in JS to make them globally accessible and prevent them from being mistakenly removed by the tree-shaking process.

---

## 🛠️ Commands

### Pro Mode
- **Command:** 
```
npm run optimise-pro
```
- **Description:** This mode provides advanced optimization features, including aggressive js compression and mangling for maximum performance.

### Balanced (Default)
- **Command:** 
```
npm run optimise` or `npm run build
```
- **Description:** This is the default mode that balances optimization and build time, suitable for most use cases.

### Lite Mode
- **Command:**
```
npm run optimise-lite
```
- **Description:** This mode processes files without tree-shaking or PurgeCSS, making it faster but less aggressive in optimization.

---

## 🤖 Automated Deployment

All optimization steps are automated with GitHub Actions!  
The workflow in `.github/workflows/deploy.yml` runs every time you update `src/index.html`:

- 🛎 **Triggered on push:** Any change to `src/index.html` starts the workflow
- 🏗️ **Build & Optimize:**  
  - Checks out your code  
  - Sets up Node.js  
  - Installs dependencies  
  - Runs the `optimise.js` script (via `npm run optimise`)
- 🚀 **Auto-commit:**  
  - Commits the optimized files (`index.html`, `assets/style.min.css`, `assets/script.min.js`) automatically

🔄 **Dependabot** is enabled!  
Whenever a new version of a dependency is released, Dependabot creates a pull request to update it.  
All you have to do is **merge the pull request**—your site always stays updated and secure.

---

## 🗓️ Planned Updates

🖼️ **Image Optimisation** -  
Ability to auto minify images in the `assets` folder.<br>

---

🛠️ **In simple terms:**  
Click on [![Use this Template](https://img.shields.io/badge/Use%20this%20Template-olivegreen.svg)](https://github.com/new?template_name=Automated-Site-Optimiser&template_owner=TecnikOfficial) button and make necessary changes and upload your site code in `src/index.html` and get optimized site files in seconds.<br>
If you run into build errors or want to see what’s happening behind the scenes, you can always check the `build-report.logs` for more information.

✅ **SCAN RESULTS:** [Optimise.js](https://www.virustotal.com/gui/url/11075fbad0d7e9253727b287dc41af51022d900a726745f