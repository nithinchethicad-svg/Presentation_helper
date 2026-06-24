const express = require('express');
const cors = require('cors');
const multer = require('multer');
const dotenv = require('dotenv');
const officeParser = require('officeparser');
const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const { harvestMedia } = require('./utils/mediaHarvester');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve extracted presentation images statically
app.use('/extracted_media', express.static(path.join(__dirname, 'public/extracted_media')));

// Set up Multer for in-memory file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Configure Gemini API keys for rotation
// If the primary single key GEMINI_API_KEY is provided, we prioritize it and phase out the 7-key rotation system.
// This allows the user to easily transition to a single paid-tier key without having to delete the 7 free-tier keys.
let apiKeys = [];
if (process.env.GEMINI_API_KEY) {
  apiKeys.push(process.env.GEMINI_API_KEY);
} else {
  apiKeys = [
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7
  ].filter(key => !!key); // Keep only non-empty keys
}

// Current active key index
let currentKeyIndex = 0;

// Stores key verification status dynamically
let keyStatuses = apiKeys.map((key, idx) => ({
  index: idx + 1,
  maskedKey: key ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}` : 'Not Set',
  status: 'Not Checked',
  modelResults: null,
  lastChecked: null
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

  const promises = apiKeys.map(async (key, idx) => {
    const modelResults = {};
    let activeCount = 0;
    let authError = null;
    let quotaErrorCount = 0;
    
    // Check models sequentially for this key to prevent rate limit spikes on Free Tier
    for (const modelName of modelsToCheck) {
      try {
        const ai = new GoogleGenAI({ apiKey: key });
        await ai.models.generateContent({
          model: modelName,
          contents: "ping",
        });
        modelResults[modelName] = { working: true, status: 'Active', error: null };
        activeCount++;
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
        }
      }
      // Add a tiny 100ms sleep between model checks to prevent aggressive hammering
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Determine overall key status
    let overallStatus = 'Inactive';
    if (activeCount === modelsToCheck.length) {
      overallStatus = 'Active (All Models)';
    } else if (activeCount > 0) {
      overallStatus = `Active (${activeCount}/${modelsToCheck.length} Models)`;
    } else if (authError) {
      overallStatus = 'Invalid Key (Auth Error)';
    } else if (quotaErrorCount > 0) {
      overallStatus = 'Quota Exceeded (429)';
    } else {
      overallStatus = 'Failed / Error';
    }

    keyStatuses[idx] = {
      index: idx + 1,
      maskedKey: key ? `${key.substring(0, 8)}...${key.substring(key.length - 4)}` : 'Not Set',
      status: overallStatus,
      modelResults,
      lastChecked: new Date().toLocaleTimeString()
    };
  });

  await Promise.all(promises);
  logEvent('info', 'Completed comprehensive Gemini API key quota verification check across all models.');
}

// Get the model name from environment or default to gemini-3.5-flash.
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash';

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
/**
 * Model priority chain for fallback routing.
 * Attempts execution across models in priority order to prevent 429 quota exhaustion.
 */
// 1. For simple background tasks (Summarization)
const SUMMARIZATION_MODEL_CHAIN = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash'
];

// 2. For instant conversational UI (Speaker Notes Chat)
const CHAT_MODEL_CHAIN = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-3.1-flash-lite'
];

// 3. For creative, complex coding & visual layout (Stage 2 HTML Draft)
const CREATIVE_LAYOUT_MODEL_CHAIN = [
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash'
];

// 4. For structured JSON planning & surgical code edits (Stage 1, Stage 3, & Revisions)
const STRUCTURED_CODING_MODEL_CHAIN = [
  'gemini-3.5-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro'
];

// Keep the old constants as fallback aliases for backward compatibility
const MODEL_FALLBACK_CHAIN = STRUCTURED_CODING_MODEL_CHAIN;
const LIGHT_MODEL_FALLBACK_CHAIN = SUMMARIZATION_MODEL_CHAIN;

/**
 * Helper function to determine if we should fall back to the next model in the chain.
 * Falls back on any temporary, quota, availability, or model-specific error,
 * but returns false for authentication errors (401 / 403) which cannot be solved by model switching.
 */
const isFallbackTrigger = (error) => {
  const status = getErrorStatus(error);
  return status !== 401 && status !== 403;
};

/**
 * Core stateless content generation with multi-model fallback and key rotation.
 * Iterates through model priority chain and rotates through API keys.
 */
async function generateContentWithFallback(contents, systemInstruction, extraConfig = {}, modelChain = MODEL_FALLBACK_CHAIN) {
  if (apiKeys.length === 0) {
    const errorMsg = "No AI service API keys configured. Please add keys to your backend/.env file.";
    logEvent('error', errorMsg);
    throw new Error(errorMsg);
  }

  const errors = [];

  // Loop through model families in priority chain
  for (const modelName of modelChain) {
    let attempts = 0;
    const maxAttempts = Math.max(5, apiKeys.length * 2);
    let modelHasWorkableKeys = false;

    // Check if we have a cache hit for this modelName and hash
    let pinnedKeyIndex = null;
    let cachedContentName = null;
    if (extraConfig.cachedContentHash) {
      for (let i = 0; i < apiKeys.length; i++) {
        const cacheKey = `${modelName}_${i}_${extraConfig.cachedContentHash}`;
        const cacheEntry = contextCacheMap.get(cacheKey);
        if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
          pinnedKeyIndex = i;
          cachedContentName = cacheEntry.name;
          break;
        }
      }
    }

    // Loop through keys for the current model
    while (attempts < maxAttempts) {
      const keyIndex = (pinnedKeyIndex !== null && attempts === 0) ? pinnedKeyIndex : (currentKeyIndex + attempts) % apiKeys.length;
      const apiKey = apiKeys[keyIndex];
      const maskedKey = apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'undefined';
      
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

      logEvent('info', `Attempting model ${modelName} with Key Index ${keyIndex + 1}/${apiKeys.length} (${maskedKey})`, {
        model: modelName,
        keyIndex: keyIndex + 1,
        promptSnippet
      });

      // Manage Context Cache
      let cacheToUse = null;
      if (extraConfig.cachedContentHash) {
        if (pinnedKeyIndex === keyIndex) {
          cacheToUse = cachedContentName;
          logEvent('info', `Cache hit for model ${modelName} using Key Index ${keyIndex + 1}: ${cacheToUse}`);
        } else {
          // Cache miss for this key index: try to create a new cache
          const cacheKey = `${modelName}_${keyIndex}_${extraConfig.cachedContentHash}`;
          const disableKey = `${modelName}_${keyIndex}`;

          if (keysWithoutCacheQuota.has(disableKey)) {
            logEvent('info', `Bypassing context cache creation for Key Index ${keyIndex + 1} (known Free Tier key with no cache quota for ${modelName})`);
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
                logEvent('info', `Creating context cache for Key Index ${keyIndex + 1}. Token count ${totalTokens} >= threshold ${minTokens} for ${modelName}`);
                const cache = await tempAi.caches.create({
                  model: modelName,
                  config: {
                    contents: cacheContents,
                    ttl: '600s' // 10 minutes TTL
                  }
                });
                contextCacheMap.set(cacheKey, {
                  name: cache.name,
                  expiresAt: Date.now() + 600 * 1000
                });
                cacheToUse = cache.name;
                logEvent('info', `Successfully created context cache on Key Index ${keyIndex + 1}: ${cache.name}`);
              } else {
                logEvent('info', `Bypassing context cache for Key Index ${keyIndex + 1}: token count ${totalTokens} is less than threshold ${minTokens} for ${modelName}`);
              }
            } catch (cacheErr) {
              const errMsg = cacheErr.message || '';
              logEvent('warn', `Failed to create context cache for ${modelName} using Key ${keyIndex + 1}: ${errMsg}`);
              
              if (errMsg.includes('limit=0') || 
                  errMsg.includes('TotalCachedContentStorageTokens') || 
                  errMsg.includes('limit exceeded') || 
                  errMsg.includes('Free tier') ||
                  errMsg.includes('Community tier')) {
                keysWithoutCacheQuota.add(disableKey);
                logEvent('info', `Key Index ${keyIndex + 1} identified as Free Tier (no cache storage quota) for ${modelName}. Added to bypass list.`);
              }
            }
          }
        }
      }

      try {
        const ai = new GoogleGenAI({ apiKey });
        let responseText;

        if (cacheToUse) {
          // Pass the systemInstruction at query time when using the cache
          const { cachedContentHash, topic, toc, currentDocument, ...restConfig } = extraConfig;
          const response = await ai.models.generateContent({
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
          // Standard call without cache
          const { cachedContentHash, topic, toc, currentDocument, ...restConfig } = extraConfig;
          const response = await ai.models.generateContent({
            model: modelName,
            contents: contents,
            config: {
              ...(systemInstruction ? { systemInstruction } : {}),
              ...restConfig
            }
          });
          responseText = response.text;
        }

        // Update current index to this successful key
        currentKeyIndex = keyIndex;
        logEvent('info', `Success! Model ${modelName} responded using Key Index ${keyIndex + 1}/${apiKeys.length}`);
        return responseText;
      } catch (error) {
        // If we had a cache to use, clear it since it might be invalid/expired on the server
        if (extraConfig.cachedContentHash) {
          const cacheKey = `${modelName}_${keyIndex}_${extraConfig.cachedContentHash}`;
          contextCacheMap.delete(cacheKey);
        }

        const errStatus = getErrorStatus(error);
        const errMsg = error.message || '';
        
        logEvent('warn', `API call failed for model ${modelName} using Key ${keyIndex + 1}/${apiKeys.length} (Status: ${errStatus})`, {
          model: modelName,
          keyIndex: keyIndex + 1,
          errorMessage: errMsg
        });

        errors.push({ model: modelName, keyIndex: keyIndex + 1, status: errStatus, message: errMsg });
        
        if (errStatus === 429) {
          const delayMs = 1500;
          logEvent('info', `Rate limit hit (429). Sleeping for ${delayMs}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // If this error is a fallback trigger, we continue model rotation
        if (isFallbackTrigger(error)) {
          modelHasWorkableKeys = true; 
        }
        attempts++;
      }
    }

    // If we exhausted all keys for this model and it was due to quota/model-availability,
    // we sequentially cascade to the next model in the chain.
    if (modelHasWorkableKeys) {
      logEvent('info', `Cascading down from model ${modelName} to the next model in fallback chain.`);
    } else {
      // If none of the keys failed with quota/availability (e.g. all 7 keys failed with Auth errors),
      // we stop and throw, because changing models won't fix invalid keys.
      const allAuth = errors.filter(e => e.model === modelName).every(e => e.status === 401 || e.status === 403);
      if (allAuth) {
        logEvent('error', `Aborting fallback: All keys failed with authentication errors.`);
        break;
      }
    }
  }

  // If all models and keys failed
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
  if (apiKeys.length === 0) {
    const errorMsg = "No AI service API keys configured. Please add keys to your backend/.env file.";
    logEvent('error', errorMsg);
    throw new Error(errorMsg);
  }

  const errors = [];

  // Loop through model families in priority chain
  for (const modelName of modelChain) {
    let attempts = 0;
    const maxAttempts = Math.max(5, apiKeys.length * 2);
    let modelHasWorkableKeys = false;

    // Check if we have a cache hit for this modelName and hash
    let pinnedKeyIndex = null;
    let cachedContentName = null;
    if (extraConfig.cachedContentHash) {
      for (let i = 0; i < apiKeys.length; i++) {
        const cacheKey = `${modelName}_${i}_${extraConfig.cachedContentHash}`;
        const cacheEntry = contextCacheMap.get(cacheKey);
        if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
          pinnedKeyIndex = i;
          cachedContentName = cacheEntry.name;
          break;
        }
      }
    }

    // Loop through keys for the current model
    while (attempts < maxAttempts) {
      const keyIndex = (pinnedKeyIndex !== null && attempts === 0) ? pinnedKeyIndex : (currentKeyIndex + attempts) % apiKeys.length;
      const apiKey = apiKeys[keyIndex];
      const maskedKey = apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'undefined';
      
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

      logEvent('info', `Attempting stream connection for model ${modelName} with Key Index ${keyIndex + 1}/${apiKeys.length} (${maskedKey})`, {
        model: modelName,
        keyIndex: keyIndex + 1,
        promptSnippet
      });

      // Manage Context Cache
      let cacheToUse = null;
      if (extraConfig.cachedContentHash) {
        if (pinnedKeyIndex === keyIndex) {
          cacheToUse = cachedContentName;
          logEvent('info', `Cache hit for model ${modelName} using Key Index ${keyIndex + 1}: ${cacheToUse}`);
        } else {
          // Cache miss for this key index: try to create a new cache
          const cacheKey = `${modelName}_${keyIndex}_${extraConfig.cachedContentHash}`;
          const disableKey = `${modelName}_${keyIndex}`;

          if (keysWithoutCacheQuota.has(disableKey)) {
            logEvent('info', `Bypassing context cache creation for Key Index ${keyIndex + 1} (known Free Tier key with no cache quota for ${modelName})`);
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
                logEvent('info', `Creating context cache for Key Index ${keyIndex + 1}. Token count ${totalTokens} >= threshold ${minTokens} for ${modelName}`);
                const cache = await tempAi.caches.create({
                  model: modelName,
                  config: {
                    contents: cacheContents,
                    ttl: '600s' // 10 minutes TTL
                  }
                });
                contextCacheMap.set(cacheKey, {
                  name: cache.name,
                  expiresAt: Date.now() + 600 * 1000
                });
                cacheToUse = cache.name;
                logEvent('info', `Successfully created context cache on Key Index ${keyIndex + 1}: ${cache.name}`);
              } else {
                logEvent('info', `Bypassing context cache for Key Index ${keyIndex + 1}: token count ${totalTokens} is less than threshold ${minTokens} for ${modelName}`);
              }
            } catch (cacheErr) {
              const errMsg = cacheErr.message || '';
              logEvent('warn', `Failed to create context cache for ${modelName} using Key ${keyIndex + 1}: ${errMsg}`);
              
              if (errMsg.includes('limit=0') || 
                  errMsg.includes('TotalCachedContentStorageTokens') || 
                  errMsg.includes('limit exceeded') || 
                  errMsg.includes('Free tier') ||
                  errMsg.includes('Community tier')) {
                keysWithoutCacheQuota.add(disableKey);
                logEvent('info', `Key Index ${keyIndex + 1} identified as Free Tier (no cache storage quota) for ${modelName}. Added to bypass list.`);
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

        logEvent('info', `Stream connection established for model ${modelName} using Key Index ${keyIndex + 1}/${apiKeys.length}`);
        return { responseStream, modelName, keyIndex };
      } catch (error) {
        // If we had a cache to use, clear it since it might be invalid/expired on the server
        if (extraConfig.cachedContentHash) {
          const cacheKey = `${modelName}_${keyIndex}_${extraConfig.cachedContentHash}`;
          contextCacheMap.delete(cacheKey);
        }

        const errStatus = getErrorStatus(error);
        const errMsg = error.message || '';
        
        logEvent('warn', `Stream connection failed for model ${modelName} using Key ${keyIndex + 1}/${apiKeys.length} (Status: ${errStatus})`, {
          model: modelName,
          keyIndex: keyIndex + 1,
          errorMessage: errMsg
        });

        errors.push({ model: modelName, keyIndex: keyIndex + 1, status: errStatus, message: errMsg });
        
        if (errStatus === 429) {
          const delayMs = 1500;
          logEvent('info', `Rate limit hit (429). Sleeping for ${delayMs}ms before next attempt...`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        // If this error is a fallback trigger, we continue model rotation
        if (isFallbackTrigger(error)) {
          modelHasWorkableKeys = true; 
        }
        attempts++;
      }
    }

    // If we exhausted all keys for this model and it was due to quota/model-availability,
    // we sequentially cascade to the next model in the chain.
    if (modelHasWorkableKeys) {
      logEvent('info', `Cascading down from model ${modelName} to the next model in fallback chain.`);
    } else {
      // If none of the keys failed with quota/availability (e.g. all 7 keys failed with Auth errors),
      // we stop and throw, because changing models won't fix invalid keys.
      const allAuth = errors.filter(e => e.model === modelName).every(e => e.status === 401 || e.status === 403);
      if (allAuth) {
        logEvent('error', `Aborting fallback: All keys failed with authentication errors.`);
        break;
      }
    }
  }

  // If all models and keys failed
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
      margin: 0 !important;
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
 * Check Quotas Endpoint
 */
app.get('/api/check-quotas', async (req, res) => {
  try {
    await checkAllKeysQuotas();
    res.redirect('/api/logs');
  } catch (error) {
    logEvent('error', `Failed to check quotas: ${error.message}`);
    res.status(500).send(`Error checking quotas: ${error.message}`);
  }
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
          // Temporarily disable auto refresh while inspecting error so it doesn't close on reload
          autoRefresh = false;
          
          if (cell.style.whiteSpace === 'normal') {
            cell.style.whiteSpace = 'nowrap';
            cell.style.maxWidth = '300px';
            cell.style.overflow = 'hidden';
            cell.style.textOverflow = 'ellipsis';
            // Resume auto refresh if no cells are expanded
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
          <!-- Quota Checker Table -->
          <section style="margin-bottom: 2rem; background-color: var(--card-bg); padding: 1.5rem; border-radius: 8px; border: 1px solid var(--border-color);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h2 style="margin: 0; font-size: 1.3rem; color: var(--info-color);">AI API Keys Quota Status</h2>
              <a href="/api/check-quotas" class="btn btn-primary" style="background-color: var(--info-color); color: #0f172a; border-radius: 6px; padding: 0.4rem 0.8rem; font-size: 0.85rem; text-decoration: none; display: inline-flex; align-items: center; gap: 0.25rem;">🔄 Check Quotas Now</a>
            </div>
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
              <thead>
                <tr style="border-bottom: 2px solid var(--border-color); color: var(--text-muted);">
                  <th style="padding: 8px;">Key Index</th>
                  <th style="padding: 8px;">Masked Key</th>
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
                  
                  let modelStatusHtml = '<div style="display: flex; flex-wrap: wrap; gap: 6px;">';
                  if (k.modelResults) {
                    Object.entries(k.modelResults).forEach(([modelName, res]) => {
                      let mColor = '#ef4444'; // Red for failed
                      if (res.working) mColor = '#10b981'; // Green for working
                      else if (res.status.includes('429')) mColor = '#f59e0b'; // Amber for quota
                      
                      const shortModelName = modelName.replace('gemini-', '');
                      const titleText = res.working ? 'Working (Connection OK)' : `${res.status}: ${res.error.replace(/"/g, '&quot;')}`;
                      
                      modelStatusHtml += `
                        <span style="background-color: rgba(30, 41, 59, 0.5); border: 1px solid ${mColor}; color: ${mColor}; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-family: monospace; font-weight: 600;" title="${titleText}">
                          ${shortModelName}: ${res.working ? 'OK' : 'ERR'}
                        </span>
                      `;
                    });
                  } else {
                    modelStatusHtml += '<span style="color: var(--text-muted); font-size: 0.8rem;">No model data (Check Quotas to verify)</span>';
                  }
                  modelStatusHtml += '</div>';

                  return `
                    <tr style="border-bottom: 1px solid var(--border-color);">
                      <td style="padding: 12px 8px; font-weight: bold;">Key #${k.index}</td>
                      <td style="padding: 12px 8px; font-family: monospace;">${k.maskedKey}</td>
                      <td style="padding: 12px 8px;">
                        <span style="background-color: ${badgeColor}; color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: bold; display: inline-block;">
                          ${k.status}
                        </span>
                      </td>
                      <td style="padding: 12px 8px;">${modelStatusHtml}</td>
                      <td style="padding: 12px 8px; color: var(--text-muted);">${k.lastChecked || 'Never Checked'}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </section>

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
      SUMMARIZATION_MODEL_CHAIN
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
          SUMMARIZATION_MODEL_CHAIN
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
      CHAT_MODEL_CHAIN
    );

    // Stream the generated JSON chunks directly to the client
    for await (const chunk of responseStream) {
      res.write(`data: ${JSON.stringify({ chunk: chunk.text })}\n\n`);
    }

    // Update current active key index upon successful stream completion
    currentKeyIndex = keyIndex;
    logEvent('info', `Stream completed successfully using Key Index ${keyIndex + 1}/${apiKeys.length} for model ${modelName}`);

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

    // Run the programmatic media harvester to extract, map, and size embedded images/charts
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

    const detailInstructions = {
      'Brief': 'Produce a HIGH-IMPACT, CONDENSED summary. Focus EXCLUSIVELY on the absolute core highlights, main thesis, and 3-5 key takeaways per section.',
      'Moderate': 'Produce a BALANCED, STANDARD summary. Cover all primary sections, speaker insights, and main slide concepts.',
      'Comprehensive': 'Produce an EXHAUSTIVE, DEEP BREAKDOWN. Capture ALL terminology, definitions, explanations, formulas, and detailed supporting notes.'
    };
    const detailInstruction = detailInstructions[detailLevel] || detailInstructions['Moderate'];

    const vibeThemeRules = {
      'Warm & Encouraging': `
        TYPOGRAPHY: Use Google Fonts "Nunito" (rounded, friendly) for headings and "Lato" for body. H1: oversized (2.5em+), bold, warm-toned. H2: 1.4em, semi-bold. Body text: 1em, generous line-height 1.7.
        SHAPES & CONTAINERS: Use soft rounded rectangles (border-radius: 20-30px) for content cards. Add organic wave SVG dividers between sections at the page margins. Use gentle pastel fills (peach, lavender, soft orange) for callout boxes (must be standard rectangles).
        INFOGRAPHICS: Break key points into "Encouragement Cards" (rounded rectangles) with a large emoji/icon and short motivational statement. Use side-by-side two-column layouts for tips. Add "Remember This!" callout boxes (standard rounded rectangles only, no speech-bubble clip-paths).
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
        SHAPES & CONTAINERS: Use standard rectangle cards with border-radius and heavy solid drop-shadows (box-shadow: 8px 8px 0px #000) for holding text. Do NOT use asymmetrical clip-paths for text cards. Add squiggly or wavy borders using SVG and triangular accent shapes only at the page margins. Mix background colours per section (never plain white).
        INFOGRAPHICS: Use large "Stat Badges" (circles or squares). Add "Did You Know?" callout boxes (rectangles/squares). Use icon-heavy bullet points. Add confetti or star decorative elements only at the margins.
        COLOR PALETTE: Hot pink (#ec4899), electric yellow (#facc15), deep purple (#7c3aed), bright teal (#06b6d4) on a near-white or light grey base.
      `,
      'Reflective & Thoughtful': `
        TYPOGRAPHY: Use Google Fonts "Playfair Display" (elegant serif) for H1 headings and "Source Serif 4" or "Georgia" for body. H1: 2.2em, italic, generous margins. H2: 1.2em, small-caps. Body: 1em, wide line-height 1.8, ample paragraph spacing.
        SHAPES & CONTAINERS: Minimalist fine-line borders (1px solid #d1d5db) on rectangular cards. Extra-wide padding (30-40px) inside content blocks. Ample negative/blank space between sections. No heavy backgrounds — white or very light grey only.
        INFOGRAPHICS: Use pull-quote blocks (standard rectangles with a large left-border accent line + italic quote text). Add "Pause & Reflect" prompts in bordered aside boxes (standard rectangles). Use sparse, refined iconography. Avoid heavy infographic elements.
        COLOR PALETTE: Soft sage (#d1fae5), warm off-white (#fafaf9), medium grey (#6b7280), and one contemplative accent like forest green (#059669) or dusty blue (#7c9eb2).
      `,
      'Educational & Informative': `
        TYPOGRAPHY: Use Google Fonts "Roboto" for body text and "Roboto Slab" or "DM Sans" for headings. H1: bold 2em with a coloured underline. H2: 1.3em with a numbered prefix badge. Body: 0.95em, clear 1.6 line-height.
        SHAPES & CONTAINERS: Use flowchart-style standard rectangular containers for sequential content. Use standard grid blocks (rectangles/squares) with labelled headers for each content area. Use process arrows (→) between steps. Add "Key Term" definition boxes (rectangles/squares) with a left-coloured border.
        INFOGRAPHICS: Use side-by-side comparison tables. Add process flow diagrams (Step 1 → Step 2 → Step 3) using CSS flexbox boxes (rectangles) with connector arrows at the margins. Include "Key Concept" and "Example" callout boxes (rectangles) with distinct background colours.
        COLOR PALETTE: Academic blue (#2563eb), knowledge gold (#f59e0b), white (#ffffff), with light blue section backgrounds (#eff6ff).
      `,
      'Motivational & Inspiring': `
        TYPOGRAPHY: Use Google Fonts "Montserrat" (tall, bold) for H1 — extreme weight (900), all-caps, with a gradient or coloured fill. Use "Open Sans" for body. H1: 2.8em+, all-caps. H2: 1.4em, bold, coloured. Body: 1em, 1.6 line-height.
        SHAPES & CONTAINERS: Use forward-slashing diagonal lines (clip-path: polygon) and chevron/arrow accent shapes ONLY as decorative designs at the page margins. All content and text panels must be standard rectangles or squares. Backgrounds should have bold gradient fills per section.
        INFOGRAPHICS: Use large "Hero Numbers" (giant stat circles or squares + descriptor text). Add milestone banners ("Goal 1", "Goal 2") in a horizontal ribbon layout (rectangles). Use upward arrow motifs (▲) at the margins. Bold "Call to Action" boxes (rectangles) at the end of each page.
        COLOR PALETTE: Deep purple (#7c3aed), electric indigo (#4f46e5), vibrant gold (#fbbf24), and white on bold dark backgrounds.
      `
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
      "CRITICAL: You MUST combine multiple short slides/sections onto a single page plan to avoid large empty spaces. A single A4 page must be densely packed and can contain multiple sections. Do not artificially force 1 slide per page if they are short. You must preserve the text of all headers exactly as they appear in the source files. " +
      "CRITICAL IMAGES & CHARTS PLACEMENT: You are provided with a list of extracted images and charts. Your task is to place them contextually under the corresponding header section by adding an element of 'elementType': 'image'. Do NOT place the same image multiple times. If a slide or section has no relevant image in the list, do not add one. " +
      (bStrictFileContentOnly 
        ? "CRITICAL FACTS: Summarize ONLY information explicitly stated in the source text. Do NOT hallucinate background facts, introduce pre-trained knowledge, definitions, external history, or context not written in the files. If it is not in the text, it does not exist."
        : "You may supplement the notes with external definitions, examples, and background context if helpful for explaining the slide topics.");

    const blueprintPrompt = `Task: Design a page-by-page visual blueprint. Source: ${combinedSourceText.substring(0, 150000)}. Preferences: ${writingTheme}, ${detailLevel}. Metadata: ${metadataBlock}. ${extractionInstructions}. 
    Extracted Images available for placement: ${JSON.stringify(allExtractedImages)}.
    JSON Schema: [{"pageNumber", "pageType", "pageTitle", "sections": [{"elementId", "elementType", "title", "topicsToCover", "imageId", "resolvedClass", "caption", "wordBudget", "layoutStylingDetails"}]}]. ElementType can be 'text' or 'image'. For 'image' elements, you must populate 'imageId', 'resolvedClass', and 'caption' from the provided extracted images list.`;

    let blueprintText = await generateContentWithRotation(
      blueprintPrompt,
      blueprintSystemInstruction,
      { responseMimeType: "application/json" },
      STRUCTURED_CODING_MODEL_CHAIN
    );
    let blueprintJSON;
    try {
      blueprintJSON = cleanAndParseJson(blueprintText);
    } catch (parseError) {
      logEvent('error', `Failed to parse blueprint JSON. Raw text: "${blueprintText}"`, { error: parseError.message });
      throw new Error(`Failed to parse layout blueprint JSON: ${parseError.message}`);
    }

    // ── STAGE 2: HTML Generation Prompts (Parallel) ────────────────────────
    logEvent('info', `Executing Stage 2: Drafting HTML summary in parallel across ${blueprintJSON.length} pages...`);

    const htmlSystemInstruction = 
      "You are an expert content designer and summary publisher. " +
      "Create a standalone HTML snippet containing a single page of notes strictly following the provided page blueprint. " +
      "The page MUST be wrapped in a single <div class=\"page\">...</div> container. Use A4 dimensions. NO overflow/scrollbars. NO hover/:hover. Return ONLY raw HTML. " +
      "CRITICAL TYPOGRAPHY & HIERARCHY: If you import Google Fonts, use <link rel=\"stylesheet\" href=\"...\"> at the top of your snippet. Proactively apply the theme's fancy/decorative Google Fonts to all main titles, sub-titles, section titles, headers, and sub-headers (H1, H2, H3, H4, etc.) to make them look visually striking, premium, and themed. Keep body text highly readable (e.g. using Lato, Inter, or Open Sans). Do NOT use generic system fonts for headings. " +
      "Ensure you strictly enforce the following class-based font size hierarchy in your CSS and HTML: " +
      "1. Main Title (.title): 40px, extra-bold (use for document title/cover page). " +
      "2. Subtitles (.subtitle): 32px, semi-bold. " +
      "3. Section Titles (.section-title): 28px, bold. " +
      "4. Headers (h1, .header): 24px, bold (use for page/slide headings). " +
      "5. Sub-headers (h2, .sub-header): 20px, semi-bold. " +
      "6. Table Header Row / Card Headers (h3, th, .box-header, .card-title): 16px, bold. " +
      "7. Body / Rows (td, p, li, .body-text): 14px, regular. " +
      "8. Page Numbers (.page-number): 11px, medium (placed at the bottom right of the page: <div class=\"page-number\">Page {{PAGE_NUM}} of {{TOTAL_PAGES}}</div>). " +
      "CRITICAL VISUAL DESIGN: You must apply the Vibe Theme Design Rules to generate a premium visual document. Proactively implement styled shapes, card blocks (.card), callout boxes (.callout-box), statistical highlights (.stat-card), note containers (.notes-card), process indicators (.step-card), shaded tables with alternating row colors, pull-quotes, timelines, and decorative visual separators. Avoid plain unstyled text. " +
      "TEXT CONTAINER SHAPES: For holding text, you must ONLY use standard geometric shapes: squares, rectangles (including rounded corners / border-radius), and circles. Do NOT use clip-paths, polygons, squiggles, triangles, starbursts, or speech bubbles to hold text, as this clips or overflows content. All stylized borders, decorative accents, clip-path backgrounds, and decorative shapes must be placed at the page margins (outer edges) and must not overlap text areas. " +
      "PAGE DENSITY & GAPS: Avoid leaving large empty spaces at the bottom of pages. Pack elements efficiently. " +
      "IMAGE RENDER CONSTRAINTS: If a section in the blueprint has \"elementType\": \"image\", you MUST render a clean <img> tag using the provided imageId in its src and the resolvedClass as its class: <img class=\"[resolvedClass]\" src=\"/extracted_media/[imageId]\" alt=\"[caption]\" />. If there is a caption, place it neatly below the image in a small div: <div class=\"image-caption\">[caption]</div>. Text wrapping must only wrap around the image itself, not the caption. " +
      "CRITICAL: You must strictly preserve all slide titles, slide headers, subheaders, and section headings exactly as they appear in the blueprint. Do NOT invent new headers or rename sections. " +
      (bStrictFileContentOnly
        ? "CRITICAL FACTS: Summarize ONLY information explicitly stated in the source text. Do NOT hallucinate background facts, introduce pre-trained knowledge, definitions, or context not written in the files."
        : "You may supplement the notes with external definitions, examples, and background context if helpful for explaining the slide topics.");

    // Render pages in batches to respect Free Tier API concurrency limits and prevent rate limit errors
    const pageHtmls = [];
    const concurrencyLimit = 3;
    logEvent('info', `Rendering ${blueprintJSON.length} pages in batches of ${concurrencyLimit}...`);
    
    for (let i = 0; i < blueprintJSON.length; i += concurrencyLimit) {
      const batch = blueprintJSON.slice(i, i + concurrencyLimit);
      const batchIndex = Math.floor(i / concurrencyLimit) + 1;
      const totalBatches = Math.ceil(blueprintJSON.length / concurrencyLimit);
      logEvent('info', `Processing Stage 2 batch ${batchIndex}/${totalBatches} (${batch.length} pages)...`);
      
      const batchPromises = batch.map(async (pagePlan) => {
        const pagePrompt = `Task: Generate a single standalone A4 HTML page (wrapped in <div class="page">...</div>) for the following page plan from the blueprint:
        
        Page Plan: ${JSON.stringify(pagePlan)}
        
        Theme styling rules: ${vibeInstruction}
        Color palette rules: ${colorInstruction}
        
        Specific Page Requirements:
        - Enforce A4 dimensions with narrow margins (exactly 12mm padding).
        - Use fancy Google Fonts on headings.
        - Enforce the strict class-based font size hierarchy.
        - Place the exact page number placeholder: <div class="page-number">Page {{PAGE_NUM}} of {{TOTAL_PAGES}}</div> in the bottom right corner.
        - Ensure print-safe styles, no hover, no overflow.
        - Return ONLY the raw HTML code for this single page. Do NOT add markdown code fences (like \`\`\`html) and do NOT add any introductory or concluding conversational text.`;

        return generateContentWithRotation(
          pagePrompt,
          htmlSystemInstruction,
          {},
          CREATIVE_LAYOUT_MODEL_CHAIN
        );
      });
      
      const batchResults = await Promise.all(batchPromises);
      pageHtmls.push(...batchResults);
    }
    logEvent('info', `Successfully drafted all ${pageHtmls.length} HTML pages.`);

    // Compile pages and inject dynamic page numbers
    const compiledHtmlDraft = pageHtmls.map((pageHtml, index) => {
      const cleanHtml = cleanHtmlResponse(pageHtml);
      return cleanHtml
        .replace(/{{PAGE_NUM}}/g, index + 1)
        .replace(/{{TOTAL_PAGES}}/g, pageHtmls.length);
    }).join('\n');

    // ── STAGE 3: HTML Validation Prompts ───────────────────────────────────
    logEvent('info', 'Executing Stage 3: Running HTML validation on compiled document...');
    const validatorSystemInstruction = "Fix all overflow, print-safety (no hover/transitions), and CSS containment violations. Return ONLY corrected HTML.";
    const validatorPrompt = `
Task: Inspect the generated HTML/CSS code below for any formatting, overflow, page-bleeding, or print-safety violations, and output a corrected, fully safe version.

--- HTML/CSS Code to Inspect ---
${compiledHtmlDraft}
--------------------------------

Checklist of violations you MUST correct if present:
1. FIXED HEIGHTS: Any container inside a page (like .card, .callout, .badge, .container, .sidebar, div) that has a fixed "height: Xpx" or "height: Xrem". You MUST convert it to "min-height: Xpx; height: auto" so the shape expands with text.
2. TEXT OVERFLOW: Any heading, paragraph, list item, span, pre, code, or table that does not have "word-break: break-word; overflow-wrap: break-word;". Ensure these are added to prevent text bleeding out of the A4 page.
3. HOVER / TRANSITIONS: If you see any ":hover" pseudo-class, transition property, animation, cursor: pointer, transform-on-hover, or absolute fixed/sticky positions, you MUST remove them.
4. ABSOLUTE POSITIONING OVERLAPS: If "position: absolute" is used, ensure it is only for decorative accents or page numbers. If text containers are positioned absolutely, convert them to flex/grid document flow so they do not overlap.
5. CONTAINER PADDING: Ensure shape containers with borders or background fills have at least 12px of padding so text never touches the container borders.
6. A4 PAGE OVERFLOW: If a page container has a style that makes it grow beyond 297mm (such as height: auto or overflow: visible), ensure the page container has a strict A4 styling with overflow: hidden.
7. PAGE CONTAINERS & TEXT SHAPES: Ensure the output preserves multiple separate <div class="page">...</div> containers (one for each page), using narrow margins (padding exactly 12mm). Ensure all text-holding containers are standard squares, rectangles, or circles. Ensure any stylized/decorative borders or accents are placed at the outer page margins and do not overlap text. Do NOT strip out visual shapes, colors, or card structures.
8. FONT SIZE HIERARCHY & PAGE NUMBERS: Verify the font size hierarchy is strictly respected: Title (40px), Subtitle (32px), Section Title (28px), Header (24px), Sub-header (20px), Table Header / Box Header (16px), Body / Rows (14px), and Page Numbers (11px). Check that each .page element has a bottom-aligned <div class="page-number">Page X of Y</div> element (with the correct resolved page numbers). Avoid unnecessary page inflation and pack elements densely.
9. GOOGLE FONTS & THEME: You MUST preserve all <link rel="stylesheet"> tags for Google Fonts and all font-family CSS rules. Do NOT strip them.

Return ONLY the final corrected HTML/CSS code. Do NOT wrap in markdown code fences and do NOT add any conversational text.
`;
    let htmlValidated = await generateContentWithRotation(
      validatorPrompt,
      validatorSystemInstruction,
      {},
      STRUCTURED_CODING_MODEL_CHAIN
    );

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

    const rawAiResponse = await generateContentWithRotation(
      prompt,
      systemInstruction,
      {},
      STRUCTURED_CODING_MODEL_CHAIN
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
      STRUCTURED_CODING_MODEL_CHAIN
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

app.listen(PORT, () => {
  logEvent('info', `Backend server running on http://localhost:${PORT}`);
  // Perform an initial key quota check at startup in the background
  checkAllKeysQuotas().catch(err => {
    logEvent('error', `Failed initial startup key quota check: ${err.message}`);
  });
});
