const fs = require('fs');
const path = require('path');
const https = require('https');

// Target directory paths
const templatesDir = path.join(__dirname, '../templates');
const fontsDir = path.join(templatesDir, 'fonts');
const localCssPath = path.join(templatesDir, 'local_fonts.css');

// Google Fonts API URL with all families and required weights/styles
const googleFontsApiUrl = 'https://fonts.googleapis.com/css2?' + 
  'family=Cinzel:wght@700;800;900&' +
  'family=Inter:wght@400;500;600;700&' +
  'family=Fredoka:wght@500;600;700&' +
  'family=Lato:ital,wght@0,400;0,700;1,400&' +
  'family=Space+Grotesk:wght@600;700;900&' +
  'family=DM+Sans:wght@400;500;700&' +
  'family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,400;1,500;1,600;1,700&' +
  'family=Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&' +
  'family=Arvo:wght@400;700&' +
  'family=Fira+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&' +
  'family=Montserrat:wght@700;800;900&' +
  'family=Barlow:ital,wght@0,500;0,600;0,700;0,800;1,600&' +
  'family=Playfair+Display:ital,wght@0,600;0,700;1,600&' +
  'family=Caveat:wght@700&' +
  'family=Roboto+Slab:wght@500;700&' +
  'family=Cinzel+Decorative:wght@700&' +
  'family=Righteous&' +
  'family=Rock+Salt&' +
  'family=Aladin&' +
  'display=swap';

// Modern browser User-Agent to force Google Fonts to return optimized WOFF2 links
const browserUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Helper: Make HTTP GET request
function makeHttpGetRequest(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP status ${res.statusCode} for URL: ${url}`));
        return;
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', err => reject(err));
  });
}

// Helper: Download a binary file
function downloadBinaryFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download binary: HTTP status ${res.statusCode}`));
        return;
      }
      const fileStream = fs.createWriteStream(destPath);
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    }).on('error', err => reject(err));
  });
}

// Main execution function
async function run() {
  console.log("==================================================");
  console.log("STARTING AUTOMATED OFFLINE FONT DOWNLOADER");
  console.log("==================================================");

  try {
    // 1. Create fonts directory if it doesn't exist
    if (!fs.existsSync(fontsDir)) {
      console.log(`Creating fonts directory: ${fontsDir}`);
      fs.mkdirSync(fontsDir, { recursive: true });
    }

    // 2. Fetch Google Fonts CSS stylesheet
    console.log("Fetching Google Fonts CSS metadata...");
    const cssContent = await makeHttpGetRequest(googleFontsApiUrl, { 'User-Agent': browserUserAgent });

    // 3. Parse CSS blocks
    // Google CSS is structured into blocks separated by comments, e.g., /* latin */
    const blocks = cssContent.split('/* ');
    const localFontFaceDeclarations = [];
    let downloadCount = 0;

    console.log(`Parsing CSS declarations (${blocks.length} raw blocks)...`);

    for (const block of blocks) {
      if (!block.trim()) continue;

      // We only target the 'latin' character set for lightweight, optimal offline notes
      const isLatin = block.startsWith('latin */');
      if (!isLatin) continue;

      // Extract font-face rule
      const fontFaceStartIndex = block.indexOf('@font-face');
      if (fontFaceStartIndex === -1) continue;

      const fontFaceBlock = block.substring(fontFaceStartIndex);
      
      // Parse key font-face attributes
      const familyMatch = fontFaceBlock.match(/font-family:\s*['"]?([^'"]+)['"]?;/);
      const styleMatch = fontFaceBlock.match(/font-style:\s*([^;]+);/);
      const weightMatch = fontFaceBlock.match(/font-weight:\s*([^;]+);/);
      const urlMatch = fontFaceBlock.match(/url\((https:\/\/[^)]+)\)/);

      if (!familyMatch || !styleMatch || !weightMatch || !urlMatch) continue;

      const family = familyMatch[1].trim();
      const style = styleMatch[1].trim();
      const weight = weightMatch[1].trim();
      const fontUrl = urlMatch[1].trim();

      // Construct a clean, standardized local file name
      // e.g. "cormorant-garamond-600-italic.woff2"
      const familySlug = family.toLowerCase().replace(/\s+/g, '-');
      const filename = `${familySlug}-${weight}-${style}.woff2`;
      const destPath = path.join(fontsDir, filename);

      console.log(`Processing: ${family.padEnd(20)} | Weight: ${weight.padEnd(4)} | Style: ${style.padEnd(8)}`);

      // 4. Download font binary if it does not already exist
      if (!fs.existsSync(destPath)) {
        try {
          await downloadBinaryFile(fontUrl, destPath);
          console.log(`  -> Downloaded successfully: ${filename}`);
          downloadCount++;
        } catch (downloadErr) {
          console.error(`  -> [ERROR] Failed to download ${filename}: ${downloadErr.message}`);
          continue;
        }
      } else {
        console.log(`  -> Already exists: ${filename} (skipping download)`);
      }

      // 5. Construct the local @font-face rule
      // We map the source URL to our static local server path: /fonts/<filename>
      const localUrl = `/fonts/${filename}`;
      const localFontFaceRule = `@font-face {\n  font-family: '${family}';\n  font-style: ${style};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('${localUrl}') format('woff2');\n}`;
      localFontFaceDeclarations.push(localFontFaceRule);
    }

    // 6. Write local_fonts.css containing all @font-face rules
    console.log("--------------------------------------------------");
    console.log(`Writing local font stylesheet to: ${localCssPath}`);
    fs.writeFileSync(localCssPath, localFontFaceDeclarations.join('\n\n'), 'utf8');

    console.log("==================================================");
    console.log("FONT DOWNLOAD & METADATA COMPILATION COMPLETE!");
    console.log(`Total Binary Files Synced: ${localFontFaceDeclarations.length}`);
    console.log(`New Downloads Completed  : ${downloadCount}`);
    console.log("==================================================");

  } catch (err) {
    console.error("==================================================");
    console.error(`CRITICAL FAILURE IN FONT DOWNLOADER: ${err.message}`);
    console.error("==================================================");
    process.exit(1);
  }
}

run();
