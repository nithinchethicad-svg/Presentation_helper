const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const officeParser = require('officeparser');
const { GoogleGenAI } = require('@google/genai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Set up Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Configure Gemini API keys for rotation
const apiKeys = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7
].filter(key => !!key); // Keep only non-empty keys

// Fallback to GEMINI_API_KEY if no numbered keys are defined
if (apiKeys.length === 0 && process.env.GEMINI_API_KEY) {
  apiKeys.push(process.env.GEMINI_API_KEY);
}

// Current active key index
let currentKeyIndex = 0;

// Get the model name from environment or default to gemini-1.5-pro
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-pro';

// In-memory system logs store for debugging
const systemLogs = [];

function logEvent(level, message, details = null) {
  const timestamp = new Date().toISOString();
  systemLogs.unshift({ timestamp, level, message, details });
  
  if (systemLogs.length > 200) {
    systemLogs.pop();
  }
  
  const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  if (level === 'error') {
    console.error(consoleMsg, details ? JSON.stringify(details) : '');
  } else if (level === 'warn') {
    console.warn(consoleMsg, details ? JSON.stringify(details) : '');
  } else {
    console.log(consoleMsg, details ? JSON.stringify(details) : '');
  }
}

logEvent('info', `Backend initialized with model: ${MODEL_NAME}`);
logEvent('info', `Configured Gemini API keys for rotation: ${apiKeys.length}`);

/**
 * Helper function to call the Gemini API with key rotation.
 * If one key fails (e.g. rate limit), it automatically rotates to the next key.
 */
async function generateContentWithRotation(prompt, systemInstruction) {
  if (apiKeys.length === 0) {
    const errorMsg = "No Gemini API keys configured. Please add keys to your backend/.env file.";
    logEvent('error', errorMsg);
    throw new Error(errorMsg);
  }

  let attempts = 0;
  const maxAttempts = apiKeys.length;
  const errors = [];

  while (attempts < maxAttempts) {
    const keyIndex = (currentKeyIndex + attempts) % apiKeys.length;
    const apiKey = apiKeys[keyIndex];
    const maskedKey = apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'undefined';
    
    logEvent('info', `Attempting Gemini API call with Key Index ${keyIndex + 1}/${apiKeys.length} (${maskedKey})`, {
      keyIndex: keyIndex + 1,
      model: MODEL_NAME,
      promptSnippet: prompt.substring(0, 150) + '...'
    });

    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: MODEL_NAME,
        contents: prompt,
        config: systemInstruction ? { systemInstruction } : undefined
      });

      // Update current index to this successful key
      currentKeyIndex = keyIndex;
      logEvent('info', `Gemini API call succeeded using Key Index ${keyIndex + 1}/${apiKeys.length}`);
      return response.text;
    } catch (error) {
      const errStatus = error.status || error.statusCode || 500;
      logEvent('warn', `Gemini API call failed using Key Index ${keyIndex + 1}/${apiKeys.length}`, {
        keyIndex: keyIndex + 1,
        errorMessage: error.message,
        errorStatus: errStatus
      });
      
      errors.push({
        keyIndex: keyIndex + 1,
        message: error.message,
        status: errStatus
      });
      
      attempts++;
    }
  }

  // Determine the nature of the errors to raise an appropriate diagnostic error
  const allAuthErrors = errors.every(err => 
    err.status === 401 || 
    err.status === 403 || 
    (err.message && (
      err.message.includes("API_KEY") || 
      err.message.includes("key is invalid") || 
      err.message.includes("API key") || 
      err.message.toLowerCase().includes("auth") || 
      err.message.toLowerCase().includes("invalid key")
    ))
  );

  const anyRateLimit = errors.some(err => 
    err.status === 429 || 
    (err.message && (
      err.message.includes("429") || 
      err.message.toLowerCase().includes("quota") || 
      err.message.toLowerCase().includes("rate limit") || 
      err.message.toLowerCase().includes("resource exhausted")
    ))
  );

  let errorMsg = "All configured Gemini API keys failed.";
  let status = 500;

  if (allAuthErrors) {
    errorMsg = "Authentication failed: All configured Gemini API keys are invalid. Please check your backend/.env file.";
    status = 403;
  } else if (anyRateLimit) {
    errorMsg = "Rate limits or daily quotas exceeded on all configured keys. Please try again later.";
    status = 429;
  } else {
    const lastError = errors[errors.length - 1];
    errorMsg = `Gemini API error: ${lastError.message}`;
    status = lastError.status || 500;
  }

  logEvent('error', `All ${apiKeys.length} keys failed. Final status: ${status}. Message: ${errorMsg}`, {
    allErrors: errors
  });

  const finalError = new Error(errorMsg);
  finalError.status = status;
  throw finalError;
}

