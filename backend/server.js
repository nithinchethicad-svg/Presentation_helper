const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const officeParser = require('officeparser');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs = require('fs');
const { harvestMedia } = require('./utils/mediaHarvester');
const { analyzeSlides } = require('./utils/slideAnalyzer');
const { compileDocument } = require('./utils/htmlCompiler');
const { AsyncLocalStorage } = require('async_hooks');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Session Helpers
function generateSystemSessionId() {
  const now = new Date();
  const dateStr = now.toISOString().substring(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().substring(11, 19).replace(/:/g, '');
  const msStr = now.getMilliseconds().toString().padStart(3, '0');
  const randomStr = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `system_${dateStr}_${timeStr}_${msStr}${randomStr}`;
}

function generateGuestSessionId() {
  const now = new Date();
  const dateStr = now.toISOString().substring(0, 10).replace(/-/g, '');
  const timeStr = now.toISOString().substring(11, 19).replace(/:/g, '');
  const randomStr = Math.random().toString(36).substring(2, 14).padEnd(12, '0');
  return `anon_${dateStr}_${timeStr}_${randomStr}`;
}

const serverStartupSessionId = generateSystemSessionId();

// Session Middleware using AsyncLocalStorage
const sessionLocalStorage = new AsyncLocalStorage();
app.use((req, res, next) => {
  const sessionId = req.header('x-session-id') || generateGuestSessionId();
  const latencyBudget = req.header('x-latency-budget') || (req.body && req.body.latencyBudget);
  
  // Distinguish between user requests and system usage (devtools, playground, ab-testing, etc.)
  const isSystem = req.path.startsWith('/api/devtools');
  const initiator = isSystem ? 'system' : 'user';

  sessionLocalStorage.run({ sessionId, latencyBudget, initiator }, () => {
    next();
  });
});

// Secure Request Logger Middleware
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    const store = sessionLocalStorage.getStore();
    const sessionId = store ? store.sessionId : 'unknown';
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
    logEvent('info', `HTTP ${req.method} ${req.path} [IP: ${clientIp}]`);
  }
  next();
});

// Serve extracted presentation images statically
app.use('/extracted_media', express.static(path.join(__dirname, 'public/extracted_media')));
app.use('/fonts', express.static(path.join(__dirname, 'templates/fonts')));
app.use('/templates', express.static(path.join(__dirname, 'templates')));

// Set up Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Disabled keys local persistent file path (Option B)
const disabledKeysPath = path.join(__dirname, 'disabled_keys.json');

function loadDisabledKeys() {
  try {
    if (fs.existsSync(disabledKeysPath)) {
      const data = JSON.parse(fs.readFileSync(disabledKeysPath, 'utf8'));
      if (Array.isArray(data)) {
        return {
          disabledKeys: data,
          disabledModels: {},
          manualKeyStates: {},
          manualModelStates: {}
        };
      }
      const disabledKeys = data.disabledKeys || [];
      const disabledModels = data.disabledModels || {};
      // NEW: Load manual override states for keys and models
      const manualKeyStates = data.manualKeyStates || {};
      const manualModelStates = data.manualModelStates || {};
      
      const normalizedModels = {};
      for (const keyId in disabledModels) {
        if (Array.isArray(disabledModels[keyId])) {
          normalizedModels[keyId] = {};
          disabledModels[keyId].forEach(model => {
            normalizedModels[keyId][model] = 'manual_off';
          });
        } else {
          normalizedModels[keyId] = disabledModels[keyId];
        }
      }
      
      return {
        disabledKeys,
        disabledModels: normalizedModels,
        manualKeyStates,
        manualModelStates
      };
    }
  } catch (e) {
    console.error('Failed to load disabled_keys.json:', e.message);
  }
  return { disabledKeys: [], disabledModels: {}, manualKeyStates: {}, manualModelStates: {} };
}

function saveDisabledKeys(data) {
  try {
    fs.writeFileSync(disabledKeysPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save disabled_keys.json:', e.message);
  }
}

function saveDisabledKeysAndModels() {
  const disabledKeys = apiKeysPool.filter(k => !k.enabled).map(k => k.id);
  const disabledModels = {};
  // NEW: Persist manual override states separately so they survive restarts
  const manualKeyStates = {};
  const manualModelStates = {};

  apiKeysPool.forEach(k => {
    const modelStates = {};
    for (const modelName in k.modelEnabled) {
      const state = k.modelEnabled[modelName];
      if (state !== 'active') {
        modelStates[modelName] = state;
      }
    }
    if (Object.keys(modelStates).length > 0) {
      disabledModels[k.id] = modelStates;
    }
    // Record key-level manual override
    if (k.manualKeyState) {
      manualKeyStates[k.id] = k.manualKeyState;
    }
    // Record model-level manual overrides (manual_off states)
    const manualModels = {};
    for (const modelName in k.modelEnabled) {
      if (k.modelEnabled[modelName] === 'manual_off') {
        manualModels[modelName] = 'manual_off';
      }
    }
    if (Object.keys(manualModels).length > 0) {
      manualModelStates[k.id] = manualModels;
    }
  });
  saveDisabledKeys({ disabledKeys, disabledModels, manualKeyStates, manualModelStates });
}

// Cost & Usage tracking file paths and states
const USAGE_HISTORY_FILE = path.join(__dirname, 'usage_history.json');
const MONTHLY_AGGREGATES_FILE = path.join(__dirname, 'monthly_aggregates.json');

let usageHistory = [];
let monthlyAggregates = {};
let pricingRates = {};

// Load pricing configurations
try {
  const pricingDefaultsPath = path.join(__dirname, 'pricing_defaults.json');
  if (fs.existsSync(pricingDefaultsPath)) {
    pricingRates = JSON.parse(fs.readFileSync(pricingDefaultsPath, 'utf8'));
  } else {
    // Hardcoded fallback
    pricingRates = {
      "gemini-3.5-flash": { "inputCostPerM": 1.50, "outputCostPerM": 9.00, "cacheReadDiscountRate": 0.90 },
      "gemini-3.1-pro-preview": { "inputCostPerM": 2.00, "outputCostPerM": 12.00, "cacheReadDiscountRate": 0.90 },
      "gemini-3.1-pro": { "inputCostPerM": 2.00, "outputCostPerM": 12.00, "cacheReadDiscountRate": 0.90 },
      "gemini-3.1-flash-lite": { "inputCostPerM": 0.25, "outputCostPerM": 1.50, "cacheReadDiscountRate": 0.90 },
      "gemini-2.5-pro": { "inputCostPerM": 1.25, "outputCostPerM": 10.00, "cacheReadDiscountRate": 0.90 },
      "gemini-2.5-flash": { "inputCostPerM": 0.30, "outputCostPerM": 2.50, "cacheReadDiscountRate": 0.90 },
      "gemini-2.5-flash-lite": { "inputCostPerM": 0.10, "outputCostPerM": 0.40, "cacheReadDiscountRate": 0.00 }
    };
  }
} catch (e) {
  console.error('Failed to load pricing configurations:', e.message);
}

// Exchange rate variables
let cachedExchangeRate = 83.5; // default fallback USD to INR
let lastExchangeRateFetchTime = 0;

async function getExchangeRate() {
  const now = Date.now();
  // Fetch new rate every 24 hours
  if (now - lastExchangeRateFetchTime > 24 * 60 * 60 * 1000) {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD');
      if (response.ok) {
        const data = await response.json();
        if (data && data.rates && data.rates.INR) {
          cachedExchangeRate = data.rates.INR;
          lastExchangeRateFetchTime = now;
          logEvent('info', `Successfully updated currency exchange rate. 1 USD = ${cachedExchangeRate} INR`);
        }
      }
    } catch (err) {
      console.error('Failed to fetch exchange rate, using cached default:', err.message);
    }
  }
  return cachedExchangeRate;
}

