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
async function generateContentWithRotation(prompt, systemInstruction, extraConfig = {}) {
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
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          ...extraConfig
        }
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
 * Strips markdown code fences (like ```json ... ```) and parses the JSON safely
 */
function cleanAndParseJson(text) {
  if (!text) return null;
  let clean = text.trim();
  if (clean.startsWith("```json")) {
    clean = clean.substring(7);
  } else if (clean.startsWith("```")) {
    clean = clean.substring(3);
  }
  if (clean.endsWith("```")) {
    clean = clean.substring(0, clean.length - 3);
  }
  return JSON.parse(clean.trim());
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
      extractEventName, extractEventDate, extractCoverInfo,
      strictFileContentOnly
    } = req.body;

    const bExtractEventName  = extractEventName  === 'true';
    const bExtractEventDate  = extractEventDate  === 'true';
    const bExtractCoverInfo  = extractCoverInfo  === 'true';
    const bAutoExtractColor  = colorScheme === 'Auto-Extract Theme';
    const bStrictFileContentOnly = strictFileContentOnly === 'true';

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files were uploaded.' });

    const effectiveSetting = setting === 'Other' && customSetting ? customSetting : setting;

    logEvent('info', `Received generate request with ${files.length} files.`, {
      colorScheme, detailLevel, writingTheme,
      targetAudience, setting: effectiveSetting,
      bExtractEventName, bExtractEventDate, bExtractCoverInfo, bAutoExtractColor, bStrictFileContentOnly
    });

    const textExtractionPromises = files.map(file => {
      const ext = file.originalname.split('.').pop().toLowerCase();
      return parseFileBuffer(file.buffer, ext)
        .then(text => `--- FILE: ${file.originalname} ---\n${text}`)
        .catch(err => {
          logEvent('error', `Error parsing file ${file.originalname}: ${err.message}`);
          throw new Error(`Failed to parse file ${file.originalname}.`);
        });
    });

    const fileTexts = await Promise.all(textExtractionPromises);
    const combinedSourceText = fileTexts.join('\n\n');

    const detailInstructions = {
      'Brief': 'Produce a HIGH-IMPACT, CONDENSED summary. Focus EXCLUSIVELY on the absolute core highlights, main thesis, and 3-5 key takeaways per section.',
      'Moderate': 'Produce a BALANCED, STANDARD summary. Cover all primary sections, speaker insights, and main slide concepts.',
      'Comprehensive': 'Produce an EXHAUSTIVE, DEEP BREAKDOWN. Capture ALL terminology, definitions, explanations, formulas, and detailed supporting notes.'
    };
    const detailInstruction = detailInstructions[detailLevel] || detailInstructions['Moderate'];

    const vibeThemeRules = {
      'Warm & Encouraging': 'Use Google Fonts "Nunito" (rounded) and "Lato". Soft rounded rectangles (border-radius: 20-30px). Warm amber, peach, cream.',
      'Formal & Professional': 'Use Google Fonts "Inter". Sharp-edged rectangles (border-radius: 4px). Slate, grey, white.',
      'Fun & Energetic': 'Use Google Fonts "Poppins". Asymmetrical card shapes, heavy drop-shadows. Hot pink, electric yellow, deep purple.',
      'Reflective & Thoughtful': 'Use Google Fonts "Playfair Display" and "Source Serif 4". Minimalist fine-line borders. Sage, off-white, forest green.',
      'Educational & Informative': 'Use Google Fonts "Roboto" and "Roboto Slab". Flowchart-style containers, grid blocks. Academic blue, gold, white.',
      'Motivational & Inspiring': 'Use Google Fonts "Montserrat". Forward-slashing diagonal dividers. Deep purple, indigo, vibrant gold.'
    };
    const vibeInstruction = vibeThemeRules[writingTheme] || vibeThemeRules['Formal & Professional'];

    let extractionInstructions = '';
    if (bExtractEventName || bExtractEventDate || bExtractCoverInfo) {
      extractionInstructions = `AI EXTRACTION: Scan source for: ${bExtractEventName ? 'Event Name, ' : ''}${bExtractEventDate ? 'Event Date, ' : ''}${bExtractCoverInfo ? 'Speaker/Branding.' : ''}`;
    }

    const metadataBlock = [
      !bExtractEventName  && eventName  ? `- Event Name: ${eventName}` : '',
      !bExtractEventDate  && eventDate  ? `- Date: ${eventDate}` : '',
      !bExtractCoverInfo  && coverInfo  ? `- Branding: ${coverInfo}` : '',
      additionalInstructions ? `- Instructions: ${additionalInstructions}` : ''
    ].filter(Boolean).join('\n');

    const colorInstruction = bAutoExtractColor ? 'Analyze source material and select a harmonious primary color palette.' : `Design using theme "${colorScheme}".`;

    // ── STAGE 1: Blueprint Prompts ─────────────────────────────────────────
    logEvent('info', 'Executing Stage 1: Planning page-by-page layout blueprint...');

    const blueprintSystemInstruction = 
      "You are an expert layout designer. Design a JSON array of page plan objects. Total words per page <= 250. Return ONLY raw JSON. " +
      "CRITICAL: You must strictly preserve and adopt all slide titles, slide headers, subheaders, and section headings exactly as they appear in the source files (PPTX slide titles take top priority, DOCX headers and subheaders take second priority). Do NOT invent new headers, combine slides under arbitrary new sections, or reorganize the flow. " +
      (bStrictFileContentOnly 
        ? "CRITICAL FACTS: Summarize ONLY information explicitly stated in the source text. Do NOT hallucinate background facts, introduce pre-trained knowledge, definitions, external history, or context not written in the files. If it is not in the text, it does not exist."
        : "You may supplement the notes with external definitions, examples, and background context if helpful for explaining the slide topics.");

    const blueprintPrompt = `Task: Design a page-by-page visual blueprint. Source: ${combinedSourceText.substring(0, 150000)}. Preferences: ${writingTheme}, ${detailLevel}. Metadata: ${metadataBlock}. ${extractionInstructions}. JSON Schema: [{"pageNumber", "pageType", "pageTitle", "sections": [{"elementId", "elementType", "title", "topicsToCover", "wordBudget", "layoutStylingDetails"}]}].`;

    let blueprintText = await generateContentWithRotation(blueprintPrompt, blueprintSystemInstruction, { responseMimeType: "application/json" });
    let blueprintJSON = cleanAndParseJson(blueprintText);

    // ── STAGE 2: HTML Generation Prompts ───────────────────────────────────
    logEvent('info', 'Executing Stage 2: Drafting HTML summary...');

    const htmlSystemInstruction = 
      "Create standalone HTML/CSS notes strictly following the blueprint. Use A4 dimensions. NO overflow/scrollbars. NO hover/:hover. Return ONLY raw HTML. " +
      "CRITICAL: You must strictly preserve all slide titles, slide headers, subheaders, and section headings exactly as they appear in the source files (PPTX slide titles take top priority, DOCX headers take second priority). Do NOT invent new headers, rename slides, or merge unrelated topics under new titles. " +
      (bStrictFileContentOnly
        ? "CRITICAL FACTS: Summarize ONLY information explicitly stated in the source text. Do NOT hallucinate background facts, introduce pre-trained knowledge, definitions, or context not written in the files."
        : "You may supplement the notes with external definitions, examples, and background context if helpful for explaining the slide topics.");

    const htmlPrompt = `Task: Generate notes per blueprint: ${JSON.stringify(blueprintJSON)}. Theme: ${vibeInstruction}. Color: ${colorInstruction}. Requirements: A4 container (.page), print-safe styles, no hover, no overflow.`;

    let htmlDraft = await generateContentWithRotation(htmlPrompt, htmlSystemInstruction);

    // ── STAGE 3: HTML Validation Prompts ───────────────────────────────────
    logEvent('info', 'Executing Stage 3: Running HTML validation...');
    const validatorSystemInstruction = "Fix all overflow, print-safety (no hover/transitions), and CSS containment violations. Return ONLY corrected HTML.";
    const validatorPrompt = `Inspect for violations: fixed heights, overflow, hover/transitions, absolute overlap. Fix and return cleaned code.\n\n${cleanHtmlResponse(htmlDraft)}`;
    let htmlValidated = await generateContentWithRotation(validatorPrompt, validatorSystemInstruction);

    res.json({ html: stripPrintUnfriendlyStyles(cleanHtmlResponse(htmlValidated)) });

  } catch (error) {
    logEvent('error', `Generate failed: ${error.message}`);
    res.status(error.status || 500).json({ error: error.status === 429 ? 'rate_limit_exceeded' : 'error' });
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

    // ==========================================
    // REVISION STAGE 1: DIRECT REVISION
    // ==========================================
    logEvent('info', 'Executing Revision Stage 1: Applying user revisions...');

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

    // ==========================================
    // REVISION STAGE 2: REVISION VALIDATION
    // ==========================================
    logEvent('info', 'Executing Revision Stage 2: Running HTML/CSS validation and linter...');

    const validatorSystemInstruction =
      "You are a strict CSS/HTML QA engineer and code linter. " +
      "Your task is to analyze the self-contained HTML/CSS code and fix any design or print-safety violations. " +
      "You must return ONLY the corrected, clean self-contained HTML/CSS document. Do NOT wrap in markdown backticks.";

    const validatorPrompt = `
Task: Inspect the generated HTML/CSS code below for any formatting, overflow, page-bleeding, or print-safety violations, and output a corrected, fully safe version.

--- HTML/CSS Code to Inspect ---
${cleanHtmlResponse(rawAiResponse)}
--------------------------------

Checklist of violations you MUST correct if present:
1. FIXED HEIGHTS: Any container inside a page (like .card, .callout, .badge, .container, .sidebar, div) that has a fixed "height: Xpx" or "height: Xrem". You MUST convert it to "min-height: Xpx; height: auto" so the shape expands with text.
2. TEXT OVERFLOW: Any heading, paragraph, list item, or span that does not have "word-break: break-word; overflow-wrap: break-word;". Ensure these are added to prevent text bleeding out of the A4 page.
3. HOVER / TRANSITIONS: If you see any ":hover" pseudo-class, transition property, animation, cursor: pointer, transform-on-hover, or absolute fixed/sticky positions, you MUST remove them.
4. ABSOLUTE POSITIONING OVERLAPS: If "position: absolute" is used, ensure it is only for decorative accents. If text containers are positioned absolutely, convert them to flex/grid document flow so they do not overlap.
5. CONTAINER PADDING: Ensure shape containers with borders or background fills have at least 12px of padding so text never touches the container borders.
6. A4 PAGE OVERFLOW: If a page container has a style that makes it grow beyond 297mm (such as height: auto or overflow: visible), ensure the page container has a strict A4 styling with overflow: hidden.

Return ONLY the final corrected HTML/CSS code. Do NOT add markdown code fences (like \`\`\`html) or any conversational text.
`;

    let htmlValidated = await generateContentWithRotation(validatorPrompt, validatorSystemInstruction);
    const cleanHTML = stripPrintUnfriendlyStyles(cleanHtmlResponse(htmlValidated));

    res.json({ html: cleanHTML });

  } catch (error) {
    logEvent('error', `Revision request failed: ${error.message}`);
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