/**
 * Parses file buffer using officeparser.
 * Uses native Promise-based API for safety.
 */
async function parseFileBuffer(buffer, ext) {
  try {
    const text = await officeParser.parseOfficeAsync(buffer);
    return text;
  } catch (err) {
    logEvent('error', `Failed to parse .${ext}`, { error: err.message });
    throw new Error(`Failed to parse file. Please verify it is a valid, uncorrupted .${ext} file.`);
  }
}

/**
 * Strips markdown code fences (like ```html ... ```) from the AI's response
 */
function cleanHtmlResponse(text) {
  if (!text) return "";
  let clean = text.trim();
  if (clean.startsWith("```html")) {
    clean = clean.slice(7);
  } else if (clean.startsWith("```")) {
    clean = clean.slice(3);
  }
  if (clean.endsWith("```")) {
    clean = clean.slice(0, -3);
  }
  return clean.trim();
}

/**
 * Post-processes the generated HTML to make it fully print-safe:
 * - Removes all :hover CSS rules (multi-line aware)
 * - Programmatically deletes hover rules via injected JS (beats specificity)
 * - Strips transition, animation, cursor, transform, fixed/sticky positioning
 * - Converts fixed px heights to min-height so shape containers grow with text
 * - Does NOT set height:auto on .page (that causes page-bleed)
 * - Adds break-inside:avoid to shapes and tables
 * - Injects a final override <style> + <script> block before </body>
 */