function loadUsageData() {
  try {
    if (fs.existsSync(USAGE_HISTORY_FILE)) {
      usageHistory = JSON.parse(fs.readFileSync(USAGE_HISTORY_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load usage_history.json:', e.message);
  }

  try {
    if (fs.existsSync(MONTHLY_AGGREGATES_FILE)) {
      monthlyAggregates = JSON.parse(fs.readFileSync(MONTHLY_AGGREGATES_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load monthly_aggregates.json:', e.message);
  }
}

function saveUsageHistoryFile() {
  try {
    fs.writeFileSync(USAGE_HISTORY_FILE, JSON.stringify(usageHistory, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save usage_history.json:', e.message);
  }
}

function saveMonthlyAggregatesFile() {
  try {
    fs.writeFileSync(MONTHLY_AGGREGATES_FILE, JSON.stringify(monthlyAggregates, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save monthly_aggregates.json:', e.message);
  }
}

function recordUsage(sessionId, subTask, endpoint, modelName, inputTokens, outputTokens, cachedTokensRead, latencyMs) {
  const modelKey = modelName.toLowerCase();
  let modelPricing = pricingRates[modelKey];
  if (!modelPricing) {
    const foundKey = Object.keys(pricingRates).find(k => modelKey.startsWith(k));
    if (foundKey) {
      modelPricing = pricingRates[foundKey];
    } else {
      modelPricing = pricingRates["gemini-3.5-flash"];
    }
  }

  const normalInputTokens = Math.max(0, inputTokens - cachedTokensRead);
  const normalInputCost = (normalInputTokens / 1000000) * modelPricing.inputCostPerM;
  const cacheReadCost = (cachedTokensRead / 1000000) * modelPricing.inputCostPerM * (1.0 - modelPricing.cacheReadDiscountRate);
  const outputCost = (outputTokens / 1000000) * modelPricing.outputCostPerM;
  const itemCost = normalInputCost + cacheReadCost + outputCost;
  const savings = (cachedTokensRead / 1000000) * modelPricing.inputCostPerM * modelPricing.cacheReadDiscountRate;

  const now = new Date();
  const timestamp = now.toISOString();

  const store = sessionLocalStorage.getStore();
  const initiator = store ? store.initiator : 'system';

  let sessionRecord = usageHistory.find(s => s.sessionId === sessionId);
  if (!sessionRecord) {
    sessionRecord = {
      sessionId: sessionId,
      startTime: timestamp,
      endTime: timestamp,
      durationMs: 0,
      totalCost: 0,
      savingsFromCaching: 0,
      modelsUsed: [],
      aggregates: {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokensRead: 0
      },
      items: [],
      initiator: initiator
    };
    usageHistory.unshift(sessionRecord);
  }

  sessionRecord.endTime = timestamp;
  const start = new Date(sessionRecord.startTime).getTime();
  const end = new Date(sessionRecord.endTime).getTime();
  sessionRecord.durationMs = Math.max(0, end - start);
  sessionRecord.totalCost += itemCost;
  sessionRecord.savingsFromCaching += savings;
  if (!sessionRecord.modelsUsed.includes(modelName)) {
    sessionRecord.modelsUsed.push(modelName);
  }
  sessionRecord.aggregates.inputTokens += inputTokens;
  sessionRecord.aggregates.outputTokens += outputTokens;
  sessionRecord.aggregates.cachedTokensRead += cachedTokensRead;

  sessionRecord.items.push({
    timestamp,
    endpoint,
    subTask,
    model: modelName,
    latencyMs,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      cachedRead: cachedTokensRead
    },
    cost: itemCost,
    initiator: initiator
  });

  const thirtyDaysAgo = Date.now() - 2592000000;
  usageHistory = usageHistory.filter(s => {
    return new Date(s.startTime).getTime() >= thirtyDaysAgo;
  });

  saveUsageHistoryFile();

  const yearMonth = timestamp.substring(0, 7);
  if (!monthlyAggregates[yearMonth]) {
    monthlyAggregates[yearMonth] = {
      totalCost: 0,
      savingsFromCaching: 0,
      totalSessions: 0,
      averageDurationMs: 0,
      models: {}
    };
  }

  const monthly = monthlyAggregates[yearMonth];
  const uniqueSessionsThisMonth = usageHistory.filter(s => s.startTime.substring(0, 7) === yearMonth).length;
  monthly.totalSessions = Math.max(monthly.totalSessions + (sessionRecord.items.length === 1 ? 1 : 0), uniqueSessionsThisMonth);

  monthly.totalCost += itemCost;
  monthly.savingsFromCaching += savings;

  const monthlySessionsList = usageHistory.filter(s => s.startTime.substring(0, 7) === yearMonth);
  if (monthlySessionsList.length > 0) {
    const sumDurations = monthlySessionsList.reduce((acc, curr) => acc + curr.durationMs, 0);
    monthly.averageDurationMs = Math.round(sumDurations / monthlySessionsList.length);
  }

  if (!monthly.models[modelName]) {
    monthly.models[modelName] = {
      calls: 0,
      inputTokens: 0,
      outputTokens: 0
    };
  }
  const mModel = monthly.models[modelName];
  mModel.calls += 1;
  mModel.inputTokens += inputTokens;
  mModel.outputTokens += outputTokens;

  saveMonthlyAggregatesFile();

  // Push updated session record + daily cost bar live to SSE clients
  broadcastSSE('usage', {
    session: sessionRecord,
    dailyCosts: getDailyCosts30Days()
  });

  logEvent('info', `Recorded cost telemetry. Task: ${subTask}, Cost: $${itemCost.toFixed(6)}, Caching Savings: $${savings.toFixed(6)}`);
}

function getDailyCosts30Days() {
  const dailyCosts = {};
  const now = Date.now();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000);
    const dateStr = d.toISOString().substring(0, 10);
    dailyCosts[dateStr] = 0;
  }

  usageHistory.forEach(session => {
    session.items.forEach(item => {
      const dateStr = item.timestamp.substring(0, 10);
      if (dailyCosts[dateStr] !== undefined) {
        dailyCosts[dateStr] += item.cost;
      }
    });
  });

  return Object.keys(dailyCosts).sort().map(date => ({
    date,
    cost: dailyCosts[date]
  }));
}

// Initial load of usage data
loadUsageData();

// Configure Gemini API keys for rotation & Key Pool
let apiKeysPool = [];

const defaultModels = [
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro'
];

// Initialize Paid Key if configured
if (process.env.GEMINI_API_KEY) {
  const modelEnabled = {};
  defaultModels.forEach(m => { modelEnabled[m] = 'active'; });
  apiKeysPool.push({
    id: 'key_paid',
    key: process.env.GEMINI_API_KEY,
    type: 'paid',
    label: 'Gemini Paid Key',
    enabled: true,
    status: 'Healthy', // 'Healthy' | 'Rate Limited' | 'Invalid' | 'Disabled'
    requestsToday: 0,
    errorsToday: 0,
    lastUsed: null,
    modelEnabled
  });
}

// Initialize Free Keys if configured
for (let i = 1; i <= 7; i++) {
  const keyVal = process.env[`GEMINI_API_KEY_${i}`];
  if (keyVal) {
    const modelEnabled = {};
    defaultModels.forEach(m => { modelEnabled[m] = 'active'; });
    apiKeysPool.push({
      id: `key_free_${i}`,
      key: keyVal,
      type: 'free',
      label: `Gemini Free Key ${i}`,
      enabled: true,
      status: 'Healthy',
      requestsToday: 0,
      errorsToday: 0,
      lastUsed: null,
      modelEnabled
    });
  }
}

// Apply persistent disabled keys list (Option B)
const persistedDisabled = loadDisabledKeys();
const disabledKeys = persistedDisabled.disabledKeys || [];
const disabledModels = persistedDisabled.disabledModels || {};
const persistedManualKeyStates = persistedDisabled.manualKeyStates || {};
const persistedManualModelStates = persistedDisabled.manualModelStates || {};

apiKeysPool.forEach(k => {
  k.disabledAt = {};
  k.lastRecoveryCheckAt = {};
  k.recoveryAttempts = {};
  // NEW: Initialize manual override state from persisted storage
  k.manualKeyState = persistedManualKeyStates[k.id] || null; // null | 'on' | 'off'

  if (disabledKeys.includes(k.id)) {
    k.enabled = false;
    // Distinguish manually disabled vs auto-disabled (auth error) on load
    k.status = k.manualKeyState === 'off' ? 'Manually Disabled' : 'Disabled';
  }
  if (disabledModels[k.id]) {
    for (const m in disabledModels[k.id]) {
      if (k.modelEnabled[m] !== undefined) {
        k.modelEnabled[m] = disabledModels[k.id][m];
        if (disabledModels[k.id][m] === 'quota_depleted') {
          k.disabledAt[m] = Date.now();
        }
        // Restore manual_off state from dedicated manualModelStates store
        if (persistedManualModelStates[k.id] && persistedManualModelStates[k.id][m] === 'manual_off') {
          k.modelEnabled[m] = 'manual_off';
        }
      }
    }
  }
});

// Active keys helper
function getActiveKeys() {
  return apiKeysPool.filter(k => k.enabled && k.status !== 'Disabled');
}

function getActiveKeysForModel(modelName) {
  return apiKeysPool.filter(k => 
    k.enabled && 
    k.status !== 'Disabled' && 
    k.modelEnabled[modelName] === 'active'
  );
}

// Current active key index in the rotation
let currentKeyIndex = 0;

// Escape regex characters for safe replace
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Recursive object sanitization for absolute API key privacy
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return;
  
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const val = obj[key];
      if (typeof val === 'string') {
        obj[key] = sanitizeApiKeyString(val);
      } else if (typeof val === 'object') {
        sanitizeObject(val);
      }
    }
  }
}

function sanitizeApiKeyString(str) {
  if (!str) return str;
  let result = str;
  // Replace actual keys in pool with their friendly labels
  apiKeysPool.forEach(k => {
    if (k.key && result.includes(k.key)) {
      result = result.replace(new RegExp(escapeRegExp(k.key), 'g'), k.label);
    }
  });
  
  // Catch any general raw Gemini API keys that might be in the logs
  const geminiKeyRegex = /AIzaSy[A-Za-z0-9_-]{33}/g;
  result = result.replace(geminiKeyRegex, '[Gemini API Key]');
  return result;
}

// Stores key verification status dynamically for the UI (No raw keys, only labels)
let keyStatuses = apiKeysPool.map((keyObj, idx) => ({
  index: idx + 1,
  id: keyObj.id,
  label: keyObj.label,
  type: keyObj.type,
  enabled: keyObj.enabled,
  status: keyObj.enabled ? 'Not Checked' : 'Disabled',
  modelResults: null,
  lastChecked: null,
  requestsToday: keyObj.requestsToday,
  errorsToday: keyObj.errorsToday,
  lastUsed: keyObj.lastUsed
}));

// In-memory cache map to store created context caches.
// Key format: `${apiKeyIndex}_${contentHash}`
// Value: { name: cacheName, expiresAt: Date }
const contextCacheMap = new Map();

// Set of keys (identified by `${modelName}_${keyIndex}`) that do not support context caching (e.g. Free Tier)
const keysWithoutCacheQuota = new Set();

// Helper to compute a SHA-256 hash of context string to use as cache key
const crypto = require('crypto');
const getContentHash = (systemInstruction, topic, toc, currentDocument) => {
  const contentToHash = [
    systemInstruction || '',
    topic || '',
    JSON.stringify(toc || []),
    currentDocument || ''
  ].join('|||');
  return crypto.createHash('sha256').update(contentToHash).digest('hex');
};

// Minimum token limits for caching per family (2048 for Gemini 2.x, 4096 for Gemini 3.x)
const getMinCacheTokens = (modelName) => {
  if (modelName.startsWith('gemini-3')) {
    return 4096;
  }
  return 2048; // Default to 2048 for Gemini 2.x or others
};

// Extract status code from error object or message string
const getErrorStatus = (error) => {
  if (error.status) return error.status;
  if (error.statusCode) return error.statusCode;
  if (error.status_code) return error.status_code;
  
  const errMsg = error.message || '';
  if (errMsg.startsWith('{') || errMsg.includes('"error"')) {
    try {
      const startIdx = errMsg.indexOf('{');
      const endIdx = errMsg.lastIndexOf('}') + 1;
      if (startIdx !== -1 && endIdx > startIdx) {
        const jsonStr = errMsg.substring(startIdx, endIdx);
        const parsed = JSON.parse(jsonStr);
        if (parsed.error && parsed.error.code) {
          return Number(parsed.error.code);
        }
      }
    } catch (e) {
      // ignore
    }
  }
  
  if (errMsg.includes('401') || errMsg.includes('API_KEY_INVALID') || errMsg.includes('INVALID_API_KEY')) return 401;
  if (errMsg.includes('403') || errMsg.includes('PERMISSION_DENIED')) return 403;
  if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('ResourceExhausted')) return 429;
  
  return 500;
};

// Comprehensive quota check checking all primary models sequentially per key
async function checkAllKeysQuotas() {
  const modelsToCheck = [
    'gemini-3.5-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.1-pro-preview',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];

  logEvent('info', `Starting comprehensive Gemini API key quota verification check across ${modelsToCheck.length} models...`);

  // Verify only enabled keys, or keys that are not disabled by the user
  const promises = apiKeysPool.map(async (keyObj, idx) => {
    if (!keyObj.enabled) {
      // Distinguish manual disable from auto-disable in status reporting
      keyStatuses[idx].status = keyObj.manualKeyState === 'off' ? 'Manually Disabled' : 'Disabled';
      keyStatuses[idx].modelEnabled = keyObj.modelEnabled;
      keyStatuses[idx].manualKeyState = keyObj.manualKeyState;
      return;
    }
    // MANUAL OVERRIDE GUARD: If user explicitly turned this key off, skip ALL automation
    if (keyObj.manualKeyState === 'off') {
      keyStatuses[idx].status = 'Manually Disabled';
      keyStatuses[idx].modelEnabled = keyObj.modelEnabled;
      keyStatuses[idx].manualKeyState = keyObj.manualKeyState;
      return;
    }

    // Inject concurrency jitter to smooth out API gateway request bursts
    const jitter = Math.floor(Math.random() * 300);
    await new Promise(resolve => setTimeout(resolve, jitter));

    const modelResults = {};
    let activeCount = 0;
    let authError = null;
    let quotaErrorCount = 0;
    
    // Check models sequentially for this key to prevent rate limit spikes on Free Tier
    for (const modelName of modelsToCheck) {
      try {
        const ai = new GoogleGenAI({ apiKey: keyObj.key });
        // Optimize token usage to the absolute practical minimum (1 input token, 1 output token)
        await ai.models.generateContent({
          model: modelName,
          contents: ".",
          config: {
            maxOutputTokens: 1,
            temperature: 0.0
          }
        });
        modelResults[modelName] = { working: true, status: 'Active', error: null };
        activeCount++;
        
        // MANUAL OVERRIDE GUARD: Only auto-restore quota_depleted, NEVER touch manual_off
        if (keyObj.modelEnabled[modelName] === 'quota_depleted') {
          keyObj.modelEnabled[modelName] = 'active';
        }
        // manual_off stays as manual_off — health check never touches it
      } catch (err) {
        const errMsg = err.message || '';
        const status = getErrorStatus(err);
        modelResults[modelName] = { 
          working: false, 
          status: status === 429 ? 'Quota Exceeded (429)' : (status === 503 ? 'Unavailable (503)' : 'Failed'), 
          error: errMsg 
        };
        
        if (status === 401 || status === 403) {
          authError = errMsg;
        }
        if (status === 429) {
          quotaErrorCount++;
          // Automatically mark as quota depleted if it was active
          if (keyObj.modelEnabled[modelName] === 'active') {
            keyObj.modelEnabled[modelName] = 'quota_depleted';
          }
        }
      }
      // Add a tiny 100ms sleep between model checks to prevent aggressive hammering
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Determine overall key status
    let overallStatus = 'Inactive';
    if (activeCount === modelsToCheck.length) {
      overallStatus = 'Active (All Models)';
      keyObj.status = 'Healthy';
    } else if (activeCount > 0) {
      overallStatus = `Active (${activeCount}/${modelsToCheck.length} Models)`;
      keyObj.status = 'Healthy';
    } else if (authError) {
      overallStatus = 'Invalid Key (Auth Error)';
      keyObj.status = 'Invalid';
      keyObj.enabled = false; // Master disable invalid keys
    } else if (quotaErrorCount > 0) {
      overallStatus = 'Quota Exceeded (429)';
      keyObj.status = 'Rate Limited';
    } else {
      overallStatus = 'Failed / Error';
      keyObj.status = 'Error';
    }

    keyStatuses[idx] = {
      index: idx + 1,
      id: keyObj.id,
      label: keyObj.label,
      type: keyObj.type,
      enabled: keyObj.enabled,
      status: overallStatus,
      modelEnabled: keyObj.modelEnabled,
      modelResults,
      lastChecked: new Date().toLocaleTimeString(),
      requestsToday: keyObj.requestsToday,
      errorsToday: keyObj.errorsToday,
      lastUsed: keyObj.lastUsed
    };
  });

  await Promise.all(promises);
  
  // Persist updated master and model-level statuses to disk
  saveDisabledKeysAndModels();
  // Push refreshed key pool state to all connected SSE DevTools clients
  broadcastSSE('key', keyStatuses);
  
  logEvent('info', 'Completed comprehensive Gemini API key quota verification check across all models.');
}

// Get the model name from environment or default to gemini-3.5-flash.
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

// In-memory system logs store for debugging
const systemLogs = [];

// ============================================================
// SSE Live Streaming — DevTools real-time push infrastructure
// ============================================================
const sseClients = new Set();

function sendSSE(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    sseClients.delete(res);
  }
}

function broadcastSSE(event, data) {
  sseClients.forEach(res => sendSSE(res, event, data));
}

function logEvent(level, message, details = null) {
  const timestamp = new Date().toISOString();
  const store = sessionLocalStorage.getStore();
  const sessionId = store ? store.sessionId : serverStartupSessionId;
  const initiator = store ? store.initiator : 'system';
  
  let sanitizedDetails = null;
  if (details) {
    try {
      sanitizedDetails = JSON.parse(JSON.stringify(details));
      sanitizeObject(sanitizedDetails);
    } catch (e) {
      sanitizedDetails = { error: 'Failed to sanitize log details' };
    }
  }

  const sanitizedMsg = sanitizeApiKeyString(message);

  systemLogs.unshift({ 
    timestamp, 
    level, 
    message: sanitizedMsg, 
    details: sanitizedDetails,
    sessionId,
    initiator
  });
  
  // Prune logs older than 3 days (3 * 24 * 60 * 60 * 1000 = 259,200,000 ms)
  const threeDaysAgo = Date.now() - 259200000;
  while (systemLogs.length > 0 && new Date(systemLogs[systemLogs.length - 1].timestamp).getTime() < threeDaysAgo) {
    systemLogs.pop();
  }
  
  // Push log entry live to all connected SSE DevTools clients
  broadcastSSE('log', systemLogs[0]);

  const consoleMsg = `[${timestamp}] [${level.toUpperCase()}] [Session: ${sessionId}] ${sanitizedMsg}`;
  if (level === 'error') {
    console.error(consoleMsg, sanitizedDetails ? JSON.stringify(sanitizedDetails) : '');
  } else if (level === 'warn') {
    console.warn(consoleMsg, sanitizedDetails ? JSON.stringify(sanitizedDetails) : '');
  } else {
    console.log(consoleMsg, sanitizedDetails ? JSON.stringify(sanitizedDetails) : '');
  }
}

logEvent('info', `Backend initialized with model: ${MODEL_NAME}`);
logEvent('info', `Configured Gemini API keys for rotation: ${apiKeysPool.length}`);

/**
 * Helper function to call the Gemini API with key rotation.
 * If one key fails (e.g. rate limit), it automatically rotates to the next key.
 */
/**
 * Model priority chain for fallback routing.
 * Attempts execution across models in priority order to prevent 429 quota exhaustion.
 */
// --- TASK-SPECIFIC GEMINI 3.X MODEL CHAINS ---
const SUBTASK_OUTLINE_PARSING = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'];
const SUBTASK_TAKEAWAY_GENERATION_PRO = ['gemini-3.1-pro-preview', 'gemini-3.5-flash'];
const SUBTASK_TAKEAWAY_GENERATION_FLASH = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'];
const SUBTASK_HTML_COMPILATION = ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
const SUBTASK_INTENT_EXTRACTION = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];
const SUBTASK_CONTENT_DRAFTING = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'];
const SUBTASK_REVISION_ANALYSIS = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'];
const SUBTASK_HTML_BLOCK_EDITING_PRO = ['gemini-3.1-pro-preview', 'gemini-3.5-flash'];
const SUBTASK_HTML_BLOCK_EDITING_FLASH = ['gemini-3.5-flash', 'gemini-3.1-pro-preview'];
const SUBTASK_CHAT_SUMMARIZATION = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];

// Legacy fallback chains for backward compatibility
const MODEL_FALLBACK_CHAIN = SUBTASK_TAKEAWAY_GENERATION_FLASH;
const LIGHT_MODEL_FALLBACK_CHAIN = SUBTASK_CHAT_SUMMARIZATION;

// Key success/failure telemetry helpers
function recordKeySuccess(keyObj) {
  keyObj.requestsToday++;
  keyObj.lastUsed = new Date().toISOString();
  if (keyObj.status === 'Rate Limited' || keyObj.status === 'Not Checked' || keyObj.status === 'Invalid' || keyObj.status === 'Error') {
    keyObj.status = 'Healthy';
  }
}

function recordKeyFailure(keyObj, error) {
  keyObj.errorsToday++;
  keyObj.lastUsed = new Date().toISOString();
  const status = getErrorStatus(error);
  if (status === 429) {
    keyObj.status = 'Rate Limited';
  } else if (status === 401 || status === 403) {
    keyObj.status = 'Invalid';
  } else {
    if (keyObj.status === 'Healthy' || keyObj.status === 'Not Checked') {
      keyObj.status = 'Error';
    }
  }
}

/**
 * Helper function to determine if we should fall back to the next model in the chain.
 */
const isFallbackTrigger = (error) => {
  const status = getErrorStatus(error);
  return status !== 401 && status !== 403;
};

/**
 * Fail-safe double-check that rapidly verifies all quota-depleted keys for a specific model
 * using the minimal token footprint check. If any key passes, it is restored to 'active'.
 */
async function doubleCheckDisabledKeys(modelName) {
  const keysToVerify = apiKeysPool.filter(k => 
    k.enabled && 
    k.status !== 'Disabled' &&
    // MANUAL OVERRIDE GUARD: Never attempt recovery on keys the user has explicitly disabled
    k.manualKeyState !== 'off' &&
    k.modelEnabled[modelName] === 'quota_depleted'
    // Note: manual_off is already excluded by the quota_depleted check above
  );
  
  if (keysToVerify.length === 0) return;
  
  logEvent('info', `Fail-safe: Running parallel double-check on ${keysToVerify.length} quota-depleted keys for model ${modelName}...`);
  
  const promises = keysToVerify.map(async (keyObj) => {
    // Inject concurrency jitter to smooth out API gateway request bursts
    const jitter = Math.floor(Math.random() * 300);
    await new Promise(resolve => setTimeout(resolve, jitter));

    try {
      const ai = new GoogleGenAI({ apiKey: keyObj.key });
      await ai.models.generateContent({
        model: modelName,
        contents: ".",
        config: {
          maxOutputTokens: 1,
          temperature: 0.0
        }
      });
      // Success! Restore to active
      keyObj.modelEnabled[modelName] = 'active';
      if (keyObj.disabledAt) delete keyObj.disabledAt[modelName];
      if (keyObj.lastRecoveryCheckAt) delete keyObj.lastRecoveryCheckAt[modelName];
      if (keyObj.recoveryAttempts) delete keyObj.recoveryAttempts[modelName];
      
      logEvent('info', `Fail-safe success: Key "${keyObj.label}" model ${modelName} is working again!`);
    } catch (err) {
      const status = getErrorStatus(err);
      if (status === 401 || status === 403) {
        keyObj.status = 'Invalid';
        keyObj.enabled = false;
        logEvent('info', `Fail-safe identify: Key "${keyObj.label}" returned auth error. Disabled.`);
      }
    }
  });
  
  await Promise.all(promises);
  saveDisabledKeysAndModels();
}

/**
 * Core stateless content generation with multi-model fallback and key rotation.
 * Iterates through model priority chain and rotates through active API keys.
 */
async function generateContentWithFallback(contents, systemInstruction, extraConfig = {}, modelChain = MODEL_FALLBACK_CHAIN) {
  const activeKeys = getActiveKeys();
  if (activeKeys.length === 0) {
    const errorMsg = "No active or enabled Gemini API keys are available in the pool. Please check your Key Management panel.";
    logEvent('error', errorMsg);
    throw new Error(errorMsg);
  }

  const store = sessionLocalStorage.getStore();
  const latencyBudget = store ? store.latencyBudget : null;

  // Dynamic Latency Budget Routing: filter out slower Pro models if high_speed is requested
  let activeModelChain = modelChain;
  if (latencyBudget === 'high_speed') {
    activeModelChain = modelChain.filter(m => !m.includes('pro'));
    if (activeModelChain.length === 0) {
      activeModelChain = ['gemini-3.5-flash'];
    }
    logEvent('info', `Latency Budget 'high_speed' active: routing directly to speed-optimized models: ${activeModelChain.join(', ')}`);
  }

  const errors = [];

  // Loop through model families in priority chain
  for (const modelName of activeModelChain) {
    let attempts = 0;
    const maxAttempts = Math.max(5, activeKeys.length * 2);
    let modelHasWorkableKeys = false;

    // Check if we have a cache hit for this modelName and hash (only valid on paid keys)
    let pinnedKeyIndex = null;
    let cachedContentName = null;
    if (extraConfig.cachedContentHash) {
      for (let i = 0; i < activeKeys.length; i++) {
        const keyObj = activeKeys[i];
        if (keyObj.type === 'paid') {
          const cacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          const cacheEntry = contextCacheMap.get(cacheKey);
          if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
            pinnedKeyIndex = i;
            cachedContentName = cacheEntry.name;
            break;
          }
        }
      }
    }

    // Loop through keys for the current model
    while (attempts < maxAttempts) {
      let activeKeysList = getActiveKeysForModel(modelName);
      if (activeKeysList.length === 0) {
        logEvent('info', `No active keys in memory for model ${modelName}. Running emergency fail-safe double-check...`);
        await doubleCheckDisabledKeys(modelName);
        activeKeysList = getActiveKeysForModel(modelName);
        if (activeKeysList.length === 0) {
          logEvent('info', `Fail-safe double-check completed: No keys recovered for model ${modelName}.`);
          break; // Fall back to next model in the chain
        }
      }
      const keyIndex = (pinnedKeyIndex !== null && attempts === 0) ? pinnedKeyIndex : (currentKeyIndex + attempts) % activeKeysList.length;
      const keyObj = activeKeysList[keyIndex];
      const apiKey = keyObj.key;
      
      let promptSnippet = '';
      if (typeof contents === 'string') {
        promptSnippet = contents.substring(0, 150) + '...';
      } else if (Array.isArray(contents)) {
        const lastMsg = contents[contents.length - 1];
        const lastText = lastMsg && lastMsg.parts && lastMsg.parts[0] ? lastMsg.parts[0].text : '';
        promptSnippet = `[Chat History - ${contents.length} messages. Last: ${typeof lastText === 'string' ? lastText.substring(0, 100) : ''}]`;
      } else {
        promptSnippet = '[Object prompt]';
      }

      logEvent('info', `Attempting model ${modelName} with Key: ${keyObj.label} (${keyObj.type})`, {
        model: modelName,
        keyLabel: keyObj.label,
        keyType: keyObj.type,
        promptSnippet
      });

      // Manage Context Cache (Paid Keys ONLY)
      let cacheToUse = null;
      if (extraConfig.cachedContentHash) {
        if (pinnedKeyIndex === keyIndex) {
          cacheToUse = cachedContentName;
          logEvent('info', `Cache hit for model ${modelName} using Key: ${keyObj.label}: ${cacheToUse}`);
          
          // Increment hits and extend local expiry in contextCacheMap
          const hitCacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          const hitCacheEntry = contextCacheMap.get(hitCacheKey);
          if (hitCacheEntry) {
            hitCacheEntry.hits = (hitCacheEntry.hits || 0) + 1;
            hitCacheEntry.expiresAt = Date.now() + 300 * 1000;
          }

          // Asynchronously extend cache TTL by 5 minutes to implement Rolling TTL (non-blocking)
          try {
            const tempAi = new GoogleGenAI({ apiKey });
            tempAi.caches.update({
              name: cacheToUse,
              config: {
                ttl: '300s' // extend by another 5 minutes
              }
            }).then(() => {
              logEvent('info', `Successfully extended cache TTL for ${cacheToUse} by 5 minutes (Rolling TTL)`);
            }).catch(extendErr => {
              console.error(`Failed to extend cache TTL for ${cacheToUse}:`, extendErr.message);
            });
          } catch (err) {
            console.error("Error setting up cache TTL extension:", err.message);
          }
        } else if (keyObj.type !== 'paid') {
          // Bypassing context cache for free keys
          logEvent('info', `Bypassing context cache creation for Key: ${keyObj.label} (Context Caching is only supported on Paid Keys)`);
        } else {
          // Cache miss on Paid Key: try to create a new cache
          const cacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          const disableKey = `${modelName}_${keyObj.id}`;

          if (keysWithoutCacheQuota.has(disableKey)) {
            logEvent('info', `Bypassing context cache creation for Key: ${keyObj.label} (previously marked as no cache quota)`);
          } else {
            try {
              const tempAi = new GoogleGenAI({ apiKey });
              const cacheContents = [
                {
                  role: 'user',
                  parts: [{ text: `Presentation Context:
Topic: ${extraConfig.topic || 'Not set yet'}
ToC: ${JSON.stringify(extraConfig.toc || [])}
Current Document:
${extraConfig.currentDocument || '(Empty Document)'}` }]
                },
                {
                  role: 'model',
                  parts: [{ text: "Understood. I have cached this presentation context." }]
                }
              ];

              // Count tokens of the content to check model caching thresholds
              const tokenResult = await tempAi.models.countTokens({
                model: modelName,
                contents: cacheContents
              });
              const totalTokens = tokenResult.totalTokens;
              const minTokens = getMinCacheTokens(modelName);

              if (totalTokens >= minTokens) {
                logEvent('info', `Creating context cache for Key: ${keyObj.label}. Token count ${totalTokens} >= threshold ${minTokens} for ${modelName}`);
                const cache = await tempAi.caches.create({
                  model: modelName,
                  config: {
                    contents: cacheContents,
                    ttl: '300s' // 5 minutes initial TTL (cost-efficient)
                  }
                });
                contextCacheMap.set(cacheKey, {
                  name: cache.name,
                  expiresAt: Date.now() + 300 * 1000,
                  hits: 0,
                  createdAt: Date.now()
                });
                cacheToUse = cache.name;
                logEvent('info', `Successfully created context cache on Key: ${keyObj.label}: ${cache.name}`);
              } else {
                logEvent('info', `Bypassing context cache for Key: ${keyObj.label}: token count ${totalTokens} is less than threshold ${minTokens} for ${modelName}`);
              }
            } catch (cacheErr) {
              const errMsg = cacheErr.message || '';
              logEvent('warn', `Failed to create context cache for ${modelName} using Key: ${keyObj.label}: ${errMsg}`);
              
              if (errMsg.includes('limit=0') || 
                  errMsg.includes('TotalCachedContentStorageTokens') || 
                  errMsg.includes('limit exceeded') || 
                  errMsg.includes('Free tier') ||
                  errMsg.includes('Community tier')) {
                keysWithoutCacheQuota.add(disableKey);
                logEvent('info', `Key: ${keyObj.label} identified as having no cache storage quota for ${modelName}. Added to bypass list.`);
              }
            }
          }
        }
      }

      try {
        const startTime = Date.now();
        const ai = new GoogleGenAI({ apiKey });
        let responseText;
        let response;

        if (cacheToUse) {
          const { cachedContentHash, topic, toc, currentDocument, ...restConfig } = extraConfig;
          response = await ai.models.generateContent({
            model: modelName,
            contents: contents,
            config: {
              cachedContent: cacheToUse,
              ...(systemInstruction ? { systemInstruction } : {}),
              ...restConfig
            }
          });
          responseText = response.text;
        } else {
          const { cachedContentHash, topic, toc, currentDocument, ...restConfig } = extraConfig;
          response = await ai.models.generateContent({
            model: modelName,
            contents: contents,
            config: {
              ...(systemInstruction ? { systemInstruction } : {}),
              ...restConfig
            }
          });
          responseText = response.text;
        }

        const latencyMs = Date.now() - startTime;

        // Update key telemetry & rotation index
        recordKeySuccess(keyObj);
        currentKeyIndex = keyIndex;
        logEvent('info', `Success! Model ${modelName} responded using Key: ${keyObj.label}`);

        // --- TELEMETRY COST & USAGE TRACKING ---
        try {
          const usage = response.usageMetadata || {};
          const inputTokens = usage.promptTokenCount || 0;
          const outputTokens = usage.candidatesTokenCount || 0;
          const cachedTokensRead = usage.cachedContentTokenCount || 0;

          // Auto-map subtask and endpoint by modelChain reference
          let subTask = "Unknown Task";
          let endpoint = "Unknown Endpoint";
          
          if (modelChain === SUBTASK_OUTLINE_PARSING) {
            subTask = "Outline Parsing";
            endpoint = "/api/generate";
          } else if (modelChain === SUBTASK_TAKEAWAY_GENERATION_PRO || modelChain === SUBTASK_TAKEAWAY_GENERATION_FLASH) {
            subTask = "Detailed Takeaways";
            endpoint = "/api/generate";
          } else if (modelChain === SUBTASK_HTML_COMPILATION) {
            subTask = "HTML Compilation";
            endpoint = "/api/generate";
          } else if (modelChain === SUBTASK_INTENT_EXTRACTION) {
            subTask = "Intent Extraction";
            endpoint = "/api/chat-speaker-notes";
          } else if (modelChain === SUBTASK_CONTENT_DRAFTING) {
            subTask = "Content Drafting";
            endpoint = "/api/chat-speaker-notes";
          } else if (modelChain === SUBTASK_REVISION_ANALYSIS) {
            subTask = "Revision Analysis";
            endpoint = "/api/revise";
          } else if (modelChain === SUBTASK_HTML_BLOCK_EDITING_PRO || modelChain === SUBTASK_HTML_BLOCK_EDITING_FLASH) {
            subTask = "HTML Block Editing";
            endpoint = "/api/revise";
          } else if (modelChain === SUBTASK_CHAT_SUMMARIZATION) {
            subTask = "Chat Summarization";
            endpoint = "/api/summarize-chats";
          }

          const store = sessionLocalStorage.getStore();
          const sessionId = store ? store.sessionId : 'system';

          recordUsage(sessionId, subTask, endpoint, modelName, inputTokens, outputTokens, cachedTokensRead, latencyMs);
        } catch (telemetryErr) {
          console.error("Failed to record cost telemetry:", telemetryErr.message);
        }
        // --------------------------------------------

        return responseText;
      } catch (error) {
        // Record telemetry failure
        recordKeyFailure(keyObj, error);

        if (extraConfig.cachedContentHash) {
          const cacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          contextCacheMap.delete(cacheKey);
        }

        const errStatus = getErrorStatus(error);
        const errMsg = error.message || '';
        
        logEvent('warn', `API call failed for model ${modelName} using Key: ${keyObj.label} (Status: ${errStatus})`, {
          model: modelName,
          keyLabel: keyObj.label,
          errorMessage: errMsg
        });

        errors.push({ model: modelName, keyLabel: keyObj.label, status: errStatus, message: errMsg });
        
        // --- SELF-HEALING AUTO-DISABLE INTERCEPTOR ---
        if (errStatus === 401 || errStatus === 403) {
          keyObj.status = 'Invalid';
          keyObj.enabled = false;
          saveDisabledKeysAndModels();
          logEvent('warn', `Self-Healing: Master-disabled Key "${keyObj.label}" due to auth error ${errStatus}`);
        } else if (errStatus === 429) {
          keyObj.modelEnabled[modelName] = 'quota_depleted';
          keyObj.disabledAt[modelName] = Date.now();
          keyObj.lastRecoveryCheckAt[modelName] = Date.now();
          keyObj.recoveryAttempts[modelName] = 0;
          saveDisabledKeysAndModels();
          logEvent('warn', `Self-Healing: Disabled model "${modelName}" on Key "${keyObj.label}" due to rate limit (429)`);
        }

        if (errStatus === 429) {
          const delayMs = 1500;
          logEvent('info', `Rate limit hit (429). Sleeping for ${delayMs}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        if (isFallbackTrigger(error)) {
          modelHasWorkableKeys = true; 
        }
        attempts++;
      }
    }

    if (modelHasWorkableKeys) {
      logEvent('info', `Cascading down from model ${modelName} to the next model in fallback chain.`);
    } else {
      const allAuth = errors.filter(e => e.model === modelName).every(e => e.status === 401 || e.status === 403);
      if (allAuth) {
        logEvent('error', `Aborting fallback: All keys failed with authentication errors.`);
        break;
      }
    }
  }

  const finalErrorMsg = "All AI models and rotating API keys failed. Check your network, authentication, or API quota status.";
  logEvent('error', finalErrorMsg, { allErrors: errors });
  
  const finalError = new Error(finalErrorMsg);
  finalError.status = errors[errors.length - 1]?.status || 500;
  finalError.details = errors;
  throw finalError;
}

/**
 * Streaming content generation with multi-model fallback and key rotation.
 * Iterates through model priority chain, rotates keys, and returns a response stream.
 */
async function generateContentStreamWithFallback(contents, systemInstruction, extraConfig = {}, modelChain = MODEL_FALLBACK_CHAIN) {
  const activeKeys = getActiveKeys();
  if (activeKeys.length === 0) {
    const errorMsg = "No active or enabled Gemini API keys are available in the pool. Please check your Key Management panel.";
    logEvent('error', errorMsg);
    throw new Error(errorMsg);
  }

  const store = sessionLocalStorage.getStore();
  const latencyBudget = store ? store.latencyBudget : null;

  // Dynamic Latency Budget Routing: filter out slower Pro models if high_speed is requested
  let activeModelChain = modelChain;
  if (latencyBudget === 'high_speed') {
    activeModelChain = modelChain.filter(m => !m.includes('pro'));
    if (activeModelChain.length === 0) {
      activeModelChain = ['gemini-3.5-flash'];
    }
    logEvent('info', `Latency Budget 'high_speed' active: routing stream directly to speed-optimized models: ${activeModelChain.join(', ')}`);
  }

  const errors = [];

  // Loop through model families in priority chain
  for (const modelName of activeModelChain) {
    let attempts = 0;
    const maxAttempts = Math.max(5, activeKeys.length * 2);
    let modelHasWorkableKeys = false;

    // Check if we have a cache hit for this modelName and hash (only valid on paid keys)
    let pinnedKeyIndex = null;
    let cachedContentName = null;
    if (extraConfig.cachedContentHash) {
      for (let i = 0; i < activeKeys.length; i++) {
        const keyObj = activeKeys[i];
        if (keyObj.type === 'paid') {
          const cacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          const cacheEntry = contextCacheMap.get(cacheKey);
          if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
            pinnedKeyIndex = i;
            cachedContentName = cacheEntry.name;
            break;
          }
        }
      }
    }

    // Loop through keys for the current model
    while (attempts < maxAttempts) {
      let activeKeysList = getActiveKeysForModel(modelName);
      if (activeKeysList.length === 0) {
        logEvent('info', `No active keys in memory for model ${modelName}. Running emergency fail-safe double-check...`);
        await doubleCheckDisabledKeys(modelName);
        activeKeysList = getActiveKeysForModel(modelName);
        if (activeKeysList.length === 0) {
          logEvent('info', `Fail-safe double-check completed: No keys recovered for model ${modelName}.`);
          break; // Fall back to next model in the chain
        }
      }
      const keyIndex = (pinnedKeyIndex !== null && attempts === 0) ? pinnedKeyIndex : (currentKeyIndex + attempts) % activeKeysList.length;
      const keyObj = activeKeysList[keyIndex];
      const apiKey = keyObj.key;
      
      let promptSnippet = '';
      if (typeof contents === 'string') {
        promptSnippet = contents.substring(0, 150) + '...';
      } else if (Array.isArray(contents)) {
        const lastMsg = contents[contents.length - 1];
        const lastText = lastMsg && lastMsg.parts && lastMsg.parts[0] ? lastMsg.parts[0].text : '';
        promptSnippet = `[Chat History - ${contents.length} messages. Last: ${typeof lastText === 'string' ? lastText.substring(0, 100) : ''}]`;
      } else {
        promptSnippet = '[Object prompt]';
      }

      logEvent('info', `Attempting stream connection for model ${modelName} with Key: ${keyObj.label} (${keyObj.type})`, {
        model: modelName,
        keyLabel: keyObj.label,
        keyType: keyObj.type,
        promptSnippet
      });

      // Manage Context Cache (Paid Keys ONLY)
      let cacheToUse = null;
      if (extraConfig.cachedContentHash) {
        if (pinnedKeyIndex === keyIndex) {
          cacheToUse = cachedContentName;
          logEvent('info', `Cache hit for model ${modelName} using Key: ${keyObj.label}: ${cacheToUse}`);
          
          // Increment hits and extend local expiry in contextCacheMap
          const hitCacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          const hitCacheEntry = contextCacheMap.get(hitCacheKey);
          if (hitCacheEntry) {
            hitCacheEntry.hits = (hitCacheEntry.hits || 0) + 1;
            hitCacheEntry.expiresAt = Date.now() + 300 * 1000;
          }

          // Asynchronously extend cache TTL by 5 minutes to implement Rolling TTL (non-blocking)
          try {
            const tempAi = new GoogleGenAI({ apiKey });
            tempAi.caches.update({
              name: cacheToUse,
              config: {
                ttl: '300s' // extend by another 5 minutes
              }
            }).then(() => {
              logEvent('info', `Successfully extended cache TTL for ${cacheToUse} by 5 minutes (Rolling TTL)`);
            }).catch(extendErr => {
              console.error(`Failed to extend cache TTL for ${cacheToUse}:`, extendErr.message);
            });
          } catch (err) {
            console.error("Error setting up cache TTL extension:", err.message);
          }
        } else if (keyObj.type !== 'paid') {
          logEvent('info', `Bypassing context cache creation for Key: ${keyObj.label} (Context Caching is only supported on Paid Keys)`);
        } else {
          const cacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          const disableKey = `${modelName}_${keyObj.id}`;

          if (keysWithoutCacheQuota.has(disableKey)) {
            logEvent('info', `Bypassing context cache creation for Key: ${keyObj.label} (previously marked as no cache quota)`);
          } else {
            try {
              const tempAi = new GoogleGenAI({ apiKey });
              const cacheContents = [
                {
                  role: 'user',
                  parts: [{ text: `Presentation Context:
Topic: ${extraConfig.topic || 'Not set yet'}
ToC: ${JSON.stringify(extraConfig.toc || [])}
Current Document:
${extraConfig.currentDocument || '(Empty Document)'}` }]
                },
                {
                  role: 'model',
                  parts: [{ text: "Understood. I have cached this presentation context." }]
                }
              ];

              const tokenResult = await tempAi.models.countTokens({
                model: modelName,
                contents: cacheContents
              });
              const totalTokens = tokenResult.totalTokens;
              const minTokens = getMinCacheTokens(modelName);

              if (totalTokens >= minTokens) {
                logEvent('info', `Creating context cache for Key: ${keyObj.label}. Token count ${totalTokens} >= threshold ${minTokens} for ${modelName}`);
                const cache = await tempAi.caches.create({
                  model: modelName,
                  config: {
                    contents: cacheContents,
                    ttl: '300s' // 5 minutes initial TTL (cost-efficient)
                  }
                });
                 contextCacheMap.set(cacheKey, {
                   name: cache.name,
                   expiresAt: Date.now() + 300 * 1000,
                   hits: 0,
                   createdAt: Date.now()
                 });
                cacheToUse = cache.name;
                // Broadcast cache creation so Cache Manager tab updates live
                broadcastSSE('cache', { action: 'created', name: cache.name, model: modelName, keyLabel: keyObj.label, createdAt: Date.now() });
                logEvent('info', `Successfully created context cache on Key: ${keyObj.label}: ${cache.name}`);
              } else {
                logEvent('info', `Bypassing context cache for Key: ${keyObj.label}: token count ${totalTokens} is less than threshold ${minTokens} for ${modelName}`);
              }
            } catch (cacheErr) {
              const errMsg = cacheErr.message || '';
              logEvent('warn', `Failed to create context cache for ${modelName} using Key: ${keyObj.label}: ${errMsg}`);
              
              if (errMsg.includes('limit=0') || 
                  errMsg.includes('TotalCachedContentStorageTokens') || 
                  errMsg.includes('limit exceeded') || 
                  errMsg.includes('Free tier') ||
                  errMsg.includes('Community tier')) {
                keysWithoutCacheQuota.add(disableKey);
                logEvent('info', `Key: ${keyObj.label} identified as having no cache storage quota for ${modelName}. Added to bypass list.`);
              }
            }
          }
        }
      }

      try {
        const ai = new GoogleGenAI({ apiKey });
        let responseStream;

        const { cachedContentHash, topic, toc, currentDocument, ...restConfig } = extraConfig;
        const config = {
          ...(cacheToUse ? { cachedContent: cacheToUse } : {}),
          ...(systemInstruction ? { systemInstruction } : {}),
          ...restConfig
        };

        responseStream = await ai.models.generateContentStream({
          model: modelName,
          contents: contents,
          config
        });

        // Update key telemetry & rotation index on connection success
        recordKeySuccess(keyObj);
        currentKeyIndex = keyIndex;
        logEvent('info', `Stream connection established for model ${modelName} using Key: ${keyObj.label}`);
        return { responseStream, modelName, keyIndex };
      } catch (error) {
        // Record telemetry failure
        recordKeyFailure(keyObj, error);

        if (extraConfig.cachedContentHash) {
          const cacheKey = `${modelName}_${keyObj.id}_${extraConfig.cachedContentHash}`;
          contextCacheMap.delete(cacheKey);
        }

        const errStatus = getErrorStatus(error);
        const errMsg = error.message || '';
        
        logEvent('warn', `Stream connection failed for model ${modelName} using Key: ${keyObj.label} (Status: ${errStatus})`, {
          model: modelName,
          keyLabel: keyObj.label,
          errorMessage: errMsg
        });

        errors.push({ model: modelName, keyLabel: keyObj.label, status: errStatus, message: errMsg });
        
        // --- SELF-HEALING AUTO-DISABLE INTERCEPTOR ---
        if (errStatus === 401 || errStatus === 403) {
          keyObj.status = 'Invalid';
          keyObj.enabled = false;
          saveDisabledKeysAndModels();
          logEvent('warn', `Self-Healing: Master-disabled Key "${keyObj.label}" due to auth error ${errStatus}`);
        } else if (errStatus === 429) {
          keyObj.modelEnabled[modelName] = 'quota_depleted';
          keyObj.disabledAt[modelName] = Date.now();
          keyObj.lastRecoveryCheckAt[modelName] = Date.now();
          keyObj.recoveryAttempts[modelName] = 0;
          saveDisabledKeysAndModels();
          logEvent('warn', `Self-Healing: Disabled model "${modelName}" on Key "${keyObj.label}" due to rate limit (429)`);
        }

        if (errStatus === 429) {
          const delayMs = 1500;
          logEvent('info', `Rate limit hit (429). Sleeping for ${delayMs}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        if (isFallbackTrigger(error)) {
          modelHasWorkableKeys = true; 
        }
        attempts++;
      }
    }

    if (modelHasWorkableKeys) {
      logEvent('info', `Cascading down from model ${modelName} to the next model in fallback chain.`);
    } else {
      const allAuth = errors.filter(e => e.model === modelName).every(e => e.status === 401 || e.status === 403);
      if (allAuth) {
        logEvent('error', `Aborting fallback: All keys failed with authentication errors.`);
        break;
      }
    }
  }

  const finalErrorMsg = "All AI models and rotating API keys failed to establish a stream. Check your network, authentication, or API quota status.";
  logEvent('error', finalErrorMsg, { allErrors: errors });
  
  const finalError = new Error(finalErrorMsg);
  finalError.status = errors[errors.length - 1]?.status || 500;
  finalError.details = errors;
  throw finalError;
}

/**
 * Legacy wrapper to maintain compatibility with existing generate calls.
 */
async function generateContentWithRotation(prompt, systemInstruction, extraConfig = {}, modelChain = undefined) {
  return generateContentWithFallback(prompt, systemInstruction, extraConfig, modelChain);
}

/**
 * Executes a stateless chat turn, appending the user prompt to the history,
 * calling the fallback router, and appending the model response.
 */
async function executeStatelessChatTurn(history, newPrompt, systemInstruction, extraConfig = {}, modelChain = undefined) {
  const updatedHistory = [...history];
  if (newPrompt) {
    updatedHistory.push({
      role: 'user',
      parts: [{ text: newPrompt }]
    });
  }
  
  const generatedText = await generateContentWithFallback(updatedHistory, systemInstruction, extraConfig, modelChain);
  
  updatedHistory.push({
    role: 'model',
    parts: [{ text: generatedText }]
  });
  
  return {
    updatedHistory,
    text: generatedText
  };
}

/**
 * Parses file buffer using officeparser.
 * Uses native Promise-based API for safety.
 */
async function parseFileBuffer(buffer, ext) {
  if (ext === 'txt') {
    return buffer.toString('utf8');
  }
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

  // Find first occurrence of { or [
  const firstBrace = clean.indexOf('{');
  const firstBracket = clean.indexOf('[');
  
  let startIdx = -1;
  let endChar = '';
  
  if (firstBrace !== -1 && firstBracket !== -1) {
    if (firstBrace < firstBracket) {
      startIdx = firstBrace;
      endChar = '}';
    } else {
      startIdx = firstBracket;
      endChar = ']';
    }
  } else if (firstBrace !== -1) {
    startIdx = firstBrace;
    endChar = '}';
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endChar = ']';
  }

  if (startIdx !== -1) {
    const endIdx = clean.lastIndexOf(endChar);
    if (endIdx !== -1 && endIdx > startIdx) {
      clean = clean.substring(startIdx, endIdx + 1);
    }
  } else {
    // Fallback if no brace/bracket found
    if (clean.startsWith("```json")) {
      clean = clean.substring(7);
    } else if (clean.startsWith("```")) {
      clean = clean.substring(3);
    }
    if (clean.endsWith("```")) {
      clean = clean.substring(0, clean.length - 3);
    }
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
  * {
    box-sizing: border-box !important;
  }
  html, body {
    max-width: 100% !important;
    overflow-x: hidden !important;
  }
  .page {
    max-width: 100% !important;
  }
  /* Ensure all layout and content elements respect boundaries */
  h1, h2, h3, h4, h5, h6, p, li, td, th, span, div, pre, code, table, blockquote, figure, aside, section, article {
    word-break: break-word !important;
    overflow-wrap: break-word !important;
    hyphens: auto !important;
    max-width: 100% !important;
  }
  h1 { font-size: min(2.8em, 56pt) !important; line-height: 1.2 !important; }
  h2 { font-size: min(1.8em, 36pt) !important; line-height: 1.3 !important; }
  h3 { font-size: min(1.3em, 26pt) !important; line-height: 1.35 !important; }

  /* Force tables to auto-wrap and stay within bounds */
  table {
    table-layout: fixed !important;
    width: 100% !important;
    border-collapse: collapse !important;
  }

  /* Force code blocks to wrap */
  pre, code {
    white-space: pre-wrap !important;
    word-wrap: break-word !important;
  }

  /* PAGE BOUNDARY — do NOT set height:auto on .page (causes page-bleed) */
  .page {
    overflow: hidden !important;
    min-height: 297mm !important;
    width: 210mm !important;
    padding: 12mm !important; /* Narrow margins */
    box-sizing: border-box !important;
  }

  /* Prevent inner content from exceeding printable width */
  .page > * {
    max-width: 100% !important;
    box-sizing: border-box !important;
  }

  /* SHAPE CONTAINMENT — inner containers grow but .page clips at its boundary */
  .page div, .page section, .page article,
  .page aside, .page figure, .page blockquote {
    min-height: 0 !important;
    height: auto !important;
    overflow: visible;
  }

  /* Restrict print breaks to specific blocks */
  .card, .callout-box, .stat-card, .notes-card, .step-card,
  .page tr, .page li, .page blockquote, .page figure {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  /* FONT SIZE HIERARCHY */
  .page .title { font-size: 40px !important; font-weight: 800 !important; }
  .page .subtitle { font-size: 32px !important; font-weight: 600 !important; }
  .page .section-title { font-size: 28px !important; font-weight: 700 !important; }
  .page h1, .page .header { font-size: 24px !important; font-weight: 700 !important; }
  .page h2, .page .sub-header { font-size: 20px !important; font-weight: 600 !important; }
  .page h3, .page th, .page .box-header, .page .card-title { font-size: 16px !important; font-weight: 700 !important; }
  .page td, .page p, .page li, .page .body-text { font-size: 14px !important; font-weight: 400 !important; line-height: 1.6 !important; }

  /* POSITION PAGE NUMBERS AT BOTTOM */
  .page { position: relative !important; }
  .page .page-number, .page .footer {
    position: absolute !important;
    bottom: 12mm !important;
    right: 12mm !important;
    font-size: 10px !important;
    font-weight: 500 !important;
    opacity: 0.8 !important;
  }

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

  /* SCREEN-ONLY STYLING — Separate pages visually like a real PDF document */
  @media screen {
    html, body {
      max-width: none !important;
      overflow: auto !important;
    }
    .page {
      max-width: none !important;
      margin: 0 auto 24px auto !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      border-radius: 4px !important;
      background-color: white !important;
    }
  }

  /* === IMAGE & CHART LAYOUT MATRIX === */
  .img-hero-landscape {
    display: block !important;
    width: 100% !important;
    max-width: 100% !important;
    height: auto !important;
    margin: 16px 0 !important;
    border-radius: 8px !important;
    border: 1px solid rgba(0, 0, 0, 0.08) !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .img-hero-split {
    float: left !important;
    width: 48% !important;
    max-width: 48% !important;
    height: auto !important;
    margin: 8px 16px 16px 0 !important;
    border-radius: 8px !important;
    border: 1px solid rgba(0, 0, 0, 0.08) !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .img-float-wide {
    float: right !important;
    width: 45% !important;
    max-width: 45% !important;
    height: auto !important;
    margin: 8px 0 16px 16px !important;
    border-radius: 6px !important;
    border: 1px solid rgba(0, 0, 0, 0.06) !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .img-float-compact {
    float: right !important;
    width: 30% !important;
    max-width: 30% !important;
    height: auto !important;
    margin: 6px 0 12px 12px !important;
    border-radius: 4px !important;
    border: 1px solid rgba(0, 0, 0, 0.06) !important;
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }
  .img-inline-icon {
    display: inline-block !important;
    height: 24px !important;
    width: auto !important;
    vertical-align: middle !important;
    margin-right: 8px !important;
    border: none !important;
  }
  .image-caption {
    font-size: 11px !important;
    font-weight: 500 !important;
    color: #555555 !important;
    margin-top: 4px !important;
    margin-bottom: 12px !important;
    text-align: center !important;
    display: block !important;
    width: 100% !important;
  }

  /* Sibling selectors to stack and wrap captions perfectly with floated images */
  .img-hero-split + .image-caption {
    float: left !important;
    width: 48% !important;
    clear: left !important;
    margin: 4px 16px 16px 0 !important;
    text-align: center !important;
  }
  .img-float-wide + .image-caption {
    float: right !important;
    width: 45% !important;
    clear: right !important;
    margin: 4px 0 16px 16px !important;
    text-align: center !important;
  }
  .img-float-compact + .image-caption {
    float: right !important;
    width: 30% !important;
    clear: right !important;
    margin: 4px 0 12px 12px !important;
    text-align: center !important;
  }

  /* PRINT OVERRIDES */
  @media print {
    @page {
      margin: 0;
    }
    body {
      margin: 0 !important;
      padding: 0 !important;
      background: white !important;
    }
    .page {
      position: relative !important;
      overflow: hidden !important;
      page-break-after: always !important;
      break-after: page !important;
      min-height: 297mm !important;
      height: 297mm !important;
      width: 210mm !important;
      padding: 12mm !important; /* Narrow margins */
      box-sizing: border-box !important;
      margin: 0 !important;
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
    }
    h1, h2, h3, h4, h5, h6, p, li, td, th, span, div, pre, code, table, blockquote, figure, aside, section, article {
      word-break: break-word !important;
      overflow-wrap: break-word !important;
    }
    .page div, .page section, .page article {
      height: auto !important;
      overflow: visible !important;
    }
    /* Restrict print breaks to specific blocks */
    .card, .callout-box, .stat-card, .notes-card, .step-card,
    .page tr, .page li, .page blockquote, .page figure {
      break-inside: avoid;
      page-break-inside: avoid;
    }
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

// --- DEVTOOLS SECURITY & AUTHENTICATION GUARD ---

const DEVTOOLS_ADMIN_PASSWORD = process.env.DEVTOOLS_ADMIN_PASSWORD || 'admin';
const serverStartTime = Date.now();

// Generate a secure, stateless token valid for the current container instance
function getAdminToken() {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(DEVTOOLS_ADMIN_PASSWORD + serverStartTime).digest('hex');
}

// Authentication Middleware (Bypassed in local development mode without a custom password, or from localhost)
function requireAuth(req, res, next) {
  // If not running in production and no password is explicitly configured, allow free access for local dev convenience
  if (process.env.NODE_ENV !== 'production' && !process.env.DEVTOOLS_ADMIN_PASSWORD) {
    return next();
  }
  
  // Also bypass auth if requested from local loopback (Strategy 2)
  const ip = req.ip || req.connection.remoteAddress;
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') {
    return next();
  }

  // Accept token from Authorization header OR query param (needed for EventSource which cannot send headers)
  const authHeader = req.headers['authorization'];
  const queryToken = req.query.token;
  const token = authHeader ? authHeader.split(' ')[1] : queryToken;

  if (!token) {
    return res.status(401).json({ error: 'unauthorized', message: 'Authentication token required.' });
  }

  if (token === getAdminToken()) {
    return next();
  }

  return res.status(403).json({ error: 'forbidden', message: 'Invalid or expired administrative token.' });
}

/**
 * DevTools Admin Login Endpoint
 */
app.post('/api/devtools/login', (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Missing password.' });
  }

  if (password === DEVTOOLS_ADMIN_PASSWORD) {
    logEvent('info', 'Developer Portal: Successful administrator login.');
    return res.json({ token: getAdminToken() });
  }

  logEvent('warn', 'Developer Portal: Unauthorized login attempt failed.');
  return res.status(401).json({ error: 'unauthorized', message: 'Invalid administrative password.' });
});

/**
 * GET DevTools Key Status (Safe: no raw keys are ever exposed)
 */
/**
 * GET DevTools SSE Live Stream
 * Persistent connection — server pushes typed events as they occur.
 * Events: log | usage | key | cache | heartbeat
 */
app.get('/api/devtools/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx proxy buffering
  res.flushHeaders();

  sseClients.add(res);

  // Send initial heartbeat immediately so the client knows we're alive
  const os = require('os');
  const sendHeartbeat = () => {
    sendSSE(res, 'heartbeat', {
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      activeKeysCount: getActiveKeys().length,
      totalKeysCount: apiKeysPool.length,
      freeMem: Math.round(os.freemem() / (1024 * 1024 * 1024)),
      loadAvg: os.loadavg()
    });
  };

  sendHeartbeat();

  // Keep connection alive with a heartbeat every 15 seconds
  const heartbeatInterval = setInterval(sendHeartbeat, 15000);

  // Cleanup when client disconnects
  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(heartbeatInterval);
  });
});

app.get('/api/devtools/keys/status', requireAuth, (req, res) => {
  // Synchronize dynamic statuses before returning
  apiKeysPool.forEach((keyObj, idx) => {
    keyStatuses[idx].enabled = keyObj.enabled;
    keyStatuses[idx].requestsToday = keyObj.requestsToday;
    keyStatuses[idx].errorsToday = keyObj.errorsToday;
    keyStatuses[idx].lastUsed = keyObj.lastUsed;
    keyStatuses[idx].modelEnabled = keyObj.modelEnabled;
    // NEW: Expose manualKeyState so frontend can render the correct badge
    keyStatuses[idx].manualKeyState = keyObj.manualKeyState;
    
    // Compute next scheduled check times for rate-limited models
    keyStatuses[idx].modelNextCheck = {};
    for (const m in keyObj.modelEnabled) {
      if (keyObj.modelEnabled[m] === 'quota_depleted') {
        const attempts = keyObj.recoveryAttempts[m] || 0;
        const disabledAt = keyObj.disabledAt[m] || Date.now();
        const lastCheck = keyObj.lastRecoveryCheckAt[m] || disabledAt;

        let cooldownMs = 60 * 1000;
        if (attempts === 1) cooldownMs = 3 * 60 * 1000;
        else if (attempts >= 2) cooldownMs = 5 * 60 * 1000;

        keyStatuses[idx].modelNextCheck[m] = lastCheck + cooldownMs;
      }
    }
    
    if (!keyObj.enabled) {
      // Distinguish manual disable from auto-disable (auth error)
      keyStatuses[idx].status = keyObj.manualKeyState === 'off' ? 'Manually Disabled' : 'Disabled';
    } else {
      if (keyObj.status === 'Healthy' || keyObj.status.startsWith('Active')) {
        const total = Object.keys(keyObj.modelEnabled).length;
        const active = Object.values(keyObj.modelEnabled).filter(v => v === 'active').length;
        keyStatuses[idx].status = `Active (${active}/${total} Models)`;
      } else {
        keyStatuses[idx].status = keyObj.status;
      }
    }
  });
  res.json(keyStatuses);
});

/**
 * POST DevTools Key Toggle (Option B: Persistent disabled list)
 */
app.post('/api/devtools/keys/toggle', requireAuth, (req, res) => {
  const { id, modelName, enabled } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'Missing key ID.' });
  }

  const keyObj = apiKeysPool.find(k => k.id === id);
  if (!keyObj) {
    return res.status(404).json({ error: 'Key not found.' });
  }

  if (modelName) {
    // Model-level toggle — always records explicit user intent as manual_off or active
    if (keyObj.modelEnabled[modelName] === undefined) {
      return res.status(400).json({ error: `Model "${modelName}" not found on this key.` });
    }
    // Toggling explicitly always sets manual state — never auto
    keyObj.modelEnabled[modelName] = enabled ? 'active' : 'manual_off';
    
    // Clear cooldown stats only when user manually enables a model
    if (enabled) {
      if (keyObj.disabledAt) delete keyObj.disabledAt[modelName];
      if (keyObj.lastRecoveryCheckAt) delete keyObj.lastRecoveryCheckAt[modelName];
      if (keyObj.recoveryAttempts) delete keyObj.recoveryAttempts[modelName];
    }
    
    logEvent('info', `Developer Portal: Model "${modelName}" on Key "${keyObj.label}" has been manually ${enabled ? 'ENABLED' : 'DISABLED (manual_off — automation immune)'}.`);
  } else {
    // Master key toggle — record explicit user intent in manualKeyState
    keyObj.enabled = enabled;
    keyObj.manualKeyState = enabled ? 'on' : 'off'; // CRITICAL: persist user intent
    keyObj.status = enabled ? 'Healthy' : 'Manually Disabled';
    
    // If restoring a key, only recover quota_depleted models — NEVER restore manual_off models
    if (enabled) {
      for (const m in keyObj.modelEnabled) {
        if (keyObj.modelEnabled[m] === 'quota_depleted') {
          keyObj.modelEnabled[m] = 'active';
          if (keyObj.disabledAt) delete keyObj.disabledAt[m];
          if (keyObj.lastRecoveryCheckAt) delete keyObj.lastRecoveryCheckAt[m];
          if (keyObj.recoveryAttempts) delete keyObj.recoveryAttempts[m];
        }
        // manual_off models stay manual_off when re-enabling the key
      }
    }
    
    logEvent('info', `Developer Portal: Key "${keyObj.label}" manually ${enabled ? 'ENABLED (manualKeyState=on)' : 'DISABLED (manualKeyState=off — automation immune)'}.`);
  }

  // Save updated states (including manualKeyState and manualModelStates) to disk
  saveDisabledKeysAndModels();

  // Synchronize keyStatuses
  const idx = apiKeysPool.findIndex(k => k.id === id);
  if (idx !== -1) {
    keyStatuses[idx].enabled = keyObj.enabled;
    keyStatuses[idx].modelEnabled = keyObj.modelEnabled;
    keyStatuses[idx].manualKeyState = keyObj.manualKeyState;
    
    // Compute next scheduled check times
    keyStatuses[idx].modelNextCheck = {};
    for (const m in keyObj.modelEnabled) {
      if (keyObj.modelEnabled[m] === 'quota_depleted') {
        const attempts = keyObj.recoveryAttempts[m] || 0;
        const disabledAt = keyObj.disabledAt[m] || Date.now();
        const lastCheck = keyObj.lastRecoveryCheckAt[m] || disabledAt;

        let cooldownMs = 60 * 1000;
        if (attempts === 1) cooldownMs = 3 * 60 * 1000;
        else if (attempts >= 2) cooldownMs = 5 * 60 * 1000;

        keyStatuses[idx].modelNextCheck[m] = lastCheck + cooldownMs;
      }
    }

    if (!keyObj.enabled) {
      // Use distinct labels for manual vs auto (auth error) disabling
      keyStatuses[idx].status = keyObj.manualKeyState === 'off' ? 'Manually Disabled' : 'Disabled';
    } else {
      const total = Object.keys(keyObj.modelEnabled).length;
      const active = Object.values(keyObj.modelEnabled).filter(v => v === 'active').length;
      keyStatuses[idx].status = `Active (${active}/${total} Models)`;
    }
  }

  // Push updated key pool state live to all SSE clients
  broadcastSSE('key', keyStatuses);

  res.json({ success: true, keys: keyStatuses });
});

/**
 * POST DevTools Key Health Check (Trigger on-demand validation)
 */
app.post('/api/devtools/keys/health-check', requireAuth, async (req, res) => {
  logEvent('info', 'Developer Portal: Administrative manual health check triggered.');
  try {
    await checkAllKeysQuotas();
    res.json({ success: true, keys: keyStatuses });
  } catch (err) {
    logEvent('error', `Manual health check failed: ${err.message}`);
    res.status(500).json({ error: 'error', message: err.message });
  }
});

/**
 * GET DevTools System Status / Telemetry
 */
app.get('/api/devtools/status', requireAuth, (req, res) => {
  const os = require('os');
  const activeKeys = getActiveKeys();
  const uptime = Math.floor((Date.now() - serverStartTime) / 1000); // seconds
  
  res.json({
    status: 'healthy',
    uptime,
    activeKeysCount: activeKeys.length,
    totalKeysCount: apiKeysPool.length,
    activeModel: MODEL_NAME,
    nodeEnv: process.env.NODE_ENV || 'development',
    system: {
      platform: os.platform(),
      totalMem: Math.round(os.totalmem() / (1024 * 1024 * 1024)), // GB
      freeMem: Math.round(os.freemem() / (1024 * 1024 * 1024)), // GB
      loadAvg: os.loadavg(),
      cpuCount: os.cpus().length
    }
  });
});

/**
 * GET DevTools Logs (JSON Stream API)
 */
app.get('/api/devtools/logs', requireAuth, (req, res) => {
  res.json(systemLogs);
});

/**
 * POST DevTools Logs Clear
 */
app.post('/api/devtools/logs/clear', requireAuth, (req, res) => {
  systemLogs.length = 0;
  logEvent('info', 'Developer Portal: Administrative command executed to clear all system logs.');
  res.json({ success: true });
});

/**
 * GET DevTools Usage Summary
 */
app.get('/api/devtools/usage/summary', requireAuth, async (req, res) => {
  try {
    const rate = await getExchangeRate();
    const daily = getDailyCosts30Days();
    res.json({
      monthlyAggregates: monthlyAggregates,
      dailyCosts: daily,
      exchangeRate: rate,
      pricingRates: pricingRates
    });
  } catch (err) {
    logEvent('error', `Failed to retrieve usage summary: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * GET DevTools Detailed Sessions
 */
app.get('/api/devtools/usage/sessions', requireAuth, (req, res) => {
  try {
    res.json(usageHistory);
  } catch (err) {
    logEvent('error', `Failed to retrieve session history: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * POST DevTools Usage Reset
 */
app.post('/api/devtools/usage/reset', requireAuth, (req, res) => {
  try {
    usageHistory = [];
    monthlyAggregates = {};
    
    // Write empty files
    try {
      fs.writeFileSync(USAGE_HISTORY_FILE, JSON.stringify([], null, 2), 'utf8');
      fs.writeFileSync(MONTHLY_AGGREGATES_FILE, JSON.stringify({}, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to write empty usage files during reset:', e.message);
    }
    
    logEvent('info', 'Developer Portal: Cost and usage database successfully reset by administrator.');
    res.json({ success: true, message: 'Usage databases successfully reset.' });
  } catch (err) {
    logEvent('error', `Failed to reset usage database: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * GET DevTools Active Caches
 */
app.get('/api/devtools/caches', requireAuth, async (req, res) => {
  try {
    const paidKeyObj = apiKeysPool.find(k => k.type === 'paid' && k.enabled);
    if (!paidKeyObj) {
      return res.json({ caches: [], message: 'No active Paid Key configured or enabled. Context Caching is disabled.' });
    }

    const ai = new GoogleGenAI({ apiKey: paidKeyObj.key });
    const listResponse = await ai.caches.list();
    
    // Convert to a clean list of cache objects
    const caches = (listResponse.cachedContents || []).map(c => {
      // Find hits and createdAt in contextCacheMap
      let hits = 0;
      let createdAt = new Date(c.createTime || Date.now()).getTime();
      for (const [ckey, entry] of contextCacheMap.entries()) {
        if (entry.name === c.name) {
          hits = entry.hits || 0;
          if (entry.createdAt) {
            createdAt = entry.createdAt;
          }
          break;
        }
      }

      // Estimating token count based on API properties
      const tokenCount = c.sizeBytes ? Math.round(c.sizeBytes / 4) : (c.contents ? 0 : 15000); // Fallback estimates if tokens not explicit
      
      return {
        name: c.name,
        model: c.model,
        displayName: c.displayName || 'Unnamed Cache',
        expireTime: c.expireTime,
        ttl: c.ttl || '300s',
        tokenCount,
        hits,
        createdAt
      };
    });

    res.json({ caches });
  } catch (err) {
    logEvent('error', `Failed to retrieve active caches: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * DELETE DevTools Cache
 */
app.delete('/api/devtools/caches/*', requireAuth, async (req, res) => {
  try {
    // Extract the full cache path e.g. "cachedContents/..." from the wildcard
    const cacheName = req.params[0];
    if (!cacheName) {
      return res.status(400).json({ error: 'bad_request', message: 'Missing cache name parameter.' });
    }

    const paidKeyObj = apiKeysPool.find(k => k.type === 'paid');
    if (!paidKeyObj) {
      return res.status(400).json({ error: 'no_paid_key', message: 'No Paid Key configured to perform cache deletion.' });
    }

    const ai = new GoogleGenAI({ apiKey: paidKeyObj.key });
    await ai.caches.delete({ name: `cachedContents/${cacheName}` });
    
    logEvent('info', `Developer Portal: Administrator manually deleted context cache: cachedContents/${cacheName}`);
    // Broadcast deletion so Cache Manager tab removes the row live
    broadcastSSE('cache', { action: 'deleted', name: `cachedContents/${cacheName}` });
    res.json({ success: true, message: `Cache cachedContents/${cacheName} successfully deleted.` });
  } catch (err) {
    logEvent('error', `Failed to delete context cache: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * POST DevTools Playground Run
 */
app.post('/api/devtools/playground/run', requireAuth, async (req, res) => {
  try {
    const { prompt, systemInstruction, modelName, temperature } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'bad_request', message: 'Prompt parameter is required.' });
    }

    const activeKeys = getActiveKeys();
    if (activeKeys.length === 0) {
      return res.status(400).json({ error: 'no_keys', message: 'No active or enabled Gemini API keys are available.' });
    }

    // Run using the first available key
    const keyObj = activeKeys[0];
    const ai = new GoogleGenAI({ apiKey: keyObj.key });
    const startTime = Date.now();
    
    const response = await ai.models.generateContent({
      model: modelName || 'gemini-3.5-flash',
      contents: prompt,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(temperature !== undefined ? { temperature: parseFloat(temperature) } : {})
      }
    });

    const latencyMs = Date.now() - startTime;
    const usage = response.usageMetadata || {};

    // Record the usage in our cost telemetry database!
    try {
      const store = sessionLocalStorage.getStore();
      const sessionId = store ? store.sessionId : 'system';
      recordUsage(
        sessionId,
        "Playground Run",
        "/api/devtools/playground/run",
        modelName || 'gemini-3.5-flash',
        usage.promptTokenCount || 0,
        usage.candidatesTokenCount || 0,
        usage.cachedContentTokenCount || 0,
        latencyMs
      );
    } catch (telemetryErr) {
      console.error("Failed to record playground usage:", telemetryErr.message);
    }

    res.json({
      text: response.text,
      latencyMs,
      tokens: {
        input: usage.promptTokenCount || 0,
        output: usage.candidatesTokenCount || 0,
        cachedRead: usage.cachedContentTokenCount || 0
      },
      keyLabel: keyObj.label
    });
  } catch (err) {
    logEvent('error', `Playground execution failed: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * POST DevTools A/B Layout Test
 */
app.post('/api/devtools/ab-test', requireAuth, async (req, res) => {
  try {
    const { prompt, systemInstructionA, systemInstructionB, modelA, modelB } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'bad_request', message: 'Prompt parameter is required.' });
    }

    const runA = async () => {
      try {
        const text = await generateContentWithFallback(prompt, systemInstructionA, {}, [modelA || 'gemini-3.5-flash']);
        return { success: true, html: text };
      } catch (err) {
        return { success: false, error: err.message };
      }
    };

    const runB = async () => {
      try {
        const text = await generateContentWithFallback(prompt, systemInstructionB, {}, [modelB || 'gemini-3.1-pro-preview']);
        return { success: true, html: text };
      } catch (err) {
        return { success: false, error: err.message };
      }
    };

    // Run both compilations concurrently
    const [resA, resB] = await Promise.all([runA(), runB()]);
    res.json({ a: resA, b: resB });
  } catch (err) {
    logEvent('error', `A/B test execution failed: ${err.message}`);
    res.status(500).json({ error: 'server_error', message: err.message });
  }
});

/**
 * Public Server Health Check Endpoint
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    keysLoaded: apiKeysPool.length,
    activeKeysCount: getActiveKeys().length,
    model: MODEL_NAME
  });
});

/**
 * Secure Legacy Check Quotas Endpoint (Required Auth in Prod)
 */
app.get('/api/check-quotas', requireAuth, async (req, res) => {
  try {
    await checkAllKeysQuotas();
    res.redirect('/api/logs');
  } catch (error) {
    logEvent('error', `Failed to check quotas: ${error.message}`);
    res.status(500).send(`Error checking quotas: ${error.message}`);
  }
});

/**
 * Secure Legacy Debug Logs Dashboard Endpoint (Required Auth in Prod)
 */
app.get('/api/logs', requireAuth, (req, res) => {
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
        <span class="message">[Session: ${entry.sessionId}] ${entry.message}</span>
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
      <title>AI Key Rotation Debug Logs</title>
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

        function toggleErrorText(cell) {
          autoRefresh = false;
          if (cell.style.whiteSpace === 'normal') {
            cell.style.whiteSpace = 'nowrap';
            cell.style.maxWidth = '300px';
            cell.style.overflow = 'hidden';
            cell.style.textOverflow = 'ellipsis';
            const allCells = document.querySelectorAll('.error-cell');
            const anyExpanded = Array.from(allCells).some(c => c.style.whiteSpace === 'normal');
            if (!anyExpanded) {
              autoRefresh = true;
            }
          } else {
            cell.style.whiteSpace = 'normal';
            cell.style.maxWidth = 'none';
            cell.style.overflow = 'visible';
            cell.style.textOverflow = 'clip';
          }
        }
      </script>
    </head>
    <body>
      <div class="container">
        <header>
          <div>
            <h1>AI Key Rotation Logs</h1>
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
          <section style="margin-bottom: 2rem; background-color: var(--card-bg); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h2 style="margin: 0; font-size: 1.3rem; color: var(--info-color);">AI API Keys Quota Status</h2>
              <a href="/api/check-quotas" class="btn btn-primary" style="background-color: var(--info-color); color: #0f172a; border-radius: 6px; padding: 0.4rem 0.8rem; font-size: 0.85rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.25rem;">🔄 Check Quotas Now</a>
            </div>
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
              <thead>
                <tr style="border-bottom: 2px solid var(--border-color); color: var(--text-muted);">
                  <th style="padding: 8px;">Key Index</th>
                  <th style="padding: 8px;">Friendly Label</th>
                  <th style="padding: 8px;">Type</th>
                  <th style="padding: 8px;">Overall Status</th>
                  <th style="padding: 8px; width: 45%;">Model Support / Status</th>
                  <th style="padding: 8px;">Last Checked</th>
                </tr>
              </thead>
              <tbody>
                ${keyStatuses.map(k => {
                  let badgeColor = '#64748b'; // Gray
                  if (k.status.startsWith('Active')) badgeColor = '#10b981'; // Green
                  if (k.status === 'Quota Exceeded (429)') badgeColor = '#f59e0b'; // Amber
                  if (k.status.includes('Auth') || k.status.startsWith('Failed') || k.status.startsWith('Error')) badgeColor = '#ef4444'; // Red
                  if (k.status === 'Disabled') badgeColor = '#b45309'; // Brown
                  
                  let modelStatusHtml = '<div style="display: flex; flex-wrap: wrap; gap: 6px;">';
                  if (k.modelResults) {
                    Object.entries(k.modelResults).forEach(([modelName, res]) => {
                      let mColor = '#ef4444';
                      if (res.working) mColor = '#10b981';
                      else if (res.status.includes('429')) mColor = '#f59e0b';
                      
                      const shortModelName = modelName.replace('gemini-', '');
                      const titleText = res.working ? 'Working (Connection OK)' : (res.status || 'Error') + ': ' + (res.error ? String(res.error).replace(/"/g, '&quot;') : '');
                      
                      modelStatusHtml += `
                        <span style="background-color: rgba(30, 41, 59, 0.5); border: 1px solid \${mColor}; color: \${mColor}; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-family: monospace; font-weight: 600;" title="\${titleText}">
                          \${shortModelName}: \${res.working ? 'OK' : 'ERR'}
                        </span>
                      `;
                    });
                  } else {
                    modelStatusHtml += '<span style="color: var(--text-muted); font-size: 0.8rem;">No model data (Check Quotas to verify)</span>';
                  }
                  modelStatusHtml += '</div>';

                  return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 12px 8px; font-weight: bold;">Key #\${k.index}</td>
                      <td style="padding: 12px 8px;">\${k.label}</td>
                      <td style="padding: 12px 8px; text-transform: uppercase; font-size: 0.8rem; font-weight: bold; color: \${k.type === 'paid' ? '#38bdf8' : '#94a3b8'};">\${k.type}</td>
                      <td style="padding: 12px 8px;">
                        <span style="background-color: \${badgeColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; display: inline-block;">
                          \${k.status}
                        </span>
                      </td>
                      <td style="padding: 12px 8px;">\${modelStatusHtml}</td>
                      <td style="padding: 12px 8px; color: var(--text-muted);;">\${k.lastChecked || 'Never Checked'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </section>

          <div class="log-list">
            \${systemLogs.length === 0 
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

// --- NEW VIRTUAL MATRIX TEMPLATE EXPLORER ENDPOINTS ---

const mockData = {
  CoverPage: {
    pageTitle: 'Leveraging AI in Modern Enterprise Architecture',
    sections: [
      {
        sectionType: 'CoverBlock',
        title: 'Leveraging AI in Modern Enterprise Architecture',
        subtitle: 'A strategic framework for scalability, visual consistency, and programmatic efficiency in layout generation pipelines.',
        author: 'Dr. Sarah Jenkins, Director of AI Engineering',
        date: '24 June 2026'
      }
    ]
  },
  TwoColumnSplit: {
    pageTitle: 'Comparison of Traditional AI Draw vs. Matrix Compilers',
    sections: [
      {
        sectionType: 'TwoColumnBlock',
        leftColumnHeader: 'Stage 2 & 3 Parallel AI Rendering',
        leftColumnBullets: [
          'Workload: High-concurrency parallel API calls (12+ calls per document)',
          'Cost & Rate Limits: Extremely high risk of exhausting daily Free Tier limits (429)',
          'Layout Reliability: AI frequently hallucinates sizes, causing text overflows and broken designs',
          'Visual Consistency: Style anomalies occur across pages since prompts are run independently'
        ],
        rightColumnHeader: 'Programmatic Matrix Theme Compilers',
        rightColumnBullets: [
          'Workload: Exactly 1 single structured JSON summary request (90% reduction)',
          'Cost & Rate Limits: Consumes negligible quota, fully compatible with Free Tier limits',
          'Layout Reliability: Handled programmatically via CSS variables in under 1ms (100% overflow-free)',
          'Visual Consistency: Absolute coherence as typography and colors are globally enforced'
        ]
      }
    ]
  },
  MultiCardGrid: {
    pageTitle: 'The Four Pillars of Programmatic Layout Systems',
    sections: [
      {
        sectionType: 'MultiCardGrid',
        cards: [
          { header: '1. CSS Token Isolation', content: 'Zero hardcoded colors or sizing values in templates. Presentation lies purely in clean orthogonal CSS variable sheets.' },
          { header: '2. Programmatic Page Budgets', content: 'Complexity scoring algorithms split slide content into balanced blocks before AI summarization occurs.' },
          { header: '3. Single Call Workloads', content: 'AI acts purely as a content synthesizer, outputting structured JSON field shapes rather than layout code.' },
          { header: '4. Local Dashboard Previews', content: 'Visual verification runs 100% offline, allowing instant style audits and zero-cost theme compilation.' }
        ]
      }
    ]
  },
  ProcessTimeline: {
    pageTitle: 'Step-by-Step Document Compilation Pipeline',
    sections: [
      {
        sectionType: 'ProcessTimeline',
        steps: [
          { stepNumber: '01', header: 'PowerPoint Parsing', description: 'PowerPoint files are unzipped and parsed for slide headers, tables, images, and text runs.' },
          { stepNumber: '02', header: 'Complexity Analysis', description: 'SlideAnalyzer computes complexity metrics and allocates slides into page budgets.' },
          { stepNumber: '03', header: 'Gemini Synthesis', description: 'Stage 1 AI generates structured, clean JSON summaries matching the registry schema.' },
          { stepNumber: '04', header: 'Template Assembly', description: 'HtmlCompiler loads component layouts, replaces variables, and merges CSS theme stylesheets.' },
          { stepNumber: '05', header: 'Print-Safe Output', description: 'Fully validated, overflow-free A4 PDF document is ready in under 4 seconds.' }
        ]
      }
    ]
  },
  DataTable: {
    pageTitle: 'System Performance and Resource Benchmark Matrix',
    sections: [
      {
        sectionType: 'DataTable',
        headers: ['Pipeline Metric', 'Parallel AI Draw (Old)', 'Matrix Compiler (New)', 'Performance Gain'],
        rows: [
          ['E2E Render Time', '28.5 Seconds', '3.8 Seconds', '7.5x Acceleration'],
          ['Gemini API Calls', '12+ Concurrent Requests', 'Exactly 1 Request', '91% Fewer Calls'],
          ['Visual Consistency', 'Variable (Frequent Drift)', 'Absolute Coherence', 'Guaranteed Quality'],
          ['Daily Quota Cost', '₹75.40 (Paid Equivalent)', '₹2.80 (Paid Equivalent)', '96% Cost Savings'],
          ['Visual Overflow Rate', '14.2% of Pages', '0.0% (Print-Safe)', 'Zero Overflow Error']
        ]
      }
    ]
  },
  HeroCallout: {
    pageTitle: 'Core Philosophy of Programmatic Styling',
    sections: [
      {
        sectionType: 'HeroCallout',
        quoteText: 'Programmatic layout styling is not about restricting creativity; it is about freeing the AI to focus entirely on information synthesis while the system guarantees visual excellence.',
        author: 'Principles of Modern UX Engineering',
        highlightText: 'Separating content from presentation allows layouts to render instantly in under 1ms, costing zero API quota and ensuring print safety.'
      }
    ]
  },
  MixedMedia: {
    pageTitle: 'Contextual Media Floats & Wrapping',
    sections: [
      {
        sectionType: 'MediaBlock',
        imageId: 'img_test_graphic.png',
        caption: 'Figure 4.1: Flowchart illustrating the connection between slide complexity scoring and dynamic page budgets.',
        resolvedClass: 'float-right',
        textContent: 'The MixedMedia layout uses standard float-based CSS properties to wrap paragraph text cleanly around embedded images and charts. This structure ensures that figures are displayed alongside their descriptions, maximizing space efficiency on the print sheet. The compiler automatically injects the image caption in a neat sub-card block, and applies a clear-both rule below the wrap to prevent bullet list bleed.',
        bullets: [
          'Responsive wrapping: Automatically resizes to 45% of the A4 printable area.',
          'Captioned blocks: Captions are contained inside borders, preventing overlap.',
          'Flow independence: Falls back to a clean text card if no imageId is resolved.'
        ]
      }
    ]
  },
  CompositeLayout: {
    pageTitle: 'Strategic Objectives & Visual Philosophy',
    sections: [
      {
        sectionType: 'StandardTextBlock',
        header: 'Q3 Document Generation Goals',
        bullets: [
          'Bypass fragile client-side PDF generation via solid A4 printing standards.',
          'Deliver zero-overflow assurance via Slide Complexity scoring limits.',
          'Reduce Gemini API latency by bundling all slide summaries in a single JSON call.'
        ]
      },
      {
        sectionType: 'HeroCallout',
        quoteText: 'A high-identity design creates instant trust and makes takeaways unforgettable.',
        author: 'Takeaway Notes Design Philosophy',
        highlightText: 'Each of the six Vibe Themes is engineered with distinct borders, shadows, and spacing.'
      }
    ]
  }
};

// Serve the Visual Explorer HTML page
app.get('/templates/explorer', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/explorer.html'));
});

// Returns metadata for presets, themes, and palettes
app.get('/api/templates/presets', (req, res) => {
  res.json({
    presets: Object.keys(mockData),
    themes: ['formal_professional', 'warm_encouraging', 'fun_energetic', 'reflective_thoughtful', 'educational_informative', 'motivational_inspiring'],
    palettes: ['corporate_navy', 'warm_forest', 'electric_purple', 'sunset_amber', 'elegant_charcoal', 'midnight_teal', 'crimson_gold', 'nordic_sage', 'cyberpunk_neon', 'vintage_cream']
  });
});

// Generates and returns compiled preview page inside iframe
app.get('/api/templates/preview', (req, res) => {
  const { preset, theme, palette } = req.query;
  const pageData = mockData[preset] || mockData.TwoColumnSplit;
  const compiledHtml = compileDocument([pageData], theme, palette);
  res.send(compiledHtml);
});

/**
 * Endpoint to incrementally summarize completed chats using a lightweight model chain.
 */
app.post('/api/summarize-chats', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing messages array.' });
    }

    if (messages.length === 0) {
      return res.json({ summary: '' });
    }

    logEvent('info', `Received chat summarization request. Messages to summarize: ${messages.length}`);

    // Convert messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    }));

    const systemInstruction = 
      "You are a helpful assistant. Summarize the following brainstorming chat history between the user and the AI assistant regarding a presentation. Be concise and capture only key decisions made, approved titles, chosen themes, or specific details for slides. Keep the summary under 100 words.";

    const summaryText = await generateContentWithFallback(
      contents,
      systemInstruction,
      { responseMimeType: "text/plain" },
      SUBTASK_CHAT_SUMMARIZATION
    );

    res.json({ summary: summaryText.trim() });
  } catch (error) {
    logEvent('error', `Chat summarization failed: ${error.message}`);
    const status = error.status || 500;
    res.status(status).json({ 
      error: status === 429 ? 'rate_limit_exceeded' : 'error', 
      message: error.message || 'An error occurred during summarization.' 
    });
  }
});

/**
 * Interactive Speaker Notes Brainstorm Chat Endpoint
 */
app.post('/api/chat-speaker-notes', async (req, res) => {
  try {
    const { messages, currentDocument, toc, currentSectionIndex, stage, topic, chatSummary } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing messages array.' });
    }

    logEvent('info', `Received speaker notes chat request. Messages: ${messages.length}, Stage: ${stage}, Section Index: ${currentSectionIndex}`);
    
    // Convert history messages (excluding latest prompt) to Gemini content format
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    }));

    const lastMessage = messages[messages.length - 1]?.text || '';

    // 1. Sliding Window History Bounding
    let activeHistory = [...history];
    if (activeHistory.length > 8) {
      logEvent('info', `Active chat history size (${activeHistory.length} turns) exceeds limit. Summarizing older turns for sliding window...`);
      const oldestTurns = activeHistory.slice(0, -4);
      const keepTurns = activeHistory.slice(-4);
      
      try {
        const summarySystemInstruction = 
          "You are a helpful assistant. Summarize the following brainstorming chat history between the user and the AI assistant regarding a presentation. Be extremely concise and capture only key decisions, approved titles, chosen themes, or specific details for slides. Keep the summary under 80 words.";
        
        const windowSummary = await generateContentWithFallback(
          oldestTurns,
          summarySystemInstruction,
          { responseMimeType: "text/plain" },
          SUBTASK_CHAT_SUMMARIZATION
        );
        
        // Prepend the summary as context in the active history
        activeHistory = [
          {
            role: 'user',
            parts: [{ text: `Summary of previous conversation context:\n${windowSummary}` }]
          },
          {
            role: 'model',
            parts: [{ text: "Understood. I will maintain this context and proceed with our conversation." }]
          },
          ...keepTurns
        ];
        logEvent('info', 'Successfully bounded history window and injected summary context.');
      } catch (sumErr) {
        logEvent('warn', `Failed to generate sliding window summary, proceeding with full history: ${sumErr.message}`);
      }
    }

    // Append the latest user prompt to the active history
    if (lastMessage) {
      activeHistory.push({
        role: 'user',
        parts: [{ text: lastMessage }]
      });
    }

    const chatSummaryContext = chatSummary ? `\n\nSummary of Previous Sections and Brainstorming (Context):\n-------------------\n${chatSummary}\n-------------------\n` : '';

    const systemInstruction = 
      `You are the AI Presentation Assistant, an expert presentation coach and speaker notes author. Your goal is to guide the user step-by-step through brainstorming and creating a complete, high-quality speaker notes document.
 
You operate in a sequence of stages:
1. Title Brainstorming ("title_brainstorm"):
   - Welcome the user. Brainstorm presentation title ideas based on their topic.
   - Do NOT propose a Table of Contents (ToC) yet. Focus on refining the title.
   - Propose title ideas in "options" as plain suggestions (e.g. ["Option A", "Option B", "Suggest more titles"]). Do NOT prefix them with "Approve Title:" or other action verbs.
   - Once the title is approved (action = "approve_title"), transition nextStage to "topic_scope".
2. Scope Brainstorming ("topic_scope"):
   - Brainstorm the talking points, main concepts, and overall scope of the presentation.
   - Do NOT generate the ToC yet. Chat with the user, answer their questions, and clarify what they want to talk about.
   - Propose options like: ["Generate Table of Contents", "Add another talking point"].
   - When the user clicks "Generate Table of Contents", generate a ToC built STRICTLY around the discussed talking points and transition nextStage to "toc".
3. Table of Contents Approval ("toc"):
   - Review and refine the ToC outline.
   - Propose options like: ["Send ToC to Document", "Make ToC shorter", "Add a section"].
   - Once ToC is approved (action = "approve_toc"), transition nextStage to "section_brainstorm" and currentSectionIndex to 0.
4. Section Brainstorming ("section_brainstorm"):
   - Enforce that you MUST discuss the sections one-by-one, in the exact order defined in the ToC. Focus ONLY on brainstorming ideas for the active section (Section Index ${currentSectionIndex}: "${toc[currentSectionIndex] || ''}").
   - Chat, suggest points, and ask questions. Do NOT generate the detailed draft notes (proposedSectionContent) yet.
   - Propose options like: ["Show Speaker Notes for this Section", "Suggest section ideas"].
   - When the user prompts to generate the draft, return the notes draft in "proposedSectionContent" and propose options like: ["Send to Document"].
   - Once committed (action = "approve_section"), move to the next section or transition nextStage to "complete".
5. Section Editing ("section_edit"):
   - You are revising the notes for Section Index ${currentSectionIndex}: "${toc[currentSectionIndex] || ''}".
   - CRITICAL: You must NOT assume what the user wants to change, and you must NOT generate the revised draft notes (do NOT populate 'proposedSectionContent') immediately.
   - First, ask the user what specific changes, additions, or removals they wish to make to this section. Propose simple options like ["Add more examples", "Make it shorter", "Explain in detail"].
   - Only after understanding their intent or receiving instructions should you generate the revised draft (populating 'proposedSectionContent') and offer: ["Send to Document"].
   - Once committed (action = "approve_section"), return nextStage to "complete".
6. Completion ("complete"):
   - If the user just finished editing a section (e.g. they clicked "Send to Document" or said "Update these revised notes..."), confirm that the edits have been successfully made to that specific section.
   - Do NOT automatically select, suggest, or transition to the next section.
   - Ask the user if they want to edit any other sections. Propose options to edit other sections, e.g. ["Edit Section 1: Intro", "Edit Section 2: Body", ...] and a final option ["No, I am happy with the document"].
   - If the user says "No", selects "No, I am happy with the document", or indicates they are happy with the document:
     - Respond with "Excellent!" or a warm congratulatory message, wish them well, and inform them that they can now download the document as a PDF (using the "Print / Save PDF" button on the top right) or proceed to other functions (like generating takeaway notes using the button at the top).
     - Do NOT offer a choice of creating takeaway notes in the chat.
     - Do NOT provide any options/buttons in the "options" array (return an empty array [] for "options" once they are happy).
     - However, if the user later inputs a manual request in the chat, fulfill it as requested.
 
Current State of the Workspace:
- Presentation Topic: "${topic || 'Not set yet'}"
- Current Stage: "${stage || 'title_brainstorm'}"
- Table of Contents: ${JSON.stringify(toc || [])}
- Current Section Index: ${currentSectionIndex ?? 0}
- Current Section Name: "${toc && toc[currentSectionIndex] ? toc[currentSectionIndex] : 'None'}"
 
Current Document Content (Ground Truth / Background Context):
-------------------
${currentDocument || '(Empty Document)'}
-------------------
${chatSummaryContext}
 
You must ALWAYS respond with a JSON object. The JSON object must match this schema:
{
  "reply": "Your conversational message to the user (written in friendly, encouraging Markdown). Summarize your suggestions, ask your next clarifying question, or explain the drafted content.",
  "nextStage": "title_brainstorm | topic_scope | toc | section_brainstorm | section_edit | complete",
  "topic": "The finalized or proposed presentation title/topic (updating dynamically as the user brainstorms and refines it)",
  "toc": ["Header 1", "Header 2", ...], // Include the current or updated Table of Contents array
  "proposedSectionContent": "HTML snippet (clean, semantic, print-safe) containing the proposed speaker notes for the CURRENT section ONLY. Start it with a header like <h2>Section Name</h2>. Do not wrap this in a full A4 page, just return the inner elements. Leave empty if not proposing content.",
  "currentSectionIndex": 0, // The index of the section you are currently working on
  "action": "approve_title | propose_toc | approve_toc | propose_section | approve_section | chat",
  "options": ["Option A", "Option B", ...] // Provide 2 to 5 clickable options/buttons for the user to select. Present choices appropriate for the current stage.
}
 
Contextual Guidelines:
- Document Awareness & Context: The 'Current Document Content' above contains the actual text/content that has already been generated, approved, and added to the presentation document. You must treat this document content as background context and the absolute ground truth. You must remain fully aware of what is already in the document, so that when the user refers to it, you understand it perfectly.
- Section Name Alignment: The section names used in your proposed section content headers (e.g. <h2>Section Name</h2> in 'proposedSectionContent') MUST match the section names defined in the Table of Contents ('toc') and the document layout exactly. Do not invent new section names or modify them.
- Section Numbering Alignment: Remember that 'currentSectionIndex' is a 0-based index (e.g. index 0 is Section 1, index 1 is Section 2, etc.). When referring to a section, always refer to it as "Section {index + 1}: {name}" to ensure you never mix up section numbers and section names.
- Detailed & Explanatory Drafts: The proposed speaker notes (in 'proposedSectionContent') must not be too concise. They should be highly descriptive, explanatory, and thorough, providing comprehensive talking points and details for the presenter.
- Strict Flow Execution: You must strictly follow the document structure and flows that the user has approved and committed to the document. Do not drift from the ideas and outlines established in the Table of Contents.
- Persistent Context: You have access to the full chat log and the entire generated document. Always use this information to maintain perfect context.
- Keep your replies under 150 words. Be focused and helpful.
- Return ONLY the raw JSON object. Do not wrap in markdown code blocks.`;

    // Compute hash for context caching
    const cachedContentHash = getContentHash(systemInstruction, topic, toc, currentDocument);

    // Set headers for Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Initiate the streaming connection using the fallback router
    const { responseStream, modelName, keyIndex } = await generateContentStreamWithFallback(
      activeHistory,
      systemInstruction,
      {
        responseMimeType: "application/json",
        cachedContentHash,
        topic,
        toc,
        currentDocument
      },
      SUBTASK_CONTENT_DRAFTING
    );

    // Stream the generated JSON chunks directly to the client
    for await (const chunk of responseStream) {
      res.write(`data: ${JSON.stringify({ chunk: chunk.text })}\n\n`);
    }

    // Update current active key index upon successful stream completion
    currentKeyIndex = keyIndex;
    logEvent('info', `Stream completed successfully using Key: ${apiKeysPool[keyIndex]?.label} for model ${modelName}`);

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error) {
    logEvent('error', `Chat speaker notes streaming failed: ${error.message}`);
    
    if (res.headersSent) {
      // If headers were already sent, write a special error event to close the stream
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    } else {
      const status = error.status || 500;
      res.status(status).json({ 
        error: status === 429 ? 'rate_limit_exceeded' : 'error', 
        message: error.message || 'An error occurred during chat.' 
      });
    }
  }
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
    const bStrictFileContentOnly = strictFileContentOnly === 'true';

    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'No files were uploaded.' });

    const effectiveSetting = setting === 'Other' && customSetting ? customSetting : setting;

    logEvent('info', `Received generate request with ${files.length} files.`, {
      colorScheme, detailLevel, writingTheme,
      targetAudience, setting: effectiveSetting,
      bExtractEventName, bExtractEventDate, bExtractCoverInfo, bStrictFileContentOnly
    });

    // 1. Text Extraction
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

    // 2. Programmatic Media Harvesting
    logEvent('info', 'Harvesting and mapping embedded media from uploaded files...');
    const mediaOutputDir = path.join(__dirname, 'public/extracted_media');
    const mediaHarvestPromises = files.map(file => {
      return harvestMedia(file.buffer, file.originalname, mediaOutputDir)
        .catch(err => {
          logEvent('error', `Error harvesting media from ${file.originalname}: ${err.message}`);
          return [];
        });
    });
    const harvestedMediaResults = await Promise.all(mediaHarvestPromises);
    const allExtractedImages = harvestedMediaResults.flat();
    logEvent('info', `Successfully harvested ${allExtractedImages.length} images/charts from uploaded files.`);

    // 3. Slide Complexity Analysis (Page Budgeting)
    logEvent('info', 'Running Slide Complexity Analyzer for page budgeting...');
    let pageAllocations = [];
    try {
      pageAllocations = await analyzeSlides(files[0].buffer, files[0].originalname);
      logEvent('info', `Programmatic Page Budgeting completed: Allocated slides into ${pageAllocations.length} A4 pages.`);
    } catch (err) {
      logEvent('error', `Slide complexity analysis failed, falling back to 1 slide per page: ${err.message}`);
      pageAllocations = [{ pageNumber: 1, slideIndices: [1], complexity: 10, isCover: true, title: 'Cover Page' }];
    }

    // 4. Load the JSON Template Registry dynamically
    let registryContent = "";
    try {
      const registryPath = path.join(__dirname, 'templates/registry.json');
      registryContent = fs.readFileSync(registryPath, 'utf8');
    } catch (err) {
      logEvent('error', `Failed to read template registry.json: ${err.message}`);
      throw new Error(`System failure: template registry is inaccessible.`);
    }

    const detailInstructions = {
      'Brief': 'Produce a HIGH-IMPACT, CONDENSED summary. Focus EXCLUSIVELY on the absolute core highlights, main thesis, and 3-5 key takeaways per section.',
      'Moderate': 'Produce a BALANCED, STANDARD summary. Cover all primary sections, speaker insights, and main slide concepts.',
      'Comprehensive': 'Produce an EXHAUSTIVE, DEEP BREAKDOWN. Capture ALL terminology, definitions, explanations, formulas, and detailed supporting notes.'
    };
    const detailInstruction = detailInstructions[detailLevel] || detailInstructions['Moderate'];

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

    // 5. Build the Stage 1 Prompt (JSON Synthesis)
    logEvent('info', 'Executing Stage 1: Planning and synthesizing structured JSON page contents...');

    const summarizerSystemInstruction = 
      "You are an expert content synthesizer and editor. Your task is to summarize the provided presentation source text into a structured JSON array of page objects. " +
      "Each page object represents a single A4 page and must contain a 'pageNumber', a 'pageTitle', and a 'sections' array. " +
      "The 'sections' array contains one or more section block objects (e.g. StandardTextBlock, TwoColumnBlock, HeroCallout) stacked vertically. " +
      "For pages summarizing a single slide or heavy content, place a single section. For pages with multiple slides or lighter content, you can stack 2 or more sections (e.g. a StandardTextBlock followed by a HeroCallout) to optimize page space. " +
      "You MUST strictly adhere to the pre-calculated A4 page allocation plan provided in the prompt. Do NOT add pages, remove pages, or change the slide allocations. " +
      "CRITICAL: The output must contain ONLY a valid JSON array matching the schemas. Do NOT wrap in markdown code blocks and do NOT add any conversational text. " +
      (bStrictFileContentOnly 
        ? "CRITICAL FACTS: Summarize ONLY information explicitly stated in the source text. Do NOT introduce pre-trained knowledge, definitions, external history, or context not written in the files."
        : "You may supplement the notes with external definitions, explanations, and background context if helpful for explaining the slide topics.");

    const summarizerPrompt = `
Task: Synthesize the presentation source text into a structured JSON array of page summaries.

Source Text: 
${combinedSourceText.substring(0, 150000)}

Preferences:
- Detail level: ${detailInstruction}
- Target Audience: ${targetAudience}
- Setting: ${effectiveSetting}
- Metadata: ${metadataBlock}
${extractionInstructions}

--- Programmatic Page Allocation Plan ---
You MUST generate exactly ${pageAllocations.length} page objects in your JSON array. The slides allocated to each page are:
${pageAllocations.map(p => {
  if (p.isCover) return `- Page ${p.pageNumber}: Cover Title Sheet (use CoverBlock section)`;
  let splitText = "";
  if (p.isSplitPart === 1) splitText = " (Part 1: first half of content)";
  else if (p.isSplitPart === 2) splitText = " (Part 2: second half of content)";
  return `- Page ${p.pageNumber}: Summarize content of slides [${p.slideIndices.join(', ')}]${splitText} using title: "${p.title}"`;
}).join('\n')}

--- Available Template Presets (registry.json) ---
For each section object inside the "sections" array, set "sectionType" to one of these preset names and populate its corresponding fields:
${registryContent}

--- Available Extracted Images for Placement ---
If a page contains slide indices that have corresponding images in this list, you MUST select the most relevant image, add a section with "sectionType": "MediaBlock", and populate "imageId", "caption", and "resolvedClass" accordingly. Do NOT place the same image multiple times.
Extracted Images: ${JSON.stringify(allExtractedImages)}

JSON Output Schema:
[
  {
    "pageNumber": 1,
    "pageTitle": "Leveraging AI in Modern Enterprise Architecture",
    "sections": [
      {
        "sectionType": "CoverBlock",
        "title": "Leveraging AI in Modern Enterprise Architecture",
        "subtitle": "Subtitle",
        "author": "Author",
        "date": "Date"
      }
    ]
  },
  {
    "pageNumber": 2,
    "pageTitle": "Comparison and Core Takeaway",
    "sections": [
      {
        "sectionType": "TwoColumnBlock",
        "leftColumnHeader": "Left Header",
        "leftColumnBullets": ["bullet 1", "bullet 2"],
        "rightColumnHeader": "Right Header",
        "rightColumnBullets": ["bullet 1"]
      },
      {
        "sectionType": "HeroCallout",
        "quoteText": "This is a key quote.",
        "author": "Source",
        "highlightText": "Takeaway summary"
      }
    ]
  }
]
`;

    // Calculate total complexity and average complexity
    const totalComplexity = pageAllocations.reduce((sum, p) => sum + p.complexity, 0);
    const avgComplexity = pageAllocations.length > 0 ? totalComplexity / pageAllocations.length : 0;
    const maxComplexity = pageAllocations.reduce((max, p) => Math.max(max, p.complexity), 0);
    
    logEvent('info', `Slide deck complexity metrics: Total=${totalComplexity}, Avg=${avgComplexity.toFixed(2)}, Max=${maxComplexity}`);

    // Intelligent Model Routing (Granular Sub-task Mapping)
    let modelChainToUse = SUBTASK_TAKEAWAY_GENERATION_FLASH;
    let routingReason = "Standard complexity (routed to fast & cheap Flash model)";
    
    const isHeavyDeck = avgComplexity >= 20 || maxComplexity >= 35 || detailLevel === 'Comprehensive';
    if (isHeavyDeck) {
      modelChainToUse = SUBTASK_TAKEAWAY_GENERATION_PRO;
      routingReason = "High complexity/density or Comprehensive request (routed to deep & thorough Pro model)";
    }
    
    logEvent('info', `Intelligent Model Routing: Selected chain based on complexity. Reason: ${routingReason}`);

    let summaryText = await generateContentWithRotation(
      summarizerPrompt,
      summarizerSystemInstruction,
      { responseMimeType: "application/json" },
      modelChainToUse
    );

    let summaryJSON;
    try {
      summaryJSON = cleanAndParseJson(summaryText);
    } catch (parseError) {
      logEvent('error', `Failed to parse summary JSON. Raw text: "${summaryText}"`, { error: parseError.message });
      throw new Error(`Failed to parse structured summary JSON: ${parseError.message}`);
    }

    logEvent('info', `Stage 1 Completed: Successfully synthesized ${summaryJSON.length} page summary JSON plans.`);

    // 6. Map UI theme and palette inputs to CSS slugs
    const themeMap = {
      'Formal & Professional': 'formal_professional',
      'Warm & Encouraging': 'warm_encouraging',
      'Fun & Energetic': 'fun_energetic',
      'Reflective & Thoughtful': 'reflective_thoughtful',
      'Educational & Informative': 'educational_informative',
      'Motivational & Inspiring': 'motivational_inspiring'
    };

    const paletteMap = {
      'Corporate Navy': 'corporate_navy',
      'Warm Forest': 'warm_forest',
      'Electric Purple': 'electric_purple',
      'Sunset Amber': 'sunset_amber',
      'Elegant Charcoal': 'elegant_charcoal',
      'Midnight Teal': 'midnight_teal',
      'Crimson Gold': 'crimson_gold',
      'Nordic Sage': 'nordic_sage',
      'Cyberpunk Neon': 'cyberpunk_neon',
      'Vintage Cream': 'vintage_cream',
      // Fallback mappings for older frontend choices
      'Cool Tech (Indigo & Slate)': 'corporate_navy',
      'Warm Corporate (Amber & Charcoal)': 'sunset_amber',
      'Sleek Dark Mode (Midnight Blue)': 'cyberpunk_neon',
      'Vibrant Modern (Teal & Emerald)': 'midnight_teal',
      'Ocean Breeze': 'corporate_navy',
      'Sunset Glow': 'sunset_amber',
      'Monochrome': 'elegant_charcoal'
    };

    const selectedTheme = themeMap[writingTheme] || 'formal_professional';
    const selectedPalette = paletteMap[colorScheme] || 'corporate_navy';

    // 7. Compile the HTML document programmatically
    logEvent('info', `Executing Stage 2: Programmatically compiling layouts using Theme "${selectedTheme}" & Palette "${selectedPalette}"...`);
    
    const compiledHtml = compileDocument(summaryJSON, selectedTheme, selectedPalette);
    
    logEvent('info', `E2E Generation completed successfully. Compiled ${summaryJSON.length} pages in under 10ms.`);

    res.json({ html: compiledHtml });

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

    const rawAiResponse = await generateContentWithRotation(
      prompt,
      systemInstruction,
      {},
      SUBTASK_REVISION_ANALYSIS
    );

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

    let htmlValidated = await generateContentWithRotation(
      validatorPrompt,
      validatorSystemInstruction,
      {},
      SUBTASK_HTML_COMPILATION
    );
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

// Serve production frontend assets in single-container mode (Cloud Run ready)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, 'public/dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(path.join(distPath, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  // Perform the initial startup check inside a dynamic system session run
  const initialCheckSessionId = generateSystemSessionId();
  sessionLocalStorage.run({ sessionId: initialCheckSessionId, latencyBudget: 'system', initiator: 'system' }, () => {
    logEvent('info', `Backend server running on http://localhost:${PORT}`);
    checkAllKeysQuotas().catch(err => {
      logEvent('error', `Failed initial startup key quota check: ${err.message}`);
    });
  });

  // Start the background differential recovery cron (runs a lightweight check every 10 seconds)
  setInterval(async () => {
    const cronSessionId = generateSystemSessionId();
    sessionLocalStorage.run({ sessionId: cronSessionId, latencyBudget: 'system', initiator: 'system' }, async () => {
      const now = Date.now();
      const disabledItems = [];

      apiKeysPool.forEach(k => {
        // MANUAL OVERRIDE GUARD: Skip keys the user has explicitly turned off
        if (k.manualKeyState === 'off') return;

        if (k.enabled && k.status !== 'Disabled') {
          for (const modelName in k.modelEnabled) {
            // MANUAL OVERRIDE GUARD: Skip manual_off models — only attempt quota_depleted recovery
            if (k.modelEnabled[modelName] === 'quota_depleted') {
              const attempts = k.recoveryAttempts[modelName] || 0;
              const disabledAt = k.disabledAt[modelName] || now;
              const lastCheck = k.lastRecoveryCheckAt[modelName] || disabledAt;

              // Calculate backoff delay: 60s for 1st attempt, 3m for 2nd, 5m for subsequent
              let cooldownMs = 60 * 1000;
              if (attempts === 1) {
                cooldownMs = 3 * 60 * 1000;
              } else if (attempts >= 2) {
                cooldownMs = 5 * 60 * 1000;
              }

              // Check if the cooldown window has fully elapsed
              if (now - lastCheck >= cooldownMs) {
                disabledItems.push({ keyObj: k, modelName });
              }
            }
            // manual_off stays manual_off — background ticker never touches it
          }
        }
      });

      if (disabledItems.length === 0) {
        return; // Quiet tick, zero quota consumed
      }

      logEvent('info', `Background Sync: Running scheduled backoff checks on ${disabledItems.length} rate-limited key-model pairs...`);

      const promises = disabledItems.map(async ({ keyObj, modelName }) => {
        // Apply randomized delay (jitter) to prevent concurrent request spikes
        const jitter = Math.floor(Math.random() * 300);
        await new Promise(resolve => setTimeout(resolve, jitter));

        // Record this check attempt
        keyObj.recoveryAttempts[modelName] = (keyObj.recoveryAttempts[modelName] || 0) + 1;
        keyObj.lastRecoveryCheckAt[modelName] = Date.now();

        try {
          const ai = new GoogleGenAI({ apiKey: keyObj.key });
          await ai.models.generateContent({
            model: modelName,
            contents: ".",
            config: {
              maxOutputTokens: 1,
              temperature: 0.0
            }
          });
          
          // Success! Restore to active and clear tracking stats
          keyObj.modelEnabled[modelName] = 'active';
          if (keyObj.disabledAt) delete keyObj.disabledAt[modelName];
          if (keyObj.lastRecoveryCheckAt) delete keyObj.lastRecoveryCheckAt[modelName];
          if (keyObj.recoveryAttempts) delete keyObj.recoveryAttempts[modelName];
          
          logEvent('info', `Background Sync: Recovered model "${modelName}" on Key "${keyObj.label}" to active.`);
        } catch (err) {
          const status = getErrorStatus(err);
          if (status === 401 || status === 403) {
            keyObj.status = 'Invalid';
            keyObj.enabled = false;
            // Auth errors are system-detected, NOT user-initiated — do not set manualKeyState
            logEvent('warn', `Background Sync: Disabled Key "${keyObj.label}" due to auth error.`);
          } else {
            logEvent('info', `Background Sync: Model "${modelName}" on Key "${keyObj.label}" remains rate-limited (Attempt ${keyObj.recoveryAttempts[modelName]}).`);
          }
        }
      });

      await Promise.all(promises);
      saveDisabledKeysAndModels();
      // Push updated key pool after any recovery tick that made changes
      broadcastSSE('key', keyStatuses);
    });
  }, 10 * 1000); // 10 seconds
});