function stripPrintUnfriendlyStyles(html) {
  if (!html) return html;

  // 1. Remove entire :hover rule blocks — multi-line aware with [\s\S]*?
  let result = html.replace(/[^{}]*:hover[^{}\n]*\{[\s\S]*?\}/gi, '');

  // 2. Remove :hover inside combined selectors  e.g.  a, a:hover { ... }
  result = result.replace(/,[^,{}]*:hover[^,{]*/gi, '');
  result = result.replace(/[^,{}]*:hover[^,{}]*,/gi, '');

  // 3. Strip individual CSS properties that are screen-only / interactive
  const interactiveProps = [
    /transition\s*:[^;]+;/gi,
    /animation\s*:[^;]+;/gi,
    /animation-[a-z-]+\s*:[^;]+;/gi,
    /cursor\s*:\s*pointer[^;]*;/gi,
    /cursor\s*:\s*hand[^;]*;/gi,
    /transform\s*:[^;]+;/gi,
    /will-change\s*:[^;]+;/gi,
    /position\s*:\s*fixed[^;]*;/gi,
    /position\s*:\s*sticky[^;]*;/gi,
  ];
  for (const re of interactiveProps) {
    result = result.replace(re, '');
  }

  // 4. Convert fixed pixel heights -> min-height so shape containers grow with text.
  //    Only targets values under 600px (shape-level). Skips mm/% (page-level).
  //    Negative lookbehind avoids touching min-height, max-height, line-height.
  result = result.replace(
    /(?<!(?:min-|max-|line-|row-))height\s*:\s*(\d+)px\s*(?=;|\})/gi,
    (match, px) => {
      const n = parseInt(px, 10);
      if (n > 0 && n < 600) return `min-height: ${px}px; height: auto`;
      return match;
    }
  );
  // Also convert fixed heights in inline style attributes
  result = result.replace(
    /(?<=style="[^"]*?)(?<!(?:min-|max-|line-|row-))height\s*:\s*(\d+)px/gi,
    (match, px) => {
      const n = parseInt(px, 10);
      if (n > 0 && n < 600) return `min-height: ${px}px; height: auto`;
      return match;
    }
  );

  // 5. Inject override <style> + JS hover-killer before </body>
  const overrideBlock = `
<style id="print-safe-overrides">
  /* ===== PRINT-SAFE OVERRIDES (injected by server) ===== */

  /* Kill interactive styles globally */
  * { transition: none !important; animation: none !important; cursor: default !important; }

  /* TEXT BLEED PREVENTION */
  h1, h2, h3, h4, h5, h6, p, li, td, th, span, div {
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    hyphens: auto !important;
    max-width: 100% !important;
  }
  h1 { font-size: min(2.8em, 56pt) !important; line-height: 1.2 !important; }
  h2 { font-size: min(1.8em, 36pt) !important; line-height: 1.3 !important; }
  h3 { font-size: min(1.3em, 26pt) !important; line-height: 1.35 !important; }

  /* PAGE BOUNDARY — do NOT set height:auto on .page (causes page-bleed) */
  .page {
    overflow: hidden !important;
    min-height: 297mm !important;
  }

  /* SHAPE CONTAINMENT — inner containers grow but .page clips at its boundary */
  .page div, .page section, .page article,
  .page aside, .page figure, .page blockquote {
    min-height: 0 !important;
    height: auto !important;
    overflow: visible !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  /* Tables must not split mid-row */
  .page table { break-inside: avoid !important; page-break-inside: avoid !important; }
  .page tr     { break-inside: avoid !important; page-break-inside: avoid !important; }

  /* Minimum readable font size (9pt = 12px for print) */
  .page div *, .page section *, .page article * { font-size: max(0.8em, 12px); }
  .page h1 { font-size: min(2.8em, 56pt) !important; }
  .page h2 { font-size: min(1.8em, 36pt) !important; }
  .page h3 { font-size: min(1.3em, 26pt) !important; }

  /* Padding inside shapes - text never touches the border */
  .page div[style*="border-radius"],
  .page div[style*="background"],
  .page div[style*="border:"],
  .page div[style*="border :"] {
    padding: max(var(--shape-pad, 0px), 10px) !important;
    box-sizing: border-box !important;
    word-break: break-word !important;
    overflow-wrap: break-word !important;
  }

  /* PRINT OVERRIDES */
  @media print {
    * { position: static !important; float: none !important; }
    .page {
      position: relative !important;
      overflow: hidden !important;
      page-break-after: always;
      break-after: page;
      min-height: 297mm !important;
      height: 297mm !important;
    }
    body { background: white !important; }
    h1, h2, h3, h4, h5, h6, p, li, td, th, span, div {
      word-break: break-word !important;
      overflow-wrap: break-word !important;
    }
    .page div, .page section, .page article {
      height: auto !important;
      overflow: visible !important;
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .page { overflow: hidden !important; }
  }
</style>

<script id="hover-killer">
/* Programmatically delete all :hover rules from live stylesheets.
   This approach beats CSS specificity — even !important .card:hover rules are deleted. */
(function() {
  try {
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      if (sheets[i].id === 'print-safe-overrides') continue;
      var rules;
      try { rules = sheets[i].cssRules || sheets[i].rules; } catch(e) { continue; }
      if (!rules) continue;
      for (var j = rules.length - 1; j >= 0; j--) {
        var rule = rules[j];
        if (rule.selectorText && rule.selectorText.indexOf(':hover') !== -1) {
          try { sheets[i].deleteRule(j); } catch(e) {}
        } else if (rule.cssRules) {
          for (var k = rule.cssRules.length - 1; k >= 0; k--) {
            var inner = rule.cssRules[k];
            if (inner.selectorText && inner.selectorText.indexOf(':hover') !== -1) {
              try { rule.deleteRule(k); } catch(e) {}
            }
          }
        }
      }
    }
  } catch(e) {}
})();
</script>
`;
  if (result.includes('</body>')) {
    result = result.replace('</body>', overrideBlock + '</body>');
  } else {
    result = result + overrideBlock;
  }

  logEvent('info', 'Post-processed HTML: stripped hover effects, fixed shape heights, and applied print-safe overrides.');
  return result;
}

/**
 * Health Check Endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    keysLoaded: apiKeys.length,
    model: MODEL_NAME
  });
});

/**
 * Debug Logs Dashboard Endpoint
 */
app.get('/api/logs', (req, res) => {
  if (req.query.clear === 'true') {
    systemLogs.length = 0;
    logEvent('info', 'Logs cleared by user.');
    return res.redirect('/api/logs');
  }

  const format = req.query.format;
  if (format === 'json') {
    return res.json(systemLogs);
  }

  const logsHtml = systemLogs.map(entry => {
    let detailsHtml = '';
    if (entry.details) {
      detailsHtml = `<pre class="details">${JSON.stringify(entry.details, null, 2)}</pre>`;
    }
    return `
      <div class="log-entry ${entry.level}">
        <span class="timestamp">${new Date(entry.timestamp).toLocaleString()}</span>
        <span class="badge badge-${entry.level}">${entry.level}</span>
        <span class="message">${entry.message}</span>
        ${detailsHtml}
      </div>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Gemini Key Rotation Debug Logs</title>
      <style>
        :root {
          --bg-color: #0f172a;
          --card-bg: #1e293b;
          --text-color: #f8fafc;
          --text-muted: #94a3b8;
          --info-color: #38bdf8;
          --warn-color: #fbbf24;
          --error-color: #f87171;
          --border-color: #334155;
        }
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: var(--bg-color);
          color: var(--text-color);
          padding: 2rem;
        }
        .container {
          max-width: 1000px;
          margin: 0 auto;
        }
        header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 2px solid var(--border-color);
          padding-bottom: 1rem;
          margin-bottom: 1.5rem;
        }
        h1 {
          margin: 0;
          font-size: 1.8rem;
          color: var(--info-color);
        }
        .actions {
          display: flex;
          gap: 10px;
        }
        .btn {
          padding: 0.5rem 1rem;
          border-radius: 6px;
          text-decoration: none;
          font-weight: 600;
          font-size: 0.9rem;
          cursor: pointer;
          border: none;
        }
        .btn-primary {
          background-color: var(--info-color);
          color: #0f172a;
        }
        .btn-danger {
          background-color: #ef4444;
          color: white;
        }
        .btn-secondary {
          background-color: var(--border-color);
          color: var(--text-color);
        }
        .log-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .log-entry {
          background-color: var(--card-bg);
          border-radius: 8px;
          padding: 1rem;
          border-left: 5px solid var(--text-muted);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        .log-entry.info {
          border-left-color: var(--info-color);
        }
        .log-entry.warn {
          border-left-color: var(--warn-color);
        }
        .log-entry.error {
          border-left-color: var(--error-color);
        }
        .timestamp {
          font-size: 0.8rem;
          color: var(--text-muted);
          display: block;
          margin-bottom: 4px;
        }
        .badge {
          display: inline-block;
          font-size: 0.75rem;
          font-weight: bold;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
          margin-right: 8px;
          vertical-align: middle;
        }
        .badge-info { background: #0369a1; color: #e0f2fe; }
        .badge-warn { background: #b45309; color: #fef3c7; }
        .badge-error { background: #991b1b; color: #fee2e2; }
        .message {
          font-size: 1rem;
          font-weight: 500;
          vertical-align: middle;
        }
        .details {
          background-color: #020617;
          border: 1px solid var(--border-color);
          border-radius: 6px;
          padding: 10px;
          margin-top: 10px;
          overflow-x: auto;
          font-size: 0.85rem;
          color: #e2e8f0;
          max-height: 250px;
        }
        .empty {
          text-align: center;
          padding: 3rem;
          color: var(--text-muted);
          background-color: var(--card-bg);
          border-radius: 8px;
          border: 2px dashed var(--border-color);
        }
      </style>
      <script>
        let autoRefresh = true;
        setInterval(() => {
          if (autoRefresh) {
            window.location.reload();
          }
        }, 10000);
      </script>
    </head>
    <body>
      <div class="container">
        <header>
          <div>
            <h1>Gemini Key Rotation Logs</h1>
            <p style="margin: 4px 0 0 0; color: var(--text-muted); font-size: 0.9rem;">
              Monitoring API health and key rotation events in real-time. (Auto-refreshes every 10s)
            </p>
          </div>
          <div class="actions">
            <button onclick="window.location.reload()" class="btn btn-secondary">Refresh</button>
            <a href="/api/logs?clear=true" class="btn btn-danger" onclick="return confirm('Clear all logs?')">Clear Logs</a>
            <a href="/api/logs?format=json" target="_blank" class="btn btn-primary">Raw JSON</a>
          </div>
        </header>
        <main>
          <div class="log-list">
            ${systemLogs.length === 0 
              ? '<div class="empty">No events logged yet. Perform a generation or revision request to populate the logs.</div>' 
              : logsHtml
            }
          </div>
        </main>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

/**
 * Screen 2 - Generate Takeaway Notes Endpoint
 */
app.post('/api/generate', upload.array('files'), async (req, res) => {
  try {
    const {
      colorScheme, contentPriorities, targetAudience,
      setting, customSetting,
      detailLevel,
      writingTheme,
      eventName, eventDate, coverInfo, additionalInstructions,
      extractEventName, extractEventDate, extractCoverInfo
    } = req.body;

    // Parse boolean flags from string ('true'/'false')
    const bExtractEventName  = extractEventName  === 'true';
    const bExtractEventDate  = extractEventDate  === 'true';
    const bExtractCoverInfo  = extractCoverInfo  === 'true';
    const bAutoExtractColor  = colorScheme === 'Auto-Extract Theme';

    const files = req.files || [];

    if (files.length === 0) {
      return res.status(400).json({ error: 'No files were uploaded.' });
    }

    // Resolve effective setting label
    const effectiveSetting = setting === 'Other' && customSetting
      ? customSetting
      : setting;

    logEvent('info', `Received generate request with ${files.length} files.`, {
      colorScheme, detailLevel, writingTheme,
      targetAudience, setting: effectiveSetting,
      bExtractEventName, bExtractEventDate, bExtractCoverInfo, bAutoExtractColor
    });

    // 1. Extract text from files in parallel
    const textExtractionPromises = files.map(file => {
      const ext = file.originalname.split('.').pop().toLowerCase();
      return parseFileBuffer(file.buffer, ext)
        .then(text => `--- FILE: ${file.originalname} ---\n${text}`)
        .catch(err => {
          logEvent('error', `Error parsing file ${file.originalname}: ${err.message}`);
          throw new Error(`Failed to parse file ${file.originalname}. Ensure it is a valid .docx or .pptx file.`);
        });
    });

    const fileTexts = await Promise.all(textExtractionPromises);
    const combinedSourceText = fileTexts.join('\n\n');

    // ── 2a. Detail Level Instruction ─────────────────────────────────────────
    const detailInstructions = {
      'Brief': 'Produce a HIGH-IMPACT, CONDENSED summary. Focus EXCLUSIVELY on the absolute core highlights, main thesis, and 3-5 key takeaways per section. Omit supporting detail and examples unless critical. Pages should be few and lean.',
      'Moderate': 'Produce a BALANCED, STANDARD summary. Cover all primary sections, speaker insights, and main slide concepts. Include supporting points where they add clarity. Standard page count appropriate to the source material.',
      'Comprehensive': 'Produce an EXHAUSTIVE, DEEP BREAKDOWN. Capture ALL terminology, definitions, explanations, formulas, step-by-step processes, context, examples, and detailed supporting notes. No important concept should be omitted. Generate as many pages as needed — there is no page cap.'
    };
    const detailInstruction = detailInstructions[detailLevel] || detailInstructions['Moderate'];

    // ── 2b. Vibe Theme Visual Design Rules ──────────────────────────────────
    const vibeThemeRules = {
      'Warm & Encouraging': `
        TYPOGRAPHY: Use Google Fonts "Nunito" (rounded, friendly) for headings and "Lato" for body. H1: oversized (2.5em+), bold, warm-toned. H2: 1.4em, semi-bold. Body text: 1em, generous line-height 1.7.
        SHAPES & CONTAINERS: Use soft rounded rectangles (border-radius: 20-30px) for content cards. Add organic wave SVG dividers between sections. Use gentle pastel fills (peach, lavender, soft orange) for callout boxes.
        INFOGRAPHICS: Break key points into "Encouragement Cards" with a large emoji/icon and short motivational statement. Use side-by-side two-column layouts for tips. Add "Remember This!" callout bubbles with a speech-bubble shape using CSS clip-path or border tricks.
        COLOR PALETTE: Warm amber (#f97316), soft peach (#fed7aa), light cream (#fffbeb), with dark chocolate (#1c1917) for text.
      `,
      'Formal & Professional': `
        TYPOGRAPHY: Use Google Fonts "Inter" (crisp, geometric) for both headings and body. H1: bold 2em, all-caps with letter-spacing 0.08em. H2: 1.3em, medium weight, thin bottom border. Body: 0.95em, tight line-height 1.5.
        SHAPES & CONTAINERS: Use sharp-edged rectangles (border-radius: 4px max) for all content blocks. Apply crisp thin 1px borders (#334155) on cards. Use a strict grid layout with clear column separators.
        INFOGRAPHICS: Use structured data tables with alternating row shading. Add numbered list badges (e.g. "01.", "02.") for ordered points. Use thin horizontal rules to separate all sections.
        COLOR PALETTE: Deep slate (#1e293b), cool grey (#64748b), white (#ffffff), and a single corporate accent (e.g. #2563eb or #0f172a).
      `,
      'Fun & Energetic': `
        TYPOGRAPHY: Use Google Fonts "Poppins" (bold) for H1 and "Comic Neue" or "Fredoka One" for subheadings. H1: massive, 3em+, heavy weight, rotated slightly or with an underline squiggle. H2: 1.5em, bold, colourful.
        SHAPES & CONTAINERS: Use asymmetrical card shapes with heavy drop-shadows (box-shadow: 8px 8px 0px #000). Add squiggly or wavy borders using SVG. Use triangular accent shapes in corners. Mix background colours per section (never plain white).
        INFOGRAPHICS: Use large "Stat Badges" (big number + descriptor). Add "Did You Know?" callout boxes with a starburst or explosion shape. Use icon-heavy bullet points. Add confetti or star decorative elements.
        COLOR PALETTE: Hot pink (#ec4899), electric yellow (#facc15), deep purple (#7c3aed), bright teal (#06b6d4) on a near-white or light grey base.
      `,
      'Reflective & Thoughtful': `
        TYPOGRAPHY: Use Google Fonts "Playfair Display" (elegant serif) for H1 headings and "Source Serif 4" or "Georgia" for body. H1: 2.2em, italic, generous margins. H2: 1.2em, small-caps. Body: 1em, wide line-height 1.8, ample paragraph spacing.
        SHAPES & CONTAINERS: Minimalist fine-line borders (1px solid #d1d5db). Extra-wide padding (30-40px) inside content blocks. Ample negative/blank space between sections. No heavy backgrounds — white or very light grey only.
        INFOGRAPHICS: Use pull-quote blocks (large left-border accent line + italic quote text). Add "Pause & Reflect" prompts in bordered aside boxes. Use sparse, refined iconography. Avoid heavy infographic elements.
        COLOR PALETTE: Soft sage (#d1fae5), warm off-white (#fafaf9), medium grey (#6b7280), and one contemplative accent like forest green (#059669) or dusty blue (#7c9eb2).
      `,
      'Educational & Informative': `
        TYPOGRAPHY: Use Google Fonts "Roboto" for body text and "Roboto Slab" or "DM Sans" for headings. H1: bold 2em with a coloured underline. H2: 1.3em with a numbered prefix badge. Body: 0.95em, clear 1.6 line-height.
        SHAPES & CONTAINERS: Use connected flowchart-style containers for sequential content (use CSS border + pseudo-element arrows). Use grid blocks with labelled headers for each content area. Use process arrows (→) between steps. Add "Key Term" definition boxes with a left-coloured border.
        INFOGRAPHICS: Use side-by-side comparison tables. Add process flow diagrams (Step 1 → Step 2 → Step 3) using CSS flexbox boxes with connector arrows. Include "Key Concept" and "Example" callout boxes with distinct background colours.
        COLOR PALETTE: Academic blue (#2563eb), knowledge gold (#f59e0b), white (#ffffff), with light blue section backgrounds (#eff6ff).
      `,
      'Motivational & Inspiring': `
        TYPOGRAPHY: Use Google Fonts "Montserrat" (tall, bold) for H1 — extreme weight (900), all-caps, with a gradient or coloured fill. Use "Open Sans" for body. H1: 2.8em+, all-caps. H2: 1.4em, bold, coloured. Body: 1em, 1.6 line-height.
        SHAPES & CONTAINERS: Use forward-slashing diagonal panel dividers (CSS clip-path: polygon) between sections. Add upward-pointing chevron shapes above key sections. Use milestone timeline flags for sequential content. Backgrounds should have bold gradient fills per section.
        INFOGRAPHICS: Use large "Hero Numbers" (giant stat + descriptor) to highlight key metrics. Add milestone banners ("Goal 1", "Goal 2") in a horizontal ribbon layout. Use upward arrow motifs (▲) for progress. Bold "Call to Action" buttons or boxes at the end of each page.
        COLOR PALETTE: Deep purple (#7c3aed), electric indigo (#4f46e5), vibrant gold (#fbbf24), and white on bold dark backgrounds.
      `
    };
    const vibeInstruction = vibeThemeRules[writingTheme] || vibeThemeRules['Formal & Professional'];

    // ── 2c. AI-Extract metadata block ────────────────────────────────────────
    let extractionInstructions = '';
    if (bExtractEventName || bExtractEventDate || bExtractCoverInfo) {
      extractionInstructions = `
AI EXTRACTION INSTRUCTIONS:
The following fields should be AUTO-EXTRACTED from the source material (do not leave them blank):
${bExtractEventName  ? '- EVENT NAME: Scan the source for the event or session title and use it as the document/cover title.' : ''}
${bExtractEventDate  ? '- EVENT DATE & TIME: Scan the source for any date or time references and include them on the cover page.' : ''}
${bExtractCoverInfo  ? '- COVER PEOPLE/BRANDING: Scan for speaker names, organisation names, or logos mentioned in the source and feature them prominently on the cover.' : ''}
`;
    }

    // ── 2d. Manually-provided metadata block ─────────────────────────────────
    const metadataBlock = [
      !bExtractEventName  && eventName  ? `- Event / Session Name: ${eventName}` : '',
      !bExtractEventDate  && eventDate  ? `- Date & Time: ${eventDate}` : '',
      !bExtractCoverInfo  && coverInfo  ? `- Cover / Branding: ${coverInfo}` : '',
      additionalInstructions ? `- Additional Instructions: ${additionalInstructions}` : ''
    ].filter(Boolean).join('\n');

    // ── 2e. Auto-Extract Colour instruction ───────────────────────────────────
    const colorInstruction = bAutoExtractColor
      ? `Intelligently analyse the source material structure (especially slide titles, headers, and any colour references mentioned) and select a harmonious primary colour palette that best reflects the content's visual identity. Apply these extracted colours throughout the HTML <style> block.`
      : `Design the page using a modern, harmonious colour scheme matching this vibe: "${colorScheme}". Use appropriate background, font, card, and border colours.`;

    // ── 3. Build system instruction ──────────────────────────────────────────
    const systemInstruction =
      "You are an expert content designer and summary publisher. " +
      "Your goal is to transform raw presentation slides or speaker notes into an elegant, high-impact, standalone HTML/CSS takeaway summary. " +
      "You must return ONLY valid, self-contained HTML (including full CSS styled inside a <style> block in the <head>). " +
      "Your output must structure the takeaway notes page-by-page using A4 dimensions. Each page must be wrapped in a <div class=\"page\">...</div> container. " +
      "Under no circumstances should any element inside the document have scrollbars or scrollable overflow (do NOT use overflow: scroll, overflow: auto, or overflow-y: auto on code blocks, tables, panels, or boxes). All content must be fully visible and wrap naturally. " +
      "Do NOT wrap the output in markdown backticks or include any text outside the <html> tags.";

    const prompt = `
Task: Generate an elegant, themed takeaway notes document from the source text below.

--- Source Text ---
${combinedSourceText}
-------------------

Core Preferences:
- Colour Scheme: ${colorInstruction}
- Content Priorities & Key Highlights: Focus heavily on ${contentPriorities}
- Primary Audience: ${targetAudience}
- Setting / Context: Optimised for ${effectiveSetting}
- Tone & Formatting Style: Intelligently infer the most appropriate tone and formatting style based on the combination of the primary audience (${targetAudience}), the setting (${effectiveSetting}), and the writing vibe & theme (${writingTheme}). Do not use a generic style — tailor it precisely.

Detail Level Instruction:
${detailInstruction}

${metadataBlock ? `Event Metadata:\n${metadataBlock}\n` : ''}
${extractionInstructions}

Vibe Theme Design Rules — APPLY THESE EXACTLY for the "${writingTheme}" theme:
${vibeInstruction}

General Design Requirements:
1. Make the layout look like a premium, professional A4 PDF report or slide handout. It must look absolutely stunning.
2. Structure the document page-by-page by wrapping each page's content in a <div class="page">...</div> element. Split the summary logically across pages if it is long.
3. Inside the <style> block, define the page container for screen and printing:
   .page {
     width: 210mm;
     min-height: 297mm;
     padding: 20mm;
     margin: 0 auto 20px auto;
     background: white;
     color: #0f172a;
     box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1);
     box-sizing: border-box;
     page-break-after: always;
     position: relative;
     overflow: hidden;
   }
4. Apply CSS print styling so that when printed or saved as PDF, the grey background disappears and only the A4 pages are saved:
   @media print {
     @page { size: A4; margin: 0; }
     body { background: white !important; margin: 0 !important; padding: 0 !important; }
     .page { margin: 0 !important; box-shadow: none !important; width: 210mm !important; height: 297mm !important; }
   }
5. CRITICAL: Under no circumstances should any element inside the document have scrollbars or scrollable overflow (no 'overflow: scroll', 'overflow: auto', or 'overflow-y: auto' are allowed on tables, code blocks, or custom boxes). All content must be fully visible and fit or wrap naturally within the page dimensions. If content is too long, wrap it onto another A4 page.
6. PRINT-SAFE — NO HOVER EFFECTS: Do NOT use any :hover CSS pseudo-class anywhere in the document. Do NOT use transition, animation, cursor: pointer, or any interactive style. The document must look identical whether the mouse is hovering or not.
7. NO OVERLAPPING CONTENT: All elements must be laid out in normal document flow. Do not use position: fixed or position: sticky. If you use position: absolute, ensure the parent container has sufficient height so nothing overlaps the content below it. Every word and heading must be fully visible — nothing should be clipped, hidden, or partially covered.
8. PREVENT TEXT BLEEDING: All heading elements (h1, h2, h3) must include 'word-break: break-word; overflow-wrap: break-word; max-width: 100%;' in their CSS. Do NOT use font sizes larger than 2.8em for h1, 1.8em for h2, or 1.3em for h3. The .page container has 'overflow: hidden' — any text that is too large will be clipped. Ensure all text fits comfortably within the 210mm page width with padding accounted for.
9. SHAPE CONTAINMENT — TEXT MUST FIT INSIDE SHAPES: Every visual shape (callout box, card, badge, stat block, bubble, banner) MUST be sized to contain its text content. Rules:
   a. NEVER use a fixed 'height' on a shape container. ALWAYS use 'min-height' so it can expand if text is longer than expected.
   b. Give all shape containers at least 12px of padding on all sides so text never touches the border or edge of the shape.
   c. Text inside shapes must use 'font-size' of at least 12px (9pt). Never go smaller than this for print readability.
   d. If a shape is a fixed-width column or badge, the font-size should automatically scale down using 'clamp(12px, 1.5vw, 1em)' or similar to fit, rather than overflowing.
   e. Every shape's CSS must include: 'box-sizing: border-box; overflow: visible; word-wrap: break-word;'
   f. Do NOT layer shapes on top of each other using absolute positioning unless the parent container is explicitly sized to contain them both without overlap.
10. Return ONLY the HTML code. No markdown wrapper.
`;

    // 4. Call AI with rotation
    const rawAiResponse = await generateContentWithRotation(prompt, systemInstruction);
    const cleanHTML = stripPrintUnfriendlyStyles(cleanHtmlResponse(rawAiResponse));

    res.json({ html: cleanHTML });

  } catch (error) {
    logEvent('error', `Generate request failed`, { message: error.message, status: error.status });
    const status = error.status || 500;
    res.status(status).json({
      error: status === 429 ? 'rate_limit_exceeded' : 'error',
      message: error.message || 'An error occurred during generation.'
    });
  }
});


/**
 * Screen 3 - Revise Takeaway Notes Endpoint
 */
app.post('/api/revise', async (req, res) => {
  try {
    const { currentHtml, instructions, preferences } = req.body;

    if (!currentHtml || !instructions) {
      return res.status(400).json({ error: 'Missing currentHtml or revision instructions.' });
    }

    logEvent('info', `Received revision command: "${instructions}"`);

    const systemInstruction =
      "You are an expert web designer and editor. " +
      "Your task is to take an existing self-contained HTML/CSS summary document and modify it according to the user's revision instructions. " +
      "You must preserve the page-by-page A4 structure of the document (where each page is wrapped in a <div class=\"page\">...</div> container). " +
      "Ensure that no elements inside the document have scrollbars or scrollable overflow (do NOT use overflow: scroll or overflow: auto on tables, code blocks, etc.). All content must be fully visible and wrap naturally. " +
      "CRITICAL: Do NOT use :hover CSS pseudo-classes, transitions, animations, or cursor: pointer anywhere. The document must be fully print-safe with no interactive styles. " +
      "CRITICAL: Do NOT use position: fixed or position: sticky. Avoid absolute positioning that could cause content to overlap. All content must be fully visible with nothing clipped or hidden. " +
      "You must return ONLY the updated self-contained HTML page (with inline CSS in <style> blocks). " +
      "Do NOT add markdown code fences (like ```html) and do NOT change the core structure of the notes unless requested. Keep the styling premium.";

    const prompt = `
User Revision Instruction: "${instructions}"

Here is the current HTML/CSS document:
------------------
${currentHtml}
------------------

Preferences Context (for reference):
${JSON.stringify(preferences || {})}

Please update the HTML/CSS code to implement the user's instructions, ensuring the page-by-page A4 layout (.page wrappers) is maintained. Keep all content unless the user asked to remove it. Return ONLY the final revised HTML code.
`;

    const rawAiResponse = await generateContentWithRotation(prompt, systemInstruction);
    const cleanHTML = stripPrintUnfriendlyStyles(cleanHtmlResponse(rawAiResponse));

    res.json({ html: cleanHTML });

  } catch (error) {
    logEvent('error', `Revision request failed`, { message: error.message, status: error.status });
    const status = error.status || 500;
    res.status(status).json({ 
      error: status === 429 ? 'rate_limit_exceeded' : 'error', 
      message: error.message || 'An error occurred during revision.' 
    });
  }
});

app.listen(PORT, () => {
  logEvent('info', `Backend server running on http://localhost:${PORT}`);
});
