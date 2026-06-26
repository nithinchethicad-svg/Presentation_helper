import { useState, useEffect, useRef } from 'react';

const BACKEND_URL = `http://${window.location.hostname}:5000`;

const DevToolsScreen = ({ onBack }) => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isAuthorized, setIsAuthorized] = useState(true);
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Telemetry & Data States
  const [systemStatus, setSystemStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [keys, setKeys] = useState([]);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isHealthChecking, setIsHealthChecking] = useState(false);
  
  // Cost & Usage States
  const [usageSummary, setUsageSummary] = useState(null);
  const [usageSessions, setUsageSessions] = useState([]);
  const [currency, setCurrency] = useState('USD');
  const [costViewMode, setCostViewMode] = useState('overview'); // 'overview' | 'details'
  const [isResettingUsage, setIsResettingUsage] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState(null);
  const [isLoadingUsage, setIsLoadingUsage] = useState(false);

  // Filter States
  const [logsViewMode, setLogsViewMode] = useState('timeline'); // 'timeline' | 'sessions'
  const [expandedLogIndex, setExpandedLogIndex] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('all');
  const [logsCategory, setLogsCategory] = useState('all'); // 'all' | 'user' | 'system'
  const [costCategory, setCostCategory] = useState('all'); // 'all' | 'user' | 'system'

  // SSE Live Streaming
  const [sseConnected, setSseConnected] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const eventSourceRef = useRef(null);

  // Exempt DevToolsScreen from global overflow: hidden and fixed height restrictions
  // Also inject SSE pulse keyframe animation for the live dots on tab buttons and custom scrollbars
  useEffect(() => {
    const origHtmlOverflow = document.documentElement.style.overflow;
    const origHtmlHeight = document.documentElement.style.height;
    const origBodyOverflow = document.body.style.overflow;
    const origBodyHeight = document.body.style.height;
    
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    
    const appContainers = document.getElementsByClassName('app-container');
    const origContainerStyles = [];
    for (let i = 0; i < appContainers.length; i++) {
      const container = appContainers[i];
      origContainerStyles.push({
        element: container,
        height: container.style.height,
        overflow: container.style.overflow,
        maxHeight: container.style.maxHeight,
        display: container.style.display,
        padding: container.style.padding,
        width: container.style.width,
        maxWidth: container.style.maxWidth,
        margin: container.style.margin
      });
      container.style.height = 'auto';
      container.style.overflow = 'visible';
      container.style.maxHeight = 'none';
      container.style.display = 'block';
      container.style.padding = '0';
      container.style.width = '100%';
      container.style.maxWidth = 'none';
      container.style.margin = '0';
    }

    // Inject ssePulse keyframe for the live indicator dots and custom scrollbars
    const styleTag = document.createElement('style');
    styleTag.id = 'devtools-sse-styles';
    styleTag.textContent = `
      @keyframes ssePulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(0.7); }
      }
      /* Custom light scrollbar for DevTools */
      .devtools-light ::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }
      .devtools-light ::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 4px;
      }
      .devtools-light ::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }
      .devtools-light ::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }
    `;
    document.head.appendChild(styleTag);

    return () => {
      document.documentElement.style.overflow = origHtmlOverflow;
      document.documentElement.style.height = origHtmlHeight;
      document.body.style.overflow = origBodyOverflow;
      document.body.style.height = origBodyHeight;
      
      origContainerStyles.forEach(style => {
        style.element.style.height = style.height;
        style.element.style.overflow = style.overflow;
        style.element.style.maxHeight = style.maxHeight;
        style.element.style.display = style.display;
        style.element.style.padding = style.padding;
        style.element.style.width = style.width;
        style.element.style.maxWidth = style.maxWidth;
        style.element.style.margin = style.margin;
      });

      document.getElementById('devtools-sse-styles')?.remove();
    };
  }, []);

  // Template Explorer Preview States
  const [presets, setPresets] = useState([]);
  const [themes, setThemes] = useState([]);
  const [palettes, setPalettes] = useState([]);
  const [selectedPreset, setSelectedPreset] = useState('TwoColumnSplit');
  const [selectedTheme, setSelectedTheme] = useState('formal_professional');
  const [selectedPalette, setSelectedPalette] = useState('corporate_navy');
  const [activePreviewPreset, setActivePreviewPreset] = useState(null);

  // Context Cache States
  const [caches, setCaches] = useState([]);
  const [isLoadingCaches, setIsLoadingCaches] = useState(false);
  const [isDeletingCache, setIsDeletingCache] = useState(null);

  // Playground States
  const [playPrompt, setPlayPrompt] = useState('');
  const [playSystem, setPlaySystem] = useState('');
  const [playModel, setPlayModel] = useState('gemini-3.5-flash');
  const [playTemp, setPlayTemp] = useState(0.7);
  const [playResult, setPlayResult] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // A/B Test States
  const [abPrompt, setAbPrompt] = useState('');
  const [abSystemA, setAbSystemA] = useState('');
  const [abSystemB, setAbSystemB] = useState('');
  const [abModelA, setAbModelA] = useState('gemini-3.5-flash');
  const [abModelB, setAbModelB] = useState('gemini-3.1-pro-preview');
  const [abResult, setAbResult] = useState(null);
  const [isTestingAB, setIsTestingAB] = useState(false);

  // Help Modal & Copy Prompt States
  const [helpTabId, setHelpTabId] = useState(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  // Load saved token and verify auth on mount
  useEffect(() => {
    const savedToken = sessionStorage.getItem('devtools_token');
    if (savedToken) {
      setToken(savedToken);
      fetchData(savedToken);
    } else {
      // Test if auth is bypassed (Local Dev)
      fetchData('');
    }
  }, []);

  // Open SSE live stream once authorized
  useEffect(() => {
    if (!isAuthorized) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        setSseConnected(false);
      }
      return;
    }

    // EventSource cannot send Authorization headers — pass token as query param
    const streamUrl = token
      ? `${BACKEND_URL}/api/devtools/stream?token=${encodeURIComponent(token)}`
      : `${BACKEND_URL}/api/devtools/stream`;

    const es = new EventSource(streamUrl);
    eventSourceRef.current = es;

    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false);

    // Live log entries — prepend to logs array
    es.addEventListener('log', (e) => {
      const entry = JSON.parse(e.data);
      setLogs(prev => [entry, ...prev].slice(0, 500));
    });

    // Live usage — upsert session record, update daily cost bars
    es.addEventListener('usage', (e) => {
      const { session, dailyCosts } = JSON.parse(e.data);
      setUsageSessions(prev => {
        const idx = prev.findIndex(s => s.sessionId === session.sessionId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = session;
          return next;
        }
        return [session, ...prev];
      });
      if (dailyCosts) {
        setUsageSummary(prev => prev ? { ...prev, dailyCosts } : prev);
      }
    });

    // Live key status updates — key recoveries, health checks, toggles
    es.addEventListener('key', (e) => {
      const updatedKeys = JSON.parse(e.data);
      setKeys(updatedKeys);
    });

    // Live cache events — new cache created or deleted
    es.addEventListener('cache', (e) => {
      const { action, name } = JSON.parse(e.data);
      if (action === 'deleted') {
        setCaches(prev => prev.filter(c => c.name !== name));
      } else if (action === 'created') {
        // Re-fetch full list to get accurate token counts and metadata
        fetchCaches();
      }
    });

    // Heartbeat — drives Dashboard uptime + active key counters live
    es.addEventListener('heartbeat', (e) => {
      const data = JSON.parse(e.data);
      setSseConnected(true);
      setSystemStatus(prev => prev ? {
        ...prev,
        uptime: data.uptime,
        activeKeysCount: data.activeKeysCount,
        totalKeysCount: data.totalKeysCount,
        system: prev.system ? { ...prev.system, freeMem: data.freeMem, loadAvg: data.loadAvg } : prev.system
      } : prev);
    });

    return () => {
      es.close();
      setSseConnected(false);
      eventSourceRef.current = null;
    };
  }, [isAuthorized, token]);

  const fetchData = async (authToken) => {
    setIsLoadingStatus(true);
    try {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/status`, { headers });
      
      if (res.status === 401 || res.status === 403) {
        setIsAuthorized(false);
        sessionStorage.removeItem('devtools_token');
        setToken('');
        return;
      }

      if (res.ok) {
        const data = await res.json();
        setSystemStatus(data);
        setIsAuthorized(true);
        
        // Fetch keys, logs, and cost telemetry
        fetchKeys(authToken);
        fetchLogs(authToken);
        fetchTemplates();
        fetchUsageSummary(authToken);
        fetchUsageSessions(authToken);
      }
    } catch (err) {
      console.error("Failed to fetch DevTools status:", err);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  const fetchKeys = async (authToken = token) => {
    setIsLoadingKeys(true);
    try {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/keys/status`, { headers });
      if (res.ok) {
        const data = await res.json();
        setKeys(data);
      }
    } catch (err) {
      console.error("Failed to fetch keys:", err);
    } finally {
      setIsLoadingKeys(false);
    }
  };

  const fetchLogs = async (authToken = token) => {
    setIsLoadingLogs(true);
    try {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/logs`, { headers });
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setIsLoadingLogs(false);
    }
  };

  const fetchUsageSummary = async (authToken = token) => {
    setIsLoadingUsage(true);
    try {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/usage/summary`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUsageSummary(data);
      }
    } catch (err) {
      console.error("Failed to fetch usage summary:", err);
    } finally {
      setIsLoadingUsage(false);
    }
  };

  const fetchUsageSessions = async (authToken = token) => {
    try {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/usage/sessions`, { headers });
      if (res.ok) {
        const data = await res.json();
        setUsageSessions(data);
      }
    } catch (err) {
      console.error("Failed to fetch usage sessions:", err);
    }
  };

  const handleResetUsage = async () => {
    if (!window.confirm("Are you sure you want to permanently clear all cost records, token telemetry, and monthly aggregates? This action cannot be undone.")) {
      return;
    }
    setIsResettingUsage(true);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const res = await fetch(`${BACKEND_URL}/api/devtools/usage/reset`, { 
        method: 'POST', 
        headers 
      });
      if (res.ok) {
        setUsageSessions([]);
        setUsageSummary(prev => prev ? {
          ...prev,
          monthlyAggregates: {},
          dailyCosts: prev.dailyCosts.map(d => ({ ...d, cost: 0 }))
        } : null);
        alert("Usage databases successfully reset.");
      }
    } catch (err) {
      console.error("Failed to reset usage:", err);
      alert("Failed to reset usage database.");
    } finally {
      setIsResettingUsage(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/templates/presets`);
      if (res.ok) {
        const data = await res.json();
        setPresets(data.presets || []);
        setThemes(data.themes || []);
        setPalettes(data.palettes || []);
      }
    } catch (err) {
      console.error("Failed to fetch templates:", err);
    }
  };

  // Live cache and tool runner endpoints
  const fetchCaches = async (authToken = token) => {
    setIsLoadingCaches(true);
    try {
      const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/caches`, { headers });
      if (res.ok) {
        const data = await res.json();
        setCaches(data.caches || []);
      }
    } catch (err) {
      console.error("Failed to fetch caches:", err);
    } finally {
      setIsLoadingCaches(false);
    }
  };

  const handleDeleteCache = async (cacheName) => {
    const shortName = cacheName.replace('cachedContents/', '');
    if (!window.confirm(`Are you sure you want to permanently delete context cache "${shortName}"? This will free up storage but subsequent requests will suffer initial cold-start latency.`)) {
      return;
    }
    setIsDeletingCache(cacheName);
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/caches/${shortName}`, {
        method: 'DELETE',
        headers
      });
      if (res.ok) {
        alert("Cache successfully deleted.");
        fetchCaches();
      } else {
        const errData = await res.json();
        alert(`Failed to delete cache: ${errData.message || res.statusText}`);
      }
    } catch (err) {
      console.error("Failed to delete cache:", err);
      alert("Failed to delete cache due to a network or server error.");
    } finally {
      setIsDeletingCache(null);
    }
  };

  const handleRunPlayground = async () => {
    if (!playPrompt.trim()) {
      alert("Please enter a prompt.");
      return;
    }
    setIsPlaying(true);
    setPlayResult(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const res = await fetch(`${BACKEND_URL}/api/devtools/playground/run`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: playPrompt,
          systemInstruction: playSystem,
          modelName: playModel,
          temperature: playTemp
        })
      });
      const data = await res.json();
      if (res.ok) {
        setPlayResult(data);
      } else {
        alert(`Playground run failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("Playground run error:", err);
      alert("Failed to execute prompt in playground.");
    } finally {
      setIsPlaying(false);
    }
  };

  const handleRunABTest = async () => {
    if (!abPrompt.trim()) {
      alert("Please enter a prompt/takeaway text.");
      return;
    }
    setIsTestingAB(true);
    setAbResult(null);
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const res = await fetch(`${BACKEND_URL}/api/devtools/ab-test`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: abPrompt,
          systemInstructionA: abSystemA,
          systemInstructionB: abSystemB,
          modelA: abModelA,
          modelB: abModelB
        })
      });
      const data = await res.json();
      if (res.ok) {
        setAbResult(data);
      } else {
        alert(`A/B Test execution failed: ${data.message || 'Unknown error'}`);
      }
    } catch (err) {
      console.error("A/B Test run error:", err);
      alert("Failed to execute A/B compilation test.");
    } finally {
      setIsTestingAB(false);
    }
  };

  const handleCopyPrompt = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  // Sync caches when caches tab becomes active
  useEffect(() => {
    if (activeTab === 'caches' && isAuthorized) {
      fetchCaches();
    }
  }, [activeTab, isAuthorized]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${BACKEND_URL}/api/devtools/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      
      if (res.ok) {
        sessionStorage.setItem('devtools_token', data.token);
        setToken(data.token);
        setIsAuthorized(true);
        fetchData(data.token);
      } else {
        setLoginError(data.message || 'Invalid administrative password.');
      }
    } catch (err) {
      setLoginError('Failed to connect to backend server.');
    }
  };

  const handleToggleKey = async (id, currentEnabled, modelName = undefined) => {
    try {
      const headers = { 
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      };
      const res = await fetch(`${BACKEND_URL}/api/devtools/keys/toggle`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ 
          id, 
          modelName,
          enabled: !currentEnabled 
        })
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys);
      }
    } catch (err) {
      console.error("Failed to toggle key:", err);
    }
  };

  const handleRunHealthCheck = async () => {
    setIsHealthChecking(true);
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/keys/health-check`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        const data = await res.json();
        setKeys(data.keys);
      }
    } catch (err) {
      console.error("Health check failed:", err);
    } finally {
      setIsHealthChecking(false);
    }
  };

  const handleClearLogs = async () => {
    if (!window.confirm("Are you sure you want to clear all logs? This will erase the in-memory history.")) return;
    try {
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      const res = await fetch(`${BACKEND_URL}/api/devtools/logs/clear`, {
        method: 'POST',
        headers
      });
      if (res.ok) {
        setLogs([]);
        setExpandedLogIndex(null);
      }
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  // Group Logs by Session ID Helper
  const getSessionGroups = () => {
    const groups = {};
    logs.forEach(log => {
      const sess = log.sessionId || 'system';
      if (!groups[sess]) {
        groups[sess] = {
          sessionId: sess,
          logsCount: 0,
          errorCount: 0,
          firstSeen: log.timestamp,
          lastSeen: log.timestamp,
          recentMessage: log.message
        };
      }
      groups[sess].logsCount++;
      if (log.level === 'error') {
        groups[sess].errorCount++;
      }
      if (new Date(log.timestamp) < new Date(groups[sess].firstSeen)) {
        groups[sess].firstSeen = log.timestamp;
      }
      if (new Date(log.timestamp) > new Date(groups[sess].lastSeen)) {
        groups[sess].lastSeen = log.timestamp;
      }
    });
    return Object.values(groups).sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
  };

  // Filtering Logs
  const filteredLogs = logs.filter(log => {
    const matchesSearch = 
      log.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.sessionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.level.toLowerCase().includes(searchQuery.toLowerCase());
      
    const matchesSession = selectedSessionId === 'all' || log.sessionId === selectedSessionId;
    
    let matchesCategory = true;
    if (logsCategory === 'user') {
      matchesCategory = log.initiator === 'user';
    } else if (logsCategory === 'system') {
      matchesCategory = log.initiator === 'system' || !log.initiator;
    }
    
    return matchesSearch && matchesSession && matchesCategory;
  });

  const activeKeysCount = keys.filter(k => k.enabled).length;
  
  const allModels = Array.from(new Set(keys.flatMap(k => k.modelEnabled ? Object.keys(k.modelEnabled) : [])));

  const getModelAggregateStatus = (modelName, keysList) => {
    const activeKeys = keysList.filter(k => k.enabled);
    if (activeKeys.length === 0) return 'unavailable';
    
    let hasActive = false;
    let hasQuotaDepleted = false;
    let hasManualOff = false;
    
    activeKeys.forEach(k => {
      const state = k.modelEnabled?.[modelName];
      if (state === 'active') {
        hasActive = true;
      } else if (state === 'quota_depleted') {
        hasQuotaDepleted = true;
      } else if (state === 'manual_off') {
        hasManualOff = true;
      }
    });
    
    if (hasActive) return 'active';
    if (hasQuotaDepleted) return 'quota_depleted';
    if (hasManualOff) return 'manual_off';
    return 'unavailable';
  };

  if (!isAuthorized) {
    return (
      <div className="devtools-light auth-layout" style={{
        '--dt-bg': '#f8fafc',
        '--dt-card-bg': '#ffffff',
        '--dt-border': '#e2e8f0',
        '--dt-btn-bg': '#f1f5f9',
        '--dt-text-muted': '#475569',
        '--dt-text': '#0f172a',
        '--dt-accent-blue': '#2563eb',
        backgroundColor: 'var(--dt-bg)',
        color: 'var(--dt-text)',
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', sans-serif"
      }}>
        <div style={{
          width: '100%',
          maxWidth: '420px',
          padding: '2.5rem',
          backgroundColor: 'var(--dt-card-bg)',
          borderRadius: '16px',
          border: '1px solid var(--dt-border)',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <img 
                src="/ai_slidekick_logo.png?v=3" 
                alt="AI Slidekick Logo" 
                style={{ height: '40px', width: 'auto', objectFit: 'contain' }} 
              />
              <span style={{
                background: '#6366f1',
                color: 'white',
                fontSize: '11px',
                fontWeight: 800,
                padding: '3px 8px',
                borderRadius: '12px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>DevTools Portal</span>
            </div>
            <p style={{ color: 'var(--dt-text-muted)', fontSize: '13px', marginTop: '4px' }}>
              Authentication required for this Google Cloud Run deployment.
            </p>
          </div>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--dt-text-muted)', marginBottom: '6px', textTransform: 'uppercase' }}>
                Admin Password
              </label>
              <input 
                type="password" 
                placeholder="Enter password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  backgroundColor: 'var(--dt-bg)',
                  border: '1px solid var(--dt-border)',
                  borderRadius: '8px',
                  color: 'var(--dt-text)',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
            {loginError && (
              <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '1rem', fontWeight: 500 }}>
                ⚠️ {loginError}
              </div>
            )}
            <button 
              type="submit" 
              style={{
                width: '100%',
                padding: '11px',
                backgroundColor: 'var(--dt-accent-blue)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                fontSize: '14px',
                cursor: 'pointer',
                transition: 'background 0.2s'
              }}
            >
              Sign In
            </button>
          </form>
          <div style={{ textAlign: 'center', marginTop: '1.5rem' }}>
            <button 
              onClick={onBack}
              style={{ background: 'none', border: 'none', color: 'var(--dt-text-muted)', cursor: 'pointer', fontSize: '13px', textDecoration: 'underline' }}
            >
              ← Back to Assistant
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', live: true },
    { id: 'logs', icon: '📜', label: 'API Logs', live: true },
    { id: 'keys', icon: '🔑', label: 'Key Management', live: true },
    { id: 'cost', icon: '💵', label: 'Cost & Usage', live: true },
    { id: 'template', icon: '🎨', label: 'Template Explorer', live: false },
    { id: 'caches', icon: '💾', label: 'Context Caches', live: true },
    { id: 'playground', icon: '🛝', label: 'Playground', live: false },
    { id: 'abtest', icon: '⚖️', label: 'A/B Tester', live: false },
    { id: 'analytics', icon: '📈', label: 'Analytics', live: false }
  ];

  return (
    <div className="devtools-light" style={{
      '--dt-bg': '#f8fafc',
      '--dt-card-bg': '#ffffff',
      '--dt-border': '#e2e8f0',
      '--dt-btn-bg': '#f1f5f9',
      '--dt-text-muted': '#475569',
      '--dt-text': '#0f172a',
      '--dt-accent-blue': '#2563eb',
      backgroundColor: 'var(--dt-bg)',
      color: 'var(--dt-text)',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'row',
      fontFamily: "'Inter', sans-serif"
    }}>
      {/* Sidebar Navigation */}
      <aside 
        onMouseEnter={() => setIsSidebarExpanded(true)}
        onMouseLeave={() => setIsSidebarExpanded(false)}
        style={{
          width: isSidebarExpanded ? '240px' : '68px',
          backgroundColor: 'var(--dt-card-bg)',
          borderRight: '1px solid var(--dt-border)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
          overflow: 'hidden',
          height: '100vh',
          position: 'sticky',
          top: 0,
          zIndex: 100
        }}
      >
        {/* Sidebar Header: Clean Menu Title / Symbol */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
          borderBottom: '1px solid var(--dt-border)',
          minHeight: '65px',
          boxSizing: 'border-box'
        }}>
          {isSidebarExpanded ? (
            <span style={{
              fontWeight: 800,
              fontSize: '12px',
              color: '#6366f1',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              🔧 Navigation Menu
            </span>
          ) : (
            <span style={{ fontSize: '18px' }}>🔧</span>
          )}
        </div>

        {/* Navigation Items */}
        <nav style={{ flex: 1, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: '4px', overflowY: 'auto' }}>
          {tabs.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={!isSidebarExpanded ? `${tab.label} ${tab.live && sseConnected ? '(Live)' : ''}` : undefined}
                style={{
                  backgroundColor: isActive ? 'var(--dt-btn-bg)' : 'transparent',
                  color: isActive ? 'var(--dt-accent-blue)' : 'var(--dt-text-muted)',
                  border: 'none',
                  padding: isSidebarExpanded ? '10px 12px' : '12px 0',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isSidebarExpanded ? 'flex-start' : 'center',
                  gap: isSidebarExpanded ? '10px' : '0',
                  width: '100%',
                  position: 'relative',
                  boxSizing: 'border-box'
                }}
                onMouseEnter={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'rgba(241, 245, 249, 0.5)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <span style={{ fontSize: '16px', display: 'flex', alignItems: 'center' }}>{tab.icon}</span>
                
                {isSidebarExpanded && (
                  <span style={{ flex: 1, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {tab.label}
                  </span>
                )}
                
                {/* Live indicator dot */}
                {tab.live && sseConnected && (
                  <span
                    title="Live — data streams in real-time via SSE"
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      backgroundColor: '#10b981',
                      position: isSidebarExpanded ? 'static' : 'absolute',
                      right: isSidebarExpanded ? 'auto' : '10px',
                      top: isSidebarExpanded ? 'auto' : '10px',
                      display: 'inline-block',
                      animation: 'ssePulse 2s ease-in-out infinite'
                    }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Back to Assistant and Env Info */}
        <div style={{
          padding: '16px',
          borderTop: '1px solid var(--dt-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxSizing: 'border-box',
          minHeight: '90px'
        }}>
          <button 
            onClick={onBack}
            title={!isSidebarExpanded ? 'Back to Assistant' : undefined}
            style={{
              backgroundColor: 'var(--dt-btn-bg)',
              color: 'var(--dt-text)',
              border: '1px solid var(--dt-border)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              width: '100%',
              boxSizing: 'border-box'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e2e8f0'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--dt-btn-bg)'}
          >
            <span>←</span>
            {isSidebarExpanded && <span>Back to Assistant</span>}
          </button>
          
          {isSidebarExpanded && (
            <p style={{ fontSize: '10px', color: 'var(--dt-text-muted)', margin: 0, textAlign: 'center', fontWeight: 500 }}>
              Running in {systemStatus?.nodeEnv || 'development'} mode
            </p>
          )}
        </div>
      </aside>

      {/* Main Content Workspace Area */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflowY: 'auto'
      }}>
        {/* Workspace Top-Bar */}
        <header style={{
          backgroundColor: 'var(--dt-card-bg)',
          borderBottom: '1px solid var(--dt-border)',
          padding: '16px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          zIndex: 99,
          minHeight: '65px',
          boxSizing: 'border-box'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Logo prominently displayed on all screens */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <img 
                src="/ai_slidekick_logo.png?v=3" 
                alt="AI Slidekick" 
                style={{ height: '32px', width: 'auto', objectFit: 'contain' }} 
              />
              <span style={{
                background: '#6366f1',
                color: 'white',
                fontWeight: 800,
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em'
              }}>DevTools</span>
            </div>
            
            <div style={{ borderLeft: '1px solid var(--dt-border)', paddingLeft: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px' }}>{tabs.find(t => t.id === activeTab)?.icon}</span>
              <h1 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--dt-text)' }}>
                {tabs.find(t => t.id === activeTab)?.label}
              </h1>
            </div>
          </div>
          
          {/* Live SSE Status Badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{
              backgroundColor: sseConnected ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
              color: sseConnected ? '#10b981' : '#ef4444',
              fontSize: '11px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              border: sseConnected ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)'
            }}>
              <span style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: sseConnected ? '#10b981' : '#ef4444',
                display: 'inline-block',
                animation: sseConnected ? 'ssePulse 2s ease-in-out infinite' : 'none'
              }} />
              {sseConnected ? 'Live Connection' : 'Disconnected'}
            </span>
          </div>
        </header>

        {/* DevTools Main Workspace */}
        <main style={{ flex: 1, padding: '24px', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        
        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Tab Header with Help */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--dt-card-bg)', padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--dt-border)', marginBottom: '8px' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>📊 Container Health & Diagnostics</h2>
                <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>Real-time status, container specs, and active key pool health</p>
              </div>
              <button 
                onClick={() => setHelpTabId('dashboard')}
                style={{ backgroundColor: 'var(--dt-btn-bg)', color: 'var(--dt-accent-blue)', border: '1px solid var(--dt-border)', padding: '8px 14px', borderRadius: '8px', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                ❓ Help Guide
              </button>
            </div>

            {/* KPI Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Server Status</span>
                <h3 style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 0 0', color: '#10b981' }}>ONLINE</h3>
              </div>
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Uptime</span>
                <h3 style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 0 0' }}>
                  {systemStatus ? `${Math.floor(systemStatus.uptime / 3600)}h ${Math.floor((systemStatus.uptime % 3600) / 60)}m` : '...'}
                </h3>
              </div>
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Active Keys</span>
                <h3 style={{ fontSize: '24px', fontWeight: 700, margin: '8px 0 0 0', color: 'var(--dt-accent-blue)' }}>
                  {activeKeysCount} / {keys.length} Toggled On
                </h3>
              </div>
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Current Model</span>
                <h3 style={{ fontSize: '16px', fontFamily: 'monospace', fontWeight: 700, margin: '14px 0 0 0', color: '#38bdf8' }}>
                  {systemStatus?.activeModel || '...'}
                </h3>
              </div>
            </div>

            {/* Diagnostics and Active Sessions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px' }}>
              {/* System Specs */}
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--dt-text)', marginBottom: '16px' }}>Container Diagnostics (Google Cloud Run)</h2>
                {systemStatus?.system ? (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                    <tbody>
                      <tr style={{ borderBottom: '1px solid var(--dt-btn-bg)' }}><td style={{ padding: '10px 0', color: 'var(--dt-text-muted)' }}>Platform</td><td style={{ padding: '10px 0', fontWeight: 'bold', textAlign: 'right' }}>{systemStatus.system.platform}</td></tr>
                      <tr style={{ borderBottom: '1px solid var(--dt-btn-bg)' }}><td style={{ padding: '10px 0', color: 'var(--dt-text-muted)' }}>CPU Cores</td><td style={{ padding: '10px 0', fontWeight: 'bold', textAlign: 'right' }}>{systemStatus.system.cpuCount} Cores</td></tr>
                      <tr style={{ borderBottom: '1px solid var(--dt-btn-bg)' }}><td style={{ padding: '10px 0', color: 'var(--dt-text-muted)' }}>Total Memory</td><td style={{ padding: '10px 0', fontWeight: 'bold', textAlign: 'right' }}>{systemStatus.system.totalMem} GB</td></tr>
                      <tr style={{ borderBottom: '1px solid var(--dt-btn-bg)' }}><td style={{ padding: '10px 0', color: 'var(--dt-text-muted)' }}>Free Memory</td><td style={{ padding: '10px 0', fontWeight: 'bold', textAlign: 'right' }}>{systemStatus.system.freeMem} GB</td></tr>
                      <tr><td style={{ padding: '10px 0', color: 'var(--dt-text-muted)' }}>Load Average</td><td style={{ padding: '10px 0', fontFamily: 'monospace', fontWeight: 'bold', textAlign: 'right' }}>{systemStatus.system.loadAvg.map(n => n.toFixed(2)).join(', ')}</td></tr>
                    </tbody>
                  </table>
                ) : (
                  <div style={{ color: 'var(--dt-text-muted)' }}>Loading system diagnostics...</div>
                )}
              </div>

              {/* Active Sessions Mini list */}
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column' }}>
                <h2 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--dt-text)', marginBottom: '16px' }}>Active User Sessions (72h Buffer)</h2>
                <div style={{ flex: 1, overflowY: 'auto', maxHeight: '220px' }}>
                  {getSessionGroups().length === 0 ? (
                    <div style={{ color: 'var(--dt-text-muted)', fontSize: '13px', fontStyle: 'italic', textAlign: 'center', padding: '20px 0' }}>
                      No active sessions in memory.
                    </div>
                  ) : (
                    getSessionGroups().slice(0, 5).map(g => (
                      <div key={g.sessionId} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--dt-btn-bg)' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#38bdf8' }}>{g.sessionId.substring(0, 15)}...</span>
                        <span style={{ fontSize: '12px', color: g.errorCount > 0 ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                          {g.logsCount} reqs {g.errorCount > 0 ? `| ${g.errorCount} errs` : ''}
                        </span>
                      </div>
                    ))
                  )}
                </div>
                <button 
                  onClick={() => { setActiveTab('logs'); setLogsViewMode('sessions'); }}
                  style={{ width: '100%', marginTop: '16px', padding: '8px', backgroundColor: 'var(--dt-btn-bg)', color: '#38bdf8', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                >
                  View All Session Groups
                </button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: API LOGS */}
        {activeTab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Logs Controls Bar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)',
              flexWrap: 'wrap',
              gap: '16px'
            }}>
              {/* View Selector */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    onClick={() => { setLogsViewMode('timeline'); setSelectedSessionId('all'); }}
                    style={{
                      backgroundColor: logsViewMode === 'timeline' ? 'var(--dt-accent-blue)' : 'var(--dt-btn-bg)',
                      color: 'white',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Timeline Feed
                  </button>
                  <button
                    onClick={() => setLogsViewMode('sessions')}
                    style={{
                      backgroundColor: logsViewMode === 'sessions' ? 'var(--dt-accent-blue)' : 'var(--dt-btn-bg)',
                      color: 'white',
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    Session Groups
                  </button>
                </div>

                {/* Category Selector */}
                <div style={{ display: 'flex', backgroundColor: 'var(--dt-bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--dt-border)', gap: '2px', marginLeft: '8px' }}>
                  {[
                    { id: 'all', label: '🌐 All' },
                    { id: 'user', label: '👤 User' },
                    { id: 'system', label: '🤖 System' }
                  ].map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setLogsCategory(cat.id)}
                      style={{
                        border: 'none',
                        backgroundColor: logsCategory === cat.id ? 'var(--dt-accent-blue)' : 'transparent',
                        color: logsCategory === cat.id ? 'white' : 'var(--dt-text-muted)',
                        padding: '5px 10px',
                        borderRadius: '6px',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Query */}
              <div style={{ display: 'flex', gap: '10px', flex: 1, maxWidth: '400px', minWidth: '200px' }}>
                <input
                  type="text"
                  placeholder="Search logs by message, session, or level..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    flex: 1,
                    backgroundColor: 'var(--dt-bg)',
                    border: '1px solid var(--dt-border)',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    color: 'var(--dt-text)',
                    fontSize: '13px',
                    outline: 'none'
                  }}
                />
                {selectedSessionId !== 'all' && (
                  <button 
                    onClick={() => setSelectedSessionId('all')}
                    style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', borderRadius: '6px', padding: '0 10px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {/* Refresh / Clear */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <button 
                  onClick={() => fetchLogs()}
                  style={{ backgroundColor: 'var(--dt-btn-bg)', color: 'var(--dt-text)', border: '1px solid var(--dt-border)', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                >
                  🔄 Refresh Logs
                </button>
                <button 
                  onClick={handleClearLogs}
                  style={{ backgroundColor: '#ef4444', color: 'white', border: 'none', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                >
                  🗑️ Clear Logs
                </button>
                <button 
                  onClick={() => setHelpTabId('logs')}
                  style={{ backgroundColor: 'var(--dt-btn-bg)', color: 'var(--dt-accent-blue)', border: '1px solid var(--dt-border)', padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}
                >
                  ❓ Help Guide
                </button>
              </div>
            </div>

            {/* LOGS VIEW 1: TIMELINE CHRONOLOGICAL */}
            {logsViewMode === 'timeline' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {selectedSessionId !== 'all' && (
                  <div style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    border: '1px solid var(--dt-accent-blue)',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    color: '#38bdf8',
                    fontWeight: 500
                  }}>
                    Filtering logs for Session ID: <span style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{selectedSessionId}</span>
                  </div>
                )}
                
                {isLoadingLogs ? (
                  <div style={{ color: 'var(--dt-text-muted)', textAlign: 'center', padding: '40px' }}>Loading chronological logs...</div>
                ) : filteredLogs.length === 0 ? (
                  <div style={{
                    textAlign: 'center',
                    padding: '60px',
                    color: 'var(--dt-text-muted)',
                    backgroundColor: 'var(--dt-card-bg)',
                    borderRadius: '12px',
                    border: '1px dashed var(--dt-border)'
                  }}>
                    No matching logs found in the 3-day buffer.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {filteredLogs.map((log, index) => {
                      const isExpanded = expandedLogIndex === index;
                      let badgeColor = 'var(--dt-text-muted)'; // INFO
                      if (log.level === 'warn') badgeColor = '#fbbf24'; // WARN
                      if (log.level === 'error') badgeColor = '#ef4444'; // ERROR
                      
                      return (
                        <div 
                          key={index} 
                          style={{
                            backgroundColor: 'var(--dt-card-bg)',
                            border: '1px solid var(--dt-border)',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            boxShadow: '0 2px 4px rgba(0, 0, 0, 0.15)'
                          }}
                        >
                          {/* Collapsed Header */}
                          <div 
                            onClick={() => setExpandedLogIndex(isExpanded ? null : index)}
                            style={{
                              padding: '12px 16px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              cursor: 'pointer',
                              userSelect: 'none',
                              backgroundColor: isExpanded ? 'var(--dt-btn-bg)' : 'transparent',
                              transition: 'background 0.2s'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
                              <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                              <span style={{
                                backgroundColor: 'transparent',
                                border: `1px solid ${badgeColor}`,
                                color: badgeColor,
                                fontSize: '10px',
                                fontWeight: 'bold',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                textTransform: 'uppercase'
                              }}>{log.level}</span>
                              <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontFamily: 'monospace' }}>
                                {new Date(log.timestamp).toLocaleTimeString()}
                              </span>
                              <span style={{
                                fontSize: '13px',
                                fontWeight: 500,
                                color: 'var(--dt-text)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                flex: 1
                              }}>{log.message}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              {log.initiator && (
                                <span style={{
                                  backgroundColor: log.initiator === 'user' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                                  color: log.initiator === 'user' ? '#60a5fa' : '#34d399',
                                  border: `1px solid ${log.initiator === 'user' ? '#2563eb' : '#059669'}`,
                                  fontSize: '9px',
                                  fontWeight: 'bold',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  textTransform: 'uppercase'
                                }}>
                                  {log.initiator === 'user' ? '👤 User' : '🤖 System'}
                                </span>
                              )}
                              <span 
                                onClick={(e) => { e.stopPropagation(); setSelectedSessionId(log.sessionId); }}
                                style={{
                                  backgroundColor: 'var(--dt-btn-bg)',
                                  color: '#38bdf8',
                                  fontSize: '10px',
                                  fontFamily: 'monospace',
                                  padding: '3px 8px',
                                  borderRadius: '4px',
                                  cursor: 'pointer'
                                }}
                              >
                                {log.sessionId.substring(0, 12)}...
                              </span>
                            </div>
                          </div>

                          {/* Expanded parsed JSON Viewer */}
                          {isExpanded && (
                            <div style={{ padding: '16px', backgroundColor: 'var(--dt-bg)', borderTop: '1px solid var(--dt-border)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 600 }}>PARSED REQUEST TELEMETRY</span>
                                <button
                                  onClick={() => {
                                    navigator.clipboard.writeText(JSON.stringify({
                                      timestamp: log.timestamp,
                                      level: log.level,
                                      message: log.message,
                                      sessionId: log.sessionId,
                                      details: log.details
                                    }, null, 2));
                                    alert('JSON copied to clipboard.');
                                  }}
                                  style={{ backgroundColor: 'var(--dt-btn-bg)', color: '#38bdf8', border: '1px solid var(--dt-border)', borderRadius: '4px', padding: '2px 8px', fontSize: '10px', fontWeight: 600, cursor: 'pointer' }}
                                >
                                  Copy JSON
                                </button>
                              </div>
                              <pre style={{
                                margin: 0,
                                padding: '12px',
                                backgroundColor: '#020617',
                                borderRadius: '6px',
                                border: '1px solid var(--dt-btn-bg)',
                                overflowX: 'auto',
                                fontSize: '12px',
                                color: '#e2e8f0',
                                fontFamily: 'monospace',
                                maxHeight: '400px',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all'
                              }}>
                                {JSON.stringify(log.details || { message: log.message, context: "No additional metadata payload." }, null, 2)}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* LOGS VIEW 2: SESSION-GROUPED */}
            {logsViewMode === 'sessions' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
                {isLoadingLogs ? (
                  <div style={{ color: 'var(--dt-text-muted)', gridColumn: '1/-1', textAlign: 'center', padding: '40px' }}>Loading session groups...</div>
                ) : getSessionGroups().length === 0 ? (
                  <div style={{
                    gridColumn: '1/-1',
                    textAlign: 'center',
                    padding: '60px',
                    color: 'var(--dt-text-muted)',
                    backgroundColor: 'var(--dt-card-bg)',
                    borderRadius: '12px',
                    border: '1px dashed var(--dt-border)'
                  }}>
                    No user sessions detected in the log buffer.
                  </div>
                ) : (
                  getSessionGroups().map(group => (
                    <div
                      key={group.sessionId}
                      style={{
                        backgroundColor: 'var(--dt-card-bg)',
                        border: '1px solid var(--dt-border)',
                        borderRadius: '12px',
                        padding: '20px',
                        boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Session ID</span>
                          <h3 style={{ fontSize: '14px', fontFamily: 'monospace', color: '#38bdf8', margin: '2px 0 0 0', wordBreak: 'break-all' }}>
                            {group.sessionId}
                          </h3>
                        </div>
                        {group.errorCount > 0 && (
                          <span style={{
                            backgroundColor: '#ef4444',
                            color: 'white',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            padding: '2px 8px',
                            borderRadius: '20px'
                          }}>{group.errorCount} ERRORS</span>
                        )}
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', backgroundColor: 'var(--dt-bg)', padding: '10px', borderRadius: '8px', fontSize: '13px' }}>
                        <div>
                          <span style={{ color: 'var(--dt-text-muted)', display: 'block', fontSize: '10px' }}>Total Requests</span>
                          <strong style={{ fontSize: '15px' }}>{group.logsCount} calls</strong>
                        </div>
                        <div>
                          <span style={{ color: 'var(--dt-text-muted)', display: 'block', fontSize: '10px' }}>Active Duration</span>
                          <strong style={{ fontSize: '13px' }}>
                            {Math.round((new Date(group.lastSeen) - new Date(group.firstSeen)) / 1000)}s
                          </strong>
                        </div>
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--dt-text-muted)', flex: 1 }}>
                        <span style={{ fontWeight: 600, color: 'var(--dt-text)' }}>Recent Activity:</span>
                        <p style={{ margin: '4px 0 0 0', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                          {group.recentMessage}
                        </p>
                      </div>

                      <button
                        onClick={() => {
                          setSelectedSessionId(group.sessionId);
                          setLogsViewMode('timeline');
                        }}
                        style={{
                          width: '100%',
                          padding: '8px',
                          backgroundColor: 'var(--dt-accent-blue)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontWeight: 600,
                          fontSize: '12px',
                          cursor: 'pointer'
                        }}
                      >
                        Drill Down Logs
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: KEY MANAGEMENT */}
        {activeTab === 'keys' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Health Check Control Row */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)'
            }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Active Key Verification Pool</h2>
                <p style={{ fontSize: '12px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                  Enable or disable keys dynamically. Paid keys support context caching.
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  onClick={handleRunHealthCheck}
                  disabled={isHealthChecking}
                  style={{
                    backgroundColor: 'var(--dt-accent-blue)',
                    color: 'white',
                    border: 'none',
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: isHealthChecking ? 'not-allowed' : 'pointer',
                    opacity: isHealthChecking ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                  }}
                >
                  {isHealthChecking ? 'Checking Keys...' : '🔄 Run Global Health Check'}
                </button>
                <button
                  onClick={() => setHelpTabId('keys')}
                  style={{
                    backgroundColor: 'var(--dt-btn-bg)',
                    color: 'var(--dt-accent-blue)',
                    border: '1px solid var(--dt-border)',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  ❓ Help Guide
                </button>
              </div>
            </div>

            {/* Overview Panel (Side-by-Side Cards) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
              {/* Keys Card */}
              <div style={{
                backgroundColor: 'var(--dt-card-bg)',
                border: '1px solid var(--dt-border)',
                borderRadius: '12px',
                padding: '16px 20px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--dt-text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🔑 Key Pool Status
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
                  {keys.map(k => {
                    let symbol = '🟢';
                    let textColor = '#10b981';
                    if (!k.enabled) {
                      symbol = '🔒';
                      textColor = 'var(--dt-text-muted)';
                    } else if (k.status.includes('Quota') || k.status.includes('Rate')) {
                      symbol = '⏳';
                      textColor = '#f59e0b';
                    } else if (k.status.includes('Auth') || k.status.includes('Invalid') || k.status.includes('Error')) {
                      symbol = '🔴';
                      textColor = '#ef4444';
                    }
                    return (
                      <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: textColor }}>
                        <span>{symbol}</span>
                        <span>{k.label}</span>
                      </div>
                    );
                  })}
                  {keys.length === 0 && (
                    <div style={{ fontSize: '13px', color: 'var(--dt-text-muted)', fontStyle: 'italic' }}>No keys configured.</div>
                  )}
                </div>
              </div>

              {/* Models Card */}
              <div style={{
                backgroundColor: 'var(--dt-card-bg)',
                border: '1px solid var(--dt-border)',
                borderRadius: '12px',
                padding: '16px 20px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px'
              }}>
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--dt-text-muted)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  🤖 Model Availability
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 16px' }}>
                  {allModels.map(model => {
                    const status = getModelAggregateStatus(model, keys);
                    let symbol = '🟢';
                    let textColor = '#10b981';
                    let label = model.replace(/^gemini-/, '');
                    
                    if (status === 'unavailable') {
                      symbol = '🔴';
                      textColor = '#ef4444';
                    } else if (status === 'quota_depleted') {
                      symbol = '⏳';
                      textColor = '#f59e0b';
                    } else if (status === 'manual_off') {
                      symbol = '🔒';
                      textColor = 'var(--dt-text-muted)';
                    }
                    
                    return (
                      <div key={model} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: textColor }} title={`Model: ${model} (${status})`}>
                        <span>{symbol}</span>
                        <span>{label}</span>
                      </div>
                    );
                  })}
                  {allModels.length === 0 && (
                    <div style={{ fontSize: '13px', color: 'var(--dt-text-muted)', fontStyle: 'italic' }}>No model data available.</div>
                  )}
                </div>
              </div>
            </div>

            {/* Keys Display Section */}
            {isLoadingKeys ? (
              <div style={{ color: 'var(--dt-text-muted)', textAlign: 'center', padding: '40px' }}>Loading keys configuration...</div>
            ) : keys.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '60px',
                color: 'var(--dt-text-muted)',
                backgroundColor: 'var(--dt-card-bg)',
                borderRadius: '12px',
                border: '1px dashed var(--dt-border)'
              }}>
                No keys are loaded. Check your backend env file.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                
                {/* Group A: Paid Keys */}
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: '#eab308', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>💎</span> Premium Paid Keys
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {keys.filter(k => k.type === 'paid').map(k => (
                      <KeyRow key={k.id} keyObj={k} onToggle={handleToggleKey} />
                    ))}
                    {keys.filter(k => k.type === 'paid').length === 0 && (
                      <div style={{ color: 'var(--dt-text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '10px 0' }}>
                        No paid keys configured in .env. Falling back entirely to free key rotations.
                      </div>
                    )}
                  </div>
                </div>

                {/* Group B: Free Keys */}
                <div>
                  <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--dt-text-muted)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>🆓</span> Free Key Pool
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {keys.filter(k => k.type === 'free').map(k => (
                      <KeyRow key={k.id} keyObj={k} onToggle={handleToggleKey} />
                    ))}
                    {keys.filter(k => k.type === 'free').length === 0 && (
                      <div style={{ color: 'var(--dt-text-muted)', fontSize: '13px', fontStyle: 'italic', padding: '10px 0' }}>
                        No free keys configured.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>
        )}

        {/* TAB 4: TEMPLATE EXPLORER */}
        {activeTab === 'template' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Toolbar */}
            <div style={{
              display: 'flex',
              gap: '16px',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Vibe Theme</span>
                <select
                  value={selectedTheme}
                  onChange={(e) => setSelectedTheme(e.target.value)}
                  style={{ backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', color: 'var(--dt-text)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', minWidth: '180px', outline: 'none' }}
                >
                  {themes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Color Palette</span>
                <select
                  value={selectedPalette}
                  onChange={(e) => setSelectedPalette(e.target.value)}
                  style={{ backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', color: 'var(--dt-text)', padding: '8px 12px', borderRadius: '6px', fontSize: '13px', minWidth: '180px', outline: 'none' }}
                >
                  {palettes.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>
                <button
                  onClick={() => setHelpTabId('template')}
                  style={{
                    backgroundColor: 'var(--dt-btn-bg)',
                    color: 'var(--dt-accent-blue)',
                    border: '1px solid var(--dt-border)',
                    padding: '10px 16px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  ❓ Help Guide
                </button>
              </div>
            </div>

            {/* Grid of Printable Template Layout Cards */}
            <div style={{
              backgroundColor: 'var(--dt-card-bg)',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px'
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0, color: 'var(--dt-text)' }}>Printable Template Library</h3>
                <p style={{ fontSize: '12px', color: 'var(--dt-text-muted)', margin: '4px 0 0 0' }}>
                  Select a template layout to preview it in full-page A4 mode and test print/PDF rendering. Previews automatically update when you switch Vibe Themes and Color Palettes.
                </p>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: '24px',
                marginTop: '10px'
              }}>
                {presets.map(preset => (
                  <div 
                    key={preset}
                    onClick={() => setActivePreviewPreset(preset)}
                    style={{
                      backgroundColor: 'var(--dt-bg)',
                      border: '1px solid var(--dt-border)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: '0 2px 4px rgba(0, 0, 0, 0.02)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-4px)';
                      e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.06)';
                      e.currentTarget.style.borderColor = 'var(--dt-accent-blue)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'none';
                      e.currentTarget.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.02)';
                      e.currentTarget.style.borderColor = 'var(--dt-border)';
                    }}
                  >
                    {/* Centered, clipped, scaled iframe thumbnail */}
                    <div style={{
                      height: '240px',
                      backgroundColor: 'white',
                      overflow: 'hidden',
                      position: 'relative',
                      borderBottom: '1px solid var(--dt-border)'
                    }}>
                      <div style={{
                        width: '794px',
                        height: '1123px',
                        position: 'absolute',
                        left: '50%',
                        top: '12px',
                        transform: 'translateX(-50%) scale(0.32)',
                        transformOrigin: 'top center',
                        pointerEvents: 'none'
                      }}>
                        <iframe
                          src={`${BACKEND_URL}/api/templates/preview?preset=${preset}&theme=${selectedTheme}&palette=${selectedPalette}`}
                          title={preset}
                          style={{
                            width: '100%',
                            height: '100%',
                            border: 'none',
                            backgroundColor: 'white'
                          }}
                        />
                      </div>
                    </div>

                    {/* Metadata footer */}
                    <div style={{ padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: 'var(--dt-text)' }}>
                          {preset.replace(/([A-Z])/g, ' $1').trim()}
                        </h4>
                        <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', display: 'block', marginTop: '2px' }}>
                          Click to expand
                        </span>
                      </div>
                      <span style={{ fontSize: '14px', color: 'var(--dt-accent-blue)', fontWeight: 'bold' }}>
                        ↗
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: COST & USAGE ANALYSIS */}
        {activeTab === 'cost' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Currency & Control Toolbar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)'
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>Cost & Usage Intelligence</h3>
                <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                  Daily and monthly token tracking with live USD-to-INR conversions
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                {/* Cost Category Selector */}
                <div style={{ display: 'flex', backgroundColor: 'var(--dt-bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--dt-border)', gap: '2px' }}>
                  {[
                    { id: 'all', label: '🌐 All Costs' },
                    { id: 'user', label: '👤 User Requests' },
                    { id: 'system', label: '🤖 System Usage' }
                  ].map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setCostCategory(cat.id)}
                      style={{
                        border: 'none',
                        backgroundColor: costCategory === cat.id ? 'var(--dt-accent-blue)' : 'transparent',
                        color: costCategory === cat.id ? 'white' : 'var(--dt-text-muted)',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* Currency Toggle */}
                <div style={{ display: 'flex', backgroundColor: 'var(--dt-bg)', padding: '3px', borderRadius: '8px', border: '1px solid var(--dt-border)' }}>
                  <button 
                    onClick={() => setCurrency('USD')}
                    style={{
                      border: 'none',
                      backgroundColor: currency === 'USD' ? 'var(--dt-accent-blue)' : 'transparent',
                      color: currency === 'USD' ? 'white' : 'var(--dt-text-muted)',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    USD ($)
                  </button>
                  <button 
                    onClick={() => setCurrency('INR')}
                    style={{
                      border: 'none',
                      backgroundColor: currency === 'INR' ? 'var(--dt-accent-blue)' : 'transparent',
                      color: currency === 'INR' ? 'white' : 'var(--dt-text-muted)',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    INR (₹)
                  </button>
                </div>

                <button
                  onClick={() => { fetchUsageSummary(); fetchUsageSessions(); }}
                  style={{
                    backgroundColor: 'var(--dt-btn-bg)',
                    color: 'var(--dt-text)',
                    border: '1px solid var(--dt-border)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  🔄 Refresh
                </button>
                <button
                  onClick={() => setHelpTabId('cost')}
                  style={{
                    backgroundColor: 'var(--dt-btn-bg)',
                    color: 'var(--dt-accent-blue)',
                    border: '1px solid var(--dt-border)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  ❓ Help Guide
                </button>
              </div>
            </div>

            {/* Sub-Navigation Toggle Bar */}
            <div style={{
              display: 'flex',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '6px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)',
              width: 'fit-content',
              gap: '6px',
              boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.05)'
            }}>
              <button
                onClick={() => setCostViewMode('overview')}
                style={{
                  border: 'none',
                  backgroundColor: costViewMode === 'overview' ? 'var(--dt-accent-blue)' : 'transparent',
                  color: costViewMode === 'overview' ? 'white' : 'var(--dt-text-muted)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                📊 Cost Overview
              </button>
              <button
                onClick={() => setCostViewMode('details')}
                style={{
                  border: 'none',
                  backgroundColor: costViewMode === 'details' ? 'var(--dt-accent-blue)' : 'transparent',
                  color: costViewMode === 'details' ? 'white' : 'var(--dt-text-muted)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                🔍 Detailed Session Logs
              </button>
            </div>

            {/* KPI Cards Row */}
            {(() => {
              const rate = currency === 'INR' ? (usageSummary?.exchangeRate || 83.5) : 1;
              const currencySymbol = currency === 'INR' ? '₹' : '$';
              const currentMonth = new Date().toISOString().substring(0, 7);

              // 1. Filter sessions based on costCategory
              const filteredSessions = usageSessions.filter(session => {
                if (costCategory === 'user') return session.initiator === 'user';
                if (costCategory === 'system') return session.initiator === 'system' || !session.initiator;
                return true;
              });

              // 2. Calculate monthly aggregates dynamically
              let monthlyCost = 0;
              let monthlySavings = 0;
              let monthlyCalls = 0;

              filteredSessions.forEach(s => {
                if (s.startTime && s.startTime.substring(0, 7) === currentMonth) {
                  monthlyCost += s.totalCost || 0;
                  monthlySavings += s.savingsFromCaching || 0;
                  if (s.items) {
                    monthlyCalls += s.items.length;
                  }
                }
              });

              // 3. Calculate daily costs dynamically
              const dailyCosts30Days = {};
              for (let i = 29; i >= 0; i--) {
                const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
                const dateStr = d.toISOString().substring(0, 10);
                dailyCosts30Days[dateStr] = 0;
              }

              filteredSessions.forEach(s => {
                if (s.items) {
                  s.items.forEach(item => {
                    const itemDate = item.timestamp.substring(0, 10);
                    if (dailyCosts30Days[itemDate] !== undefined) {
                      let itemMatches = true;
                      if (costCategory === 'user') itemMatches = item.initiator === 'user';
                      else if (costCategory === 'system') itemMatches = item.initiator === 'system' || !item.initiator;
                      
                      if (itemMatches) {
                        dailyCosts30Days[itemDate] += item.cost || 0;
                      }
                    }
                  });
                }
              });

              const chartData = Object.keys(dailyCosts30Days).sort().map(date => ({
                date,
                cost: dailyCosts30Days[date]
              }));

              // 4. Calculate model share dynamically
              const modelShareMap = {};
              let totalFilteredCost = 0;
              
              filteredSessions.forEach(s => {
                if (s.startTime && s.startTime.substring(0, 7) === currentMonth && s.items) {
                  s.items.forEach(item => {
                    let itemMatches = true;
                    if (costCategory === 'user') itemMatches = item.initiator === 'user';
                    else if (costCategory === 'system') itemMatches = item.initiator === 'system' || !item.initiator;
                    
                    if (itemMatches) {
                      const mName = item.model;
                      if (!modelShareMap[mName]) {
                        modelShareMap[mName] = {
                          calls: 0,
                          inputTokens: 0,
                          outputTokens: 0,
                          cachedTokensRead: 0,
                          cost: 0
                        };
                      }
                      modelShareMap[mName].calls += 1;
                      if (item.tokens) {
                        modelShareMap[mName].inputTokens += item.tokens.input || 0;
                        modelShareMap[mName].outputTokens += item.tokens.output || 0;
                        modelShareMap[mName].cachedTokensRead += item.tokens.cachedRead || 0;
                      }
                      modelShareMap[mName].cost += item.cost || 0;
                      totalFilteredCost += item.cost || 0;
                    }
                  });
                }
              });

              const modelsList = Object.entries(modelShareMap).sort((a, b) => b[1].cost - a[1].cost);
              const maxCost = Math.max(...chartData.map(d => d.cost), 0.001);

              return (
                <>
                  {costViewMode === 'overview' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      {/* KPI Cards Row */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                        <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                          <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Monthly Cost ({currentMonth})</span>
                          <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--dt-text)', margin: '8px 0 4px 0' }}>
                            {currencySymbol}{(monthlyCost * rate).toFixed(4)}
                          </h2>
                          <span style={{ fontSize: '11px', color: '#38bdf8' }}>Accumulated developer spend</span>
                        </div>

                        <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid #10b981' }}>
                          <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600, textTransform: 'uppercase' }}>Caching Savings</span>
                          <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#10b981', margin: '8px 0 4px 0' }}>
                            {currencySymbol}{(monthlySavings * rate).toFixed(4)}
                          </h2>
                          <span style={{ fontSize: '11px', color: '#a7f3d0' }}>Saved by Paid Key Context Caching</span>
                        </div>

                        <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                          <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Monthly API Requests</span>
                          <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--dt-text)', margin: '8px 0 4px 0' }}>
                            {monthlyCalls}
                          </h2>
                          <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)' }}>Calls across all rotating keys</span>
                        </div>

                        <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                          <span style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>Unique Sessions (30d)</span>
                          <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--dt-text)', margin: '8px 0 4px 0' }}>
                            {filteredSessions.length}
                          </h2>
                          <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)' }}>Unique session histories</span>
                        </div>
                      </div>

                      {/* Middle Section: Chart and Model Cost Breakdown */}
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        {/* Daily Chart (SVG) */}
                        <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)', flex: 2, minWidth: '350px' }}>
                          <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--dt-text-muted)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Daily Spend (Last 30 Days)
                          </h3>
                          <svg viewBox="0 0 600 180" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
                            {/* Grid Lines */}
                            <line x1={45} y1={0} x2={600} y2={0} stroke="var(--dt-btn-bg)" strokeDasharray="4 4" />
                            <line x1={45} y1={80} x2={600} y2={80} stroke="var(--dt-btn-bg)" strokeDasharray="4 4" />
                            <line x1={45} y1={160} x2={600} y2={160} stroke="var(--dt-border)" />

                            {/* Y Axis Labels */}
                            <text x={37} y={4} fill="var(--dt-text-muted)" fontSize="9px" textAnchor="end">{currencySymbol}{(maxCost * rate).toFixed(3)}</text>
                            <text x={37} y={83} fill="var(--dt-text-muted)" fontSize="9px" textAnchor="end">{currencySymbol}{((maxCost * rate) / 2).toFixed(3)}</text>
                            <text x={37} y={160} fill="var(--dt-text-muted)" fontSize="9px" textAnchor="end">{currencySymbol}0.000</text>

                            {/* Bars */}
                            {chartData.map((d, index) => {
                              const barHeight = (d.cost / maxCost) * 160;
                              const x = 45 + (index * (555 / chartData.length)) + 1;
                              const y = 160 - barHeight;
                              const displayCost = (d.cost * rate).toFixed(5);
                              const barWidth = Math.max(2, (555 / chartData.length) - 3);

                              return (
                                <g key={d.date}>
                                  <rect
                                    x={x}
                                    y={y}
                                    width={barWidth}
                                    height={Math.max(barHeight, 1.5)}
                                    fill={d.cost > 0 ? 'var(--dt-accent-blue)' : 'var(--dt-btn-bg)'}
                                    rx={1}
                                    style={{ cursor: 'pointer', transition: 'all 0.15s' }}
                                  >
                                    <title>{`${d.date}: ${currencySymbol}${displayCost}`}</title>
                                  </rect>
                                </g>
                              );
                            })}
                          </svg>
                        </div>

                        {/* Model cost distribution */}
                        <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)', flex: 1, minWidth: '280px', display: 'flex', flexDirection: 'column' }}>
                          <h3 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--dt-text-muted)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Model Share (This Month)
                          </h3>
                          
                          {modelsList.length === 0 ? (
                            <div style={{ color: 'var(--dt-text-muted)', fontStyle: 'italic', fontSize: '13px', margin: 'auto 0', textAlign: 'center', padding: '20px 0' }}>
                              No model requests logged yet.
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
                              {modelsList.map(([modelName, mData]) => {
                                const percent = Math.min(100, Math.round((mData.cost / (totalFilteredCost || 0.0001)) * 100));

                                return (
                                  <div key={modelName} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                      <span style={{ fontFamily: 'monospace', color: 'var(--dt-text)', fontWeight: 600 }}>
                                        {modelName.replace('gemini-', '')}
                                      </span>
                                      <span style={{ color: 'var(--dt-text-muted)' }}>
                                        {currencySymbol}{(mData.cost * rate).toFixed(4)} ({percent}%)
                                      </span>
                                    </div>
                                    
                                    {/* Progress bar */}
                                    <div style={{ height: '6px', width: '100%', backgroundColor: 'var(--dt-btn-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                                      <div style={{ height: '100%', width: `${percent}%`, backgroundColor: 'var(--dt-accent-blue)', borderRadius: '3px' }} />
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--dt-text-muted)' }}>
                                      <span>{mData.calls} calls</span>
                                      <span>In: {(mData.inputTokens/1000).toFixed(0)}k | Out: {(mData.outputTokens/1000).toFixed(1)}k</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Danger Zone / Reset */}
                      <div style={{
                        marginTop: '12px',
                        backgroundColor: 'rgba(239, 68, 68, 0.05)',
                        border: '1px dashed rgba(239, 68, 68, 0.25)',
                        padding: '16px 20px',
                        borderRadius: '12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}>
                        <div>
                          <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', margin: 0 }}>Danger Zone</h4>
                          <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                            Permanently erase the in-memory and local file records for cost and usage totals
                          </p>
                        </div>

                        <button
                          onClick={handleResetUsage}
                          disabled={isResettingUsage}
                          style={{
                            backgroundColor: '#7f1d1d',
                            color: '#fca5a5',
                            border: '1px solid #b91c1c',
                            padding: '8px 16px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                          }}
                        >
                          {isResettingUsage ? 'Resetting...' : '⚠️ Reset Usage Database'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                      {/* Bottom Section: Collapsible Session Timeline Feed */}
                      <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                          <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--dt-text)', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Collapsible Session Logs (30d History)
                          </h3>
                          <span style={{ fontSize: '11px', backgroundColor: 'var(--dt-btn-bg)', color: 'var(--dt-text-muted)', padding: '4px 8px', borderRadius: '4px', fontWeight: 600 }}>
                            Showing {filteredSessions.length} of {usageSessions.length} sessions
                          </span>
                        </div>

                        {filteredSessions.length === 0 ? (
                          <div style={{
                            textAlign: 'center',
                            padding: '40px',
                            color: 'var(--dt-text-muted)',
                            border: '1px dashed var(--dt-border)',
                            borderRadius: '8px'
                          }}>
                            No matching session logs detected.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {filteredSessions.map(session => {
                              const isExpanded = expandedSessionId === session.sessionId;
                              const durationStr = session.durationMs > 1000 ? `${(session.durationMs / 1000).toFixed(0)}s` : `${session.durationMs}ms`;
                              const date = new Date(session.startTime).toLocaleString();
                              const sessionLabel = session.initiator === 'user' ? '👤 User Session' : '🤖 System Usage';
                              const labelColor = session.initiator === 'user' ? '#60a5fa' : '#34d399';

                              return (
                                <div 
                                  key={session.sessionId}
                                  style={{
                                    border: '1px solid var(--dt-border)',
                                    borderRadius: '10px',
                                    backgroundColor: 'var(--dt-bg)',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s'
                                  }}
                                >
                                  {/* Summary Header */}
                                  <div 
                                    onClick={() => setExpandedSessionId(isExpanded ? null : session.sessionId)}
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      alignItems: 'center',
                                      padding: '16px 20px',
                                      cursor: 'pointer',
                                      userSelect: 'none',
                                      borderBottom: isExpanded ? '1px solid var(--dt-btn-bg)' : 'none'
                                    }}
                                  >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: '13px', color: '#38bdf8' }}>
                                          {session.sessionId}
                                        </span>
                                        <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)' }}>{date}</span>
                                        <span style={{ fontSize: '10px', color: labelColor, fontWeight: 'bold', border: `1px solid ${labelColor}`, padding: '1px 6px', borderRadius: '4px' }}>
                                          {sessionLabel}
                                        </span>
                                      </div>
                                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {session.modelsUsed.map(m => (
                                          <span key={m} style={{ backgroundColor: 'var(--dt-btn-bg)', color: 'var(--dt-text-muted)', fontSize: '9px', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                            {m.replace('gemini-', '')}
                                          </span>
                                        ))}
                                      </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                                      <div style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: '9px', color: 'var(--dt-text-muted)', display: 'block', textTransform: 'uppercase' }}>Duration</span>
                                        <strong style={{ fontSize: '13px', color: 'var(--dt-text)' }}>{durationStr}</strong>
                                      </div>
                                      <div style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: '9px', color: 'var(--dt-text-muted)', display: 'block', textTransform: 'uppercase' }}>Total Cost</span>
                                        <strong style={{ fontSize: '14px', color: '#60a5fa' }}>{currencySymbol}{(session.totalCost * rate).toFixed(4)}</strong>
                                      </div>
                                      <span style={{ fontSize: '18px', color: 'var(--dt-text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                                        ▾
                                      </span>
                                    </div>
                                  </div>

                                  {/* Expanded Body: Vertical Timeline */}
                                  {isExpanded && (
                                    <div style={{ padding: '20px 24px', backgroundColor: 'rgba(241, 245, 249, 0.4)' }}>
                                      <h4 style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '16px', letterSpacing: '0.05em' }}>
                                        Session Execution Timeline ({session.items.length} sub-tasks)
                                      </h4>

                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0', position: 'relative' }}>
                                        {/* Central Line */}
                                        <div style={{ position: 'absolute', top: '10px', bottom: '10px', left: '8px', width: '2px', backgroundColor: 'var(--dt-btn-bg)' }} />

                                        {session.items.map((item, index) => {
                                          const latencyStr = item.latencyMs > 1000 ? `${(item.latencyMs / 1000).toFixed(1)}s` : `${item.latencyMs}ms`;

                                          return (
                                            <div 
                                              key={index}
                                              style={{
                                                display: 'flex',
                                                position: 'relative',
                                                paddingLeft: '32px',
                                                paddingBottom: index === session.items.length - 1 ? '0' : '20px',
                                                alignItems: 'flex-start'
                                              }}
                                            >
                                              {/* Dot */}
                                              <div style={{
                                                position: 'absolute',
                                                left: '3px',
                                                top: '4px',
                                                width: '12px',
                                                height: '12px',
                                                borderRadius: '50%',
                                                backgroundColor: (item.error) ? '#ef4444' : '#10b981',
                                                border: '2px solid var(--dt-bg)',
                                                zIndex: 2
                                              }} />

                                              <div style={{ flex: 1, backgroundColor: 'var(--dt-card-bg)', border: '1px solid var(--dt-border)', borderRadius: '8px', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                  <span style={{ fontSize: '12px', fontWeight: 700, color: (item.error) ? '#ef4444' : 'var(--dt-text)' }}>
                                                    {item.taskName}
                                                  </span>
                                                  <span style={{
                                                    backgroundColor: (item.error) ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                                    color: (item.error) ? '#ef4444' : '#10b981',
                                                    fontSize: '9px',
                                                    fontWeight: 'bold',
                                                    padding: '2px 8px',
                                                    borderRadius: '10px'
                                                  }}>
                                                    {item.error ? 'FAILED' : 'SUCCESS'}
                                                  </span>
                                                </div>

                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: '11px', color: 'var(--dt-text-muted)' }}>
                                                  <span>Endpoint: <strong style={{ color: 'var(--dt-text)' }}>{item.endpoint}</strong></span>
                                                  <span>Model: <strong style={{ color: 'var(--dt-text)', fontFamily: 'monospace' }}>{item.model}</strong></span>
                                                  <span>Latency: <strong style={{ color: 'var(--dt-text)' }}>{latencyStr}</strong></span>
                                                </div>

                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                                                  <span style={{ fontSize: '10px', color: '#6b7280' }}>
                                                    In: {item.tokens.input} | Out: {item.tokens.output} 
                                                    {item.tokens.cachedRead > 0 && (
                                                      <span style={{ color: '#10b981', fontWeight: 600 }}> (Cached: {item.tokens.cachedRead})</span>
                                                    )}
                                                  </span>
                                                  <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)' }}>
                                                    {new Date(item.timestamp).toLocaleTimeString()}
                                                  </span>
                                                </div>
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}

          </div>
        )}

        {/* TAB 6: CONTEXT CACHE MANAGER */}
        {activeTab === 'caches' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Header Toolbar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)'
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>💾 Live Context Cache Cockpit</h3>
                <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                  Monitor active memory pools on your Paid Key and purge unused storage
                </p>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <button
                  onClick={() => fetchCaches()}
                  disabled={isLoadingCaches}
                  style={{
                    backgroundColor: 'var(--dt-btn-bg)',
                    color: 'var(--dt-text)',
                    border: '1px solid var(--dt-border)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {isLoadingCaches ? '🔄 Syncing...' : '🔄 Refresh Caches'}
                </button>
                <button
                  onClick={() => setHelpTabId('caches')}
                  style={{
                    backgroundColor: 'var(--dt-btn-bg)',
                    color: 'var(--dt-accent-blue)',
                    border: '1px solid var(--dt-border)',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  ❓ Help Guide
                </button>
              </div>
            </div>

            {/* Budget warnings and Stats */}
            {(() => {
              if (caches.length === 0) return null;

              // Calculate total hourly cost
              let totalHourlyCost = 0;
              let totalTokens = 0;
              let hasUnusedLargeCache = false;

              caches.forEach(c => {
                const modelName = (c.model || '').toLowerCase();
                const isFlash = modelName.includes('flash');
                const storageRate = isFlash ? 0.0045 : 0.0875; // $0.0045 for flash, $0.0875 for pro
                const tokensM = (c.tokenCount || 0) / 1000000;
                const hourlyCost = tokensM * storageRate;
                totalHourlyCost += hourlyCost;
                totalTokens += c.tokenCount || 0;

                // Check for critical unused: active > 10 minutes with 0 hits
                const minutesActive = (Date.now() - (c.createdAt || Date.now())) / 60000;
                if (c.hits === 0 && (minutesActive > 1 || hourlyCost > 0.01)) {
                  hasUnusedLargeCache = true;
                }
              });

              let badgeColor = '#10b981'; // Green
              let badgeText = 'Green (Safe Budget)';
              let warningMessage = 'Active storage costs are within safe developer budgets. Zero-waste active caching.';

              if (totalHourlyCost > 0.05 || hasUnusedLargeCache) {
                badgeColor = '#ef4444'; // Red
                badgeText = 'Red (Critical Overrun Risk)';
                warningMessage = 'Unused High-Cost Cache detected: Click \'Delete\' to terminate unused caches, or ask Antigravity to reduce TTL in server.js.';
              } else if (totalHourlyCost > 0.01) {
                badgeColor = '#fbbf24'; // Amber
                badgeText = 'Amber (Caution Threshold)';
                warningMessage = 'Large context active. Ensure frequent cache hits to justify storage cost.';
              }

              const rate = currency === 'INR' ? (usageSummary?.exchangeRate || 83.5) : 1;
              const currencySymbol = currency === 'INR' ? '₹' : '$';

              return (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr',
                  gap: '20px',
                  backgroundColor: 'var(--dt-card-bg)',
                  padding: '20px',
                  borderRadius: '12px',
                  border: `1px solid ${badgeColor}`,
                  boxShadow: `0 0 10px rgba(0,0,0,0.15)`
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid var(--dt-border)', paddingRight: '20px' }}>
                    <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Cache Budget Status</span>
                    <span style={{
                      backgroundColor: badgeColor,
                      color: badgeColor === '#fbbf24' ? 'var(--dt-bg)' : 'white',
                      fontSize: '11px',
                      fontWeight: 800,
                      padding: '4px 10px',
                      borderRadius: '6px',
                      textAlign: 'center',
                      textTransform: 'uppercase'
                    }}>{badgeText}</span>
                    <div style={{ marginTop: '10px' }}>
                      <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', display: 'block' }}>Total Caching Cost</span>
                      <strong style={{ fontSize: '20px', color: 'var(--dt-text)' }}>
                        {currencySymbol}{(totalHourlyCost * rate).toFixed(5)}/hr
                      </strong>
                    </div>
                    <div>
                      <span style={{ fontSize: '10px', color: 'var(--dt-text-muted)', display: 'block' }}>Total Cached Tokens</span>
                      <strong style={{ fontSize: '15px', color: 'var(--dt-text)' }}>
                        {(totalTokens / 1000).toFixed(1)}k tokens
                      </strong>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', paddingLeft: '10px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 700, color: badgeColor === '#ef4444' ? '#ef4444' : 'var(--dt-text)' }}>
                      {badgeColor === '#ef4444' ? '⚠️ Budget Storage Alert!' : 'ℹ️ Cache Engine Status'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '12px', color: '#e5e7eb', lineHeight: '1.5' }}>
                      {warningMessage}
                    </p>
                    <div style={{ marginTop: '12px', fontSize: '11px', color: 'var(--dt-text-muted)' }}>
                      💡 Caches use a <strong>Rolling TTL</strong> of 5 minutes. Every cache hit automatically extends the lease by another 5 minutes, preventing idle storage costs. If a cache receives zero hits, it self-cleans automatically!
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Cache List Table */}
            <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
              {isLoadingCaches ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--dt-text-muted)' }}>
                  🔄 Syncing with Google API cache registry...
                </div>
              ) : caches.length === 0 ? (
                <div style={{
                  textAlign: 'center',
                  padding: '50px 40px',
                  color: 'var(--dt-text-muted)',
                  border: '1px dashed var(--dt-border)',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <span style={{ fontSize: '32px' }}>🍃</span>
                  <div>
                    <h4 style={{ margin: '0 0 4px 0', color: 'var(--dt-text)', fontSize: '14px' }}>No Active Caches Detected</h4>
                    <p style={{ margin: 0, fontSize: '12px' }}>Google servers report zero active caches for your Paid Key. No storage fees are accumulating.</p>
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--dt-border)', color: 'var(--dt-text-muted)', fontWeight: 700 }}>
                        <th style={{ padding: '12px 16px' }}>Cache ID</th>
                        <th style={{ padding: '12px 16px' }}>Model</th>
                        <th style={{ padding: '12px 16px' }}>Tokens</th>
                        <th style={{ padding: '12px 16px' }}>Hourly Cost</th>
                        <th style={{ padding: '12px 16px' }}>Hits</th>
                        <th style={{ padding: '12px 16px' }}>Created</th>
                        <th style={{ padding: '12px 16px' }}>Expires In</th>
                        <th style={{ padding: '12px 16px', textAnchor: 'end', textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {caches.map(c => {
                        const modelName = (c.model || '').toLowerCase();
                        const isFlash = modelName.includes('flash');
                        const storageRate = isFlash ? 0.0045 : 0.0875;
                        const tokensM = (c.tokenCount || 0) / 1000000;
                        const hourlyCost = tokensM * storageRate;
                        
                        const rate = currency === 'INR' ? (usageSummary?.exchangeRate || 83.5) : 1;
                        const currencySymbol = currency === 'INR' ? '₹' : '$';

                        // Calculate remaining TTL
                        const expiresAt = new Date(c.expireTime).getTime();
                        const remainingSec = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
                        
                        // Age
                        const ageMin = Math.round((Date.now() - (c.createdAt || Date.now())) / 60000);
                        const ageStr = ageMin === 0 ? 'Just now' : `${ageMin}m ago`;

                        // Efficiency score badge
                        let effColor = '#ef4444'; // Red (wasteful)
                        let effText = '0% Wasteful';
                        if (c.hits > 5) {
                          effColor = '#10b981'; // Green
                          effText = 'Excellent';
                        } else if (c.hits > 0) {
                          effColor = '#fbbf24'; // Amber
                          effText = 'Efficient';
                        } else if (ageMin < 3) {
                          effColor = '#6b7280'; // Gray (newly created)
                          effText = 'Warm-up';
                        }

                        return (
                          <tr key={c.name} style={{ borderBottom: '1px solid var(--dt-btn-bg)' }}>
                            <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: '#38bdf8', fontWeight: 600 }}>
                              {c.name.replace('cachedContents/', '')}
                            </td>
                            <td style={{ padding: '14px 16px', fontFamily: 'monospace' }}>
                              {c.model.replace('gemini-', '')}
                            </td>
                            <td style={{ padding: '14px 16px', fontWeight: 700 }}>
                              {(c.tokenCount || 0).toLocaleString()}
                            </td>
                            <td style={{ padding: '14px 16px', color: '#60a5fa', fontWeight: 600 }}>
                              {currencySymbol}{(hourlyCost * rate).toFixed(5)}
                            </td>
                            <td style={{ padding: '14px 16px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <strong style={{ fontSize: '14px' }}>{c.hits}</strong>
                                <span style={{
                                  backgroundColor: effColor === '#fbbf24' ? 'rgba(251,191,36,0.1)' : effColor === '#10b981' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                                  color: effColor,
                                  fontSize: '9px',
                                  fontWeight: 800,
                                  padding: '2px 6px',
                                  borderRadius: '4px',
                                  textTransform: 'uppercase'
                                }}>{effText}</span>
                              </div>
                            </td>
                            <td style={{ padding: '14px 16px', color: 'var(--dt-text-muted)' }}>
                              {ageStr}
                            </td>
                            <td style={{ padding: '14px 16px', fontFamily: 'monospace', color: remainingSec < 60 ? '#ef4444' : '#10b981', fontWeight: 'bold' }}>
                              {remainingSec}s
                            </td>
                            <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                              <button
                                onClick={() => handleDeleteCache(c.name)}
                                disabled={isDeletingCache === c.name}
                                style={{
                                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                  color: '#f87171',
                                  border: '1px solid rgba(239, 68, 68, 0.3)',
                                  padding: '6px 12px',
                                  borderRadius: '6px',
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                              >
                                {isDeletingCache === c.name ? 'Purging...' : '🗑️ Purge'}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        )}

        {/* TAB 7: PROMPT PLAYGROUND */}
        {activeTab === 'playground' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Toolbar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)'
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>🛝 Prompt Playground</h3>
                <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                  Test prompt modifications, system instructions, and temperature variations on live models
                </p>
              </div>
              <button
                onClick={() => setHelpTabId('playground')}
                style={{
                  backgroundColor: 'var(--dt-btn-bg)',
                  color: 'var(--dt-accent-blue)',
                  border: '1px solid var(--dt-border)',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ❓ Help Guide
              </button>
            </div>

            {/* Main Panel Layout */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'stretch' }}>
              
              {/* Left Column: Form Controls */}
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 700 }}>Model Configuration</h4>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Select Model</label>
                    <select
                      value={playModel}
                      onChange={(e) => setPlayModel(e.target.value)}
                      style={{ backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', color: 'var(--dt-text)', padding: '10px 12px', borderRadius: '8px', fontSize: '13px', outline: 'none' }}
                    >
                      <option value="gemini-3.5-flash">gemini-3.5-flash (Default)</option>
                      <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                      <option value="gemini-2.5-pro">gemini-2.5-pro</option>
                      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                    </select>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Temperature: {playTemp.toFixed(1)}</label>
                    <input
                      type="range"
                      min="0.0"
                      max="2.0"
                      step="0.1"
                      value={playTemp}
                      onChange={(e) => setPlayTemp(parseFloat(e.target.value))}
                      style={{ height: '38px', accentColor: 'var(--dt-accent-blue)', cursor: 'pointer' }}
                    />
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <label style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>System Instructions (Optional)</label>
                  <textarea
                    placeholder="You are an expert copywriter..."
                    value={playSystem}
                    onChange={(e) => setPlaySystem(e.target.value)}
                    style={{
                      height: '80px',
                      backgroundColor: 'var(--dt-bg)',
                      border: '1px solid var(--dt-border)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'var(--dt-text)',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      resize: 'vertical',
                      outline: 'none'
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                  <label style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>User Prompt</label>
                  <textarea
                    placeholder="Write your prompt here..."
                    value={playPrompt}
                    onChange={(e) => setPlayPrompt(e.target.value)}
                    style={{
                      flex: 1,
                      minHeight: '180px',
                      backgroundColor: 'var(--dt-bg)',
                      border: '1px solid var(--dt-border)',
                      borderRadius: '8px',
                      padding: '10px 12px',
                      color: 'var(--dt-text)',
                      fontSize: '13px',
                      fontFamily: 'monospace',
                      resize: 'vertical',
                      outline: 'none'
                    }}
                  />
                </div>

                <button
                  onClick={handleRunPlayground}
                  disabled={isPlaying}
                  style={{
                    backgroundColor: 'var(--dt-accent-blue)',
                    color: 'white',
                    border: 'none',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    fontWeight: 700,
                    cursor: isPlaying ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  {isPlaying ? '⚡ Running Prompt...' : '⚡ Execute Playground Run'}
                </button>
              </div>

              {/* Right Column: Execution Output */}
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: 700 }}>Execution Results</h4>
                
                {isPlaying ? (
                  <div style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px', color: 'var(--dt-text-muted)' }}>
                    <div style={{ fontSize: '28px', animation: 'spin 1.5s linear infinite' }}>⏳</div>
                    <span style={{ fontSize: '13px' }}>Streaming response from Gemini...</span>
                  </div>
                ) : !playResult ? (
                  <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', border: '1px dashed var(--dt-border)', borderRadius: '8px', color: 'var(--dt-text-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                    Click "Execute Playground Run" to compile response.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', flex: 1 }}>
                    
                    {/* Telemetry row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', backgroundColor: 'var(--dt-bg)', padding: '12px', borderRadius: '8px', fontSize: '12px', border: '1px solid var(--dt-btn-bg)' }}>
                      <div>
                        <span style={{ color: 'var(--dt-text-muted)', display: 'block', fontSize: '9px', textTransform: 'uppercase' }}>Latency</span>
                        <strong>{playResult.latencyMs}ms</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--dt-text-muted)', display: 'block', fontSize: '9px', textTransform: 'uppercase' }}>Tokens (In/Out)</span>
                        <strong>{playResult.tokens.input} / {playResult.tokens.output}</strong>
                      </div>
                      <div>
                        <span style={{ color: 'var(--dt-text-muted)', display: 'block', fontSize: '9px', textTransform: 'uppercase' }}>Routing Key</span>
                        <strong style={{ color: '#38bdf8' }}>{playResult.keyLabel}</strong>
                      </div>
                    </div>

                    {/* Output Box */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                      <label style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Generated Content</label>
                      <div style={{
                        flex: 1,
                        backgroundColor: 'var(--dt-bg)',
                        border: '1px solid var(--dt-btn-bg)',
                        borderRadius: '8px',
                        padding: '14px',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        color: '#e5e7eb',
                        fontFamily: 'monospace',
                        overflowY: 'auto',
                        whiteSpace: 'pre-wrap',
                        maxHeight: '340px'
                      }}>
                        {playResult.text}
                      </div>
                    </div>

                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {/* TAB 8: TAKEAWAY A/B LAYOUT TESTER */}
        {activeTab === 'abtest' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Toolbar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)'
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>⚖️ Takeaway A/B Layout Tester</h3>
                <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                  Compile slide layouts side-by-side using different models or prompts to evaluate visual styles
                </p>
              </div>
              <button
                onClick={() => setHelpTabId('abtest')}
                style={{
                  backgroundColor: 'var(--dt-btn-bg)',
                  color: 'var(--dt-accent-blue)',
                  border: '1px solid var(--dt-border)',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ❓ Help Guide
              </button>
            </div>

            {/* Input Config Section */}
            <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>A/B Comparison Setup</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Source Content / Takeaway Prompt</label>
                <textarea
                  placeholder="Paste the slide text or prompt to compile (e.g., Outline slide about cloud migration benefits)..."
                  value={abPrompt}
                  onChange={(e) => setAbPrompt(e.target.value)}
                  style={{
                    height: '80px',
                    backgroundColor: 'var(--dt-bg)',
                    border: '1px solid var(--dt-border)',
                    borderRadius: '8px',
                    padding: '10px 12px',
                    color: 'var(--dt-text)',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    resize: 'vertical',
                    outline: 'none'
                  }}
                />
              </div>

              {/* Dual configuration columns */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                
                {/* Variant A */}
                <div style={{ backgroundColor: 'rgba(241, 245, 249, 0.4)', padding: '16px', borderRadius: '8px', border: '1px solid var(--dt-btn-bg)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '13px', color: 'var(--dt-accent-blue)' }}>Variant A (Control)</strong>
                    <select
                      value={abModelA}
                      onChange={(e) => setAbModelA(e.target.value)}
                      style={{ backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', color: 'var(--dt-text)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', outline: 'none' }}
                    >
                      <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                      <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '10px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>System Instruction A</label>
                    <textarea
                      placeholder="Write layout system instructions for Variant A..."
                      value={abSystemA}
                      onChange={(e) => setAbSystemA(e.target.value)}
                      style={{ height: '80px', backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--dt-text)', fontSize: '12px', fontFamily: 'monospace', resize: 'none', outline: 'none' }}
                    />
                  </div>
                </div>

                {/* Variant B */}
                <div style={{ backgroundColor: 'rgba(241, 245, 249, 0.4)', padding: '16px', borderRadius: '8px', border: '1px solid var(--dt-btn-bg)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '13px', color: '#10b981' }}>Variant B (Challenger)</strong>
                    <select
                      value={abModelB}
                      onChange={(e) => setAbModelB(e.target.value)}
                      style={{ backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', color: 'var(--dt-text)', padding: '4px 8px', borderRadius: '6px', fontSize: '12px', outline: 'none' }}
                    >
                      <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                      <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '10px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>System Instruction B</label>
                    <textarea
                      placeholder="Write layout system instructions for Variant B..."
                      value={abSystemB}
                      onChange={(e) => setAbSystemB(e.target.value)}
                      style={{ height: '80px', backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-border)', borderRadius: '6px', padding: '8px 10px', color: 'var(--dt-text)', fontSize: '12px', fontFamily: 'monospace', resize: 'none', outline: 'none' }}
                    />
                  </div>
                </div>

              </div>

              <button
                onClick={handleRunABTest}
                disabled={isTestingAB}
                style={{
                  backgroundColor: '#10b981',
                  color: 'white',
                  border: 'none',
                  padding: '12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isTestingAB ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px'
                }}
              >
                {isTestingAB ? '⚡ Compiling Side-by-Side Slide Decks...' : '⚡ Run A/B Comparison Test'}
              </button>
            </div>

            {/* Results Previews */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
              
              {/* Variant A Panel */}
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', color: 'var(--dt-accent-blue)', fontWeight: 700 }}>Variant A Output Preview</h4>
                {isTestingAB ? (
                  <div style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dt-text-muted)' }}>
                    🔄 Generating Variant A...
                  </div>
                ) : !abResult?.a ? (
                  <div style={{ height: '350px', border: '1px dashed var(--dt-border)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dt-text-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                    Awaiting A/B execution...
                  </div>
                ) : !abResult.a.success ? (
                  <div style={{ height: '350px', color: '#ef4444', padding: '20px', fontSize: '13px', fontFamily: 'monospace', overflowY: 'auto' }}>
                    Error: {abResult.a.error}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Sandbox iframe */}
                    <div style={{ border: '1px solid var(--dt-btn-bg)', borderRadius: '8px', overflow: 'hidden', height: '350px', backgroundColor: 'white' }}>
                      <iframe
                        srcDoc={abResult.a.html}
                        title="Variant A Preview"
                        sandbox="allow-scripts"
                        style={{ width: '100%', height: '100%', border: 'none' }}
                      />
                    </div>
                    {/* Raw view toggle or tokens */}
                    <details style={{ fontSize: '12px' }}>
                      <summary style={{ color: '#38bdf8', cursor: 'pointer', userSelect: 'none' }}>Show Raw HTML Source</summary>
                      <pre style={{ margin: '8px 0 0 0', padding: '10px', backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-btn-bg)', borderRadius: '6px', maxHeight: '150px', overflowY: 'auto', fontSize: '11px', fontFamily: 'monospace', color: '#e5e7eb' }}>
                        {abResult.a.html}
                      </pre>
                    </details>
                  </div>
                )}
              </div>

              {/* Variant B Panel */}
              <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '13px', color: '#10b981', fontWeight: 700 }}>Variant B Output Preview</h4>
                {isTestingAB ? (
                  <div style={{ height: '350px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dt-text-muted)' }}>
                    🔄 Generating Variant B...
                  </div>
                ) : !abResult?.b ? (
                  <div style={{ height: '350px', border: '1px dashed var(--dt-border)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dt-text-muted)', fontStyle: 'italic', fontSize: '13px' }}>
                    Awaiting A/B execution...
                  </div>
                ) : !abResult.b.success ? (
                  <div style={{ height: '350px', color: '#ef4444', padding: '20px', fontSize: '13px', fontFamily: 'monospace', overflowY: 'auto' }}>
                    Error: {abResult.b.error}
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {/* Sandbox iframe */}
                    <div style={{ border: '1px solid var(--dt-btn-bg)', borderRadius: '8px', overflow: 'hidden', height: '350px', backgroundColor: 'white' }}>
                      <iframe
                        srcDoc={abResult.b.html}
                        title="Variant B Preview"
                        sandbox="allow-scripts"
                        style={{ width: '100%', height: '100%', border: 'none' }}
                      />
                    </div>
                    {/* Raw view toggle */}
                    <details style={{ fontSize: '12px' }}>
                      <summary style={{ color: '#38bdf8', cursor: 'pointer', userSelect: 'none' }}>Show Raw HTML Source</summary>
                      <pre style={{ margin: '8px 0 0 0', padding: '10px', backgroundColor: 'var(--dt-bg)', border: '1px solid var(--dt-btn-bg)', borderRadius: '6px', maxHeight: '150px', overflowY: 'auto', fontSize: '11px', fontFamily: 'monospace', color: '#e5e7eb' }}>
                        {abResult.b.html}
                      </pre>
                    </details>
                  </div>
                )}
              </div>

            </div>

          </div>
        )}

        {/* TAB 9: LATENCY & RELIABILITY ANALYTICS */}
        {activeTab === 'analytics' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Toolbar */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backgroundColor: 'var(--dt-card-bg)',
              padding: '16px 20px',
              borderRadius: '12px',
              border: '1px solid var(--dt-border)'
            }}>
              <div>
                <h3 style={{ fontSize: '15px', fontWeight: 700, margin: 0 }}>📈 Latency & Reliability Intelligence</h3>
                <p style={{ fontSize: '11px', color: 'var(--dt-text-muted)', margin: '2px 0 0 0' }}>
                  Analyze response latency bottlenecks, error ratios, and model calling frequencies
                </p>
              </div>
              <button
                onClick={() => setHelpTabId('analytics')}
                style={{
                  backgroundColor: 'var(--dt-btn-bg)',
                  color: 'var(--dt-accent-blue)',
                  border: '1px solid var(--dt-border)',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                ❓ Help Guide
              </button>
            </div>

            {/* Performance Analytics Engine */}
            {(() => {
              // Aggregate statistics per model
              const modelStats = {};
              let totalApiCalls = 0;
              let totalErrors = 0;

              usageSessions.forEach(session => {
                (session.items || []).forEach(item => {
                  const m = item.model || 'Unknown';
                  if (!modelStats[m]) {
                    modelStats[m] = { name: m, calls: 0, errors: 0, latencies: [] };
                  }
                  modelStats[m].calls += 1;
                  modelStats[m].latencies.push(item.latencyMs || 0);
                  totalApiCalls += 1;
                });
              });

              // Process logs for errors
              logs.forEach(log => {
                if (log.level === 'error' || log.message.includes('failed') || log.message.includes('429') || log.message.includes('500')) {
                  totalErrors += 1;
                  const m = log.metadata?.model || log.model || 'Unknown';
                  if (!modelStats[m]) {
                    modelStats[m] = { name: m, calls: 0, errors: 0, latencies: [] };
                  }
                  modelStats[m].errors += 1;
                }
              });

              const modelsArray = Object.values(modelStats);

              if (modelsArray.length === 0) {
                return (
                  <div style={{
                    textAlign: 'center',
                    padding: '60px',
                    color: 'var(--dt-text-muted)',
                    backgroundColor: 'var(--dt-card-bg)',
                    border: '1px dashed var(--dt-border)',
                    borderRadius: '12px'
                  }}>
                    No performance logs recorded yet. Run some slide generations to populate latencies.
                  </div>
                );
              }

              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  
                  {/* Summary Stats Row */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                    <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Reliability Rating</span>
                      <h2 style={{ fontSize: '24px', fontWeight: 800, color: totalErrors === 0 ? '#10b981' : totalErrors / (totalApiCalls || 1) > 0.1 ? '#ef4444' : '#fbbf24', margin: '8px 0 4px 0' }}>
                        {totalApiCalls === 0 ? '100.00%' : `${(100 - (totalErrors / (totalApiCalls + totalErrors)) * 100).toFixed(2)}%`}
                      </h2>
                      <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)' }}>Percentage of error-free executions</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Average Latency</span>
                      {(() => {
                        let totalLat = 0;
                        let count = 0;
                        modelsArray.forEach(m => {
                          m.latencies.forEach(l => {
                            totalLat += l;
                            count += 1;
                          });
                        });
                        const avg = count === 0 ? 0 : Math.round(totalLat / count);
                        return (
                          <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#38bdf8', margin: '8px 0 4px 0' }}>
                            {avg > 1000 ? `${(avg/1000).toFixed(2)}s` : `${avg}ms`}
                          </h2>
                        );
                      })()}
                      <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)' }}>Mean response time across all keys</span>
                    </div>

                    <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '20px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                      <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontWeight: 700, textTransform: 'uppercase' }}>Call Volume (30d)</span>
                      <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--dt-text)', margin: '8px 0 4px 0' }}>
                        {totalApiCalls} calls
                      </h2>
                      <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)' }}>Completed slide compiles</span>
                    </div>
                  </div>

                  {/* SVG Latency Chart & Model Performance Breakdown */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '24px' }}>
                    
                    {/* Average Latency Chart (SVG) */}
                    <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)' }}>
                      <h4 style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--dt-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Average Latency per Model (ms)
                      </h4>
                      {(() => {
                        const chartHeight = 220;
                        const barGap = 40;
                        const startY = 30;
                        const labelWidth = 140;
                        const chartWidth = 360;

                        // Calculate average latency for each model
                        const data = modelsArray.map(m => {
                          const avg = m.latencies.length === 0 ? 0 : Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length);
                          return { name: m.name.replace('gemini-', ''), avg };
                        }).filter(d => d.avg > 0);

                        if (data.length === 0) {
                          return <div style={{ color: 'var(--dt-text-muted)', fontStyle: 'italic', fontSize: '13px' }}>No latencies logged.</div>;
                        }

                        const maxAvg = Math.max(...data.map(d => d.avg), 1000);

                        return (
                          <svg viewBox={`0 0 550 ${chartHeight}`} style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
                            {data.map((d, index) => {
                              const y = startY + index * barGap;
                              const barLength = (d.avg / maxAvg) * chartWidth;
                              
                              return (
                                <g key={d.name}>
                                  {/* Model Name */}
                                  <text x={labelWidth - 12} y={y + 12} fill="var(--dt-text)" fontSize="11px" fontWeight={700} textAnchor="end" fontFamily="monospace">
                                    {d.name}
                                  </text>
                                  {/* Bar background */}
                                  <rect x={labelWidth} y={y} width={chartWidth} height={18} fill="var(--dt-btn-bg)" rx={4} />
                                  {/* Active Bar */}
                                  <rect x={labelWidth} y={y} width={barLength} height={18} fill="var(--dt-accent-blue)" rx={4} />
                                  {/* Value */}
                                  <text x={labelWidth + barLength + 8} y={y + 13} fill="var(--dt-text-muted)" fontSize="11px" fontWeight="bold">
                                    {d.avg}ms
                                  </text>
                                </g>
                              );
                            })}
                          </svg>
                        );
                      })()}
                    </div>

                    {/* Reliability & Breakdown Table */}
                    <div style={{ backgroundColor: 'var(--dt-card-bg)', padding: '24px', borderRadius: '12px', border: '1px solid var(--dt-border)', display: 'flex', flexDirection: 'column' }}>
                      <h4 style={{ margin: '0 0 16px 0', fontSize: '13px', color: 'var(--dt-text-muted)', textTransform: 'uppercase', fontWeight: 700 }}>
                        Model Reliability Breakdown
                      </h4>
                      
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
                        {modelsArray.map(m => {
                          const total = m.calls + m.errors;
                          const errPercent = total === 0 ? 0 : Math.round((m.errors / total) * 100);
                          const isHealthy = errPercent < 5;

                          return (
                            <div key={m.name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                <span style={{ fontFamily: 'monospace', color: 'var(--dt-text)', fontWeight: 600 }}>
                                  {m.name.replace('gemini-', '')}
                                </span>
                                <span style={{ color: isHealthy ? '#10b981' : '#ef4444', fontWeight: 700 }}>
                                  {errPercent}% Error Rate
                                </span>
                              </div>
                              <div style={{ height: '6px', width: '100%', backgroundColor: 'var(--dt-btn-bg)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ height: '100%', width: `${100 - errPercent}%`, backgroundColor: isHealthy ? '#10b981' : '#ef4444', borderRadius: '3px' }} />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--dt-text-muted)' }}>
                                <span>{m.calls} successful calls</span>
                                <span>{m.errors} error incidents</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                  </div>

                </div>
              );
            })()}

          </div>
        )}

        {/* Unified Glassmorphic Help Modal */}
        {renderHelpModal({ helpTabId, setHelpTabId, copiedPrompt, setCopiedPrompt, handleCopyPrompt })}

        {/* Full-Page Template Preview Modal */}
        {activePreviewPreset && (
          <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(8px)',
            zIndex: 9998,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            boxSizing: 'border-box'
          }}>
            <div style={{
              backgroundColor: 'var(--dt-card-bg)',
              borderRadius: '16px',
              border: '1px solid var(--dt-border)',
              width: '100%',
              maxWidth: '900px',
              height: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              overflow: 'hidden'
            }}>
              {/* Modal Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '16px 24px',
                borderBottom: '1px solid var(--dt-border)',
                boxSizing: 'border-box'
              }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: 800, margin: 0, color: 'var(--dt-text)' }}>
                    {activePreviewPreset.replace(/([A-Z])/g, ' $1').trim()} — Full View
                  </h3>
                  <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', display: 'block', marginTop: '2px' }}>
                    Theme: {selectedTheme.replace(/_/g, ' ')} | Palette: {selectedPalette.replace(/_/g, ' ')}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      const iframe = document.getElementById('modal-preview-iframe');
                      if (iframe) {
                        iframe.contentWindow.focus();
                        iframe.contentWindow.print();
                      }
                    }}
                    style={{
                      backgroundColor: '#10b981',
                      color: 'white',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    🖨️ Print Layout
                  </button>
                  <button
                    onClick={() => setActivePreviewPreset(null)}
                    style={{
                      backgroundColor: 'var(--dt-btn-bg)',
                      color: 'var(--dt-text-muted)',
                      border: '1px solid var(--dt-border)',
                      padding: '8px 14px',
                      borderRadius: '8px',
                      fontSize: '13px',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    ✕ Close
                  </button>
                </div>
              </div>

              {/* Modal Body: A4 Sandbox Preview */}
              <div style={{
                flex: 1,
                overflowY: 'auto',
                padding: '32px 24px',
                display: 'flex',
                justifyContent: 'center',
                backgroundColor: '#f1f5f9'
              }}>
                <div style={{
                  width: '794px', // 210mm at 96 DPI
                  height: '1123px', // 297mm at 96 DPI
                  backgroundColor: 'white',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <iframe
                    id="modal-preview-iframe"
                    title="Takeaway A4 Compiler Full Preview"
                    src={`${BACKEND_URL}/api/templates/preview?preset=${activePreviewPreset}&theme=${selectedTheme}&palette=${selectedPalette}`}
                    style={{
                      width: '100%',
                      height: '100%',
                      border: 'none',
                      backgroundColor: 'white'
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

      </main>
      </div> {/* <-- closing workspace wrapper */}
    </div>
  );
};

// Reusable Help Modal Render Function
const renderHelpModal = ({ helpTabId, setHelpTabId, copiedPrompt, setCopiedPrompt, handleCopyPrompt }) => {
  if (!helpTabId) return null;
  const content = HELP_CONTENTS[helpTabId];
  if (!content) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(3, 7, 18, 0.75)',
      backdropFilter: 'blur(8px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{
        backgroundColor: 'var(--dt-card-bg)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '16px',
        maxWidth: '650px',
        width: '100%',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
        overflow: 'hidden'
      }}>
        {/* Modal Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px',
          borderBottom: '1px solid var(--dt-btn-bg)',
          backgroundColor: 'var(--dt-bg)'
        }}>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 800, color: 'var(--dt-text)' }}>
            {content.title}
          </h3>
          <button
            onClick={() => { setHelpTabId(null); setCopiedPrompt(false); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--dt-text-muted)',
              fontSize: '20px',
              cursor: 'pointer',
              lineHeight: '1',
              padding: '4px',
              transition: 'color 0.2s'
            }}
            onMouseEnter={(e) => e.target.style.color = 'var(--dt-text)'}
            onMouseLeave={(e) => e.target.style.color = 'var(--dt-text-muted)'}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', fontSize: '13px', lineHeight: '1.6', color: '#d1d5db' }}>
          
          {/* Step-by-Step Instructions */}
          <div>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '11px', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📖 How to Use & Step-by-Step Instructions
            </h4>
            <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {content.instructions.map((step, idx) => (
                <li key={idx} style={{ color: '#e5e7eb' }}>{step}</li>
              ))}
            </ul>
          </div>

          {/* Limitations */}
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.05)',
            borderLeft: '4px solid #ef4444',
            padding: '12px 16px',
            borderRadius: '0 8px 8px 0'
          }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 800, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              ⚠️ Tool Limitations
            </h4>
            <p style={{ margin: 0, color: '#fca5a5' }}>
              {content.limitations}
            </p>
          </div>

          {/* Actionable Insights */}
          <div style={{
            backgroundColor: 'rgba(16, 185, 129, 0.05)',
            borderLeft: '4px solid #10b981',
            padding: '12px 16px',
            borderRadius: '0 8px 8px 0'
          }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '11px', fontWeight: 800, color: '#10b981', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              💡 Actionable Insights & Next Steps
            </h4>
            <p style={{ margin: 0, color: '#a7f3d0' }}>
              {content.insights}
            </p>
          </div>

          {/* Antigravity Prompt Action */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            backgroundColor: 'var(--dt-bg)',
            border: '1px solid var(--dt-btn-bg)',
            padding: '16px',
            borderRadius: '8px'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: '11px', fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                🤖 Antigravity Assistant Prompt Action
              </h4>
              <button
                onClick={() => handleCopyPrompt(content.antigravityPrompt)}
                style={{
                  backgroundColor: copiedPrompt ? '#10b981' : 'var(--dt-btn-bg)',
                  color: 'white',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {copiedPrompt ? '✓ Copied' : '📋 Copy Prompt'}
              </button>
            </div>
            <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: 'var(--dt-text-muted)', fontStyle: 'italic', fontFamily: 'monospace', lineHeight: '1.5', borderLeft: '3px solid #60a5fa', paddingLeft: '12px' }}>
              "{content.antigravityPrompt}"
            </p>
          </div>

        </div>

        {/* Modal Footer */}
        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '16px 24px',
          borderTop: '1px solid var(--dt-btn-bg)',
          backgroundColor: 'var(--dt-bg)'
        }}>
          <button
            onClick={() => { setHelpTabId(null); setCopiedPrompt(false); }}
            style={{
              backgroundColor: 'var(--dt-btn-bg)',
              color: 'var(--dt-text)',
              border: '1px solid var(--dt-border)',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};

// Sub-component KeyRow
const KeyRow = ({ keyObj, onToggle }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [timeLeft, setTimeLeft] = useState({});

  useEffect(() => {
    if (!keyObj.modelNextCheck || !isExpanded) return;

    const calculateTimeLeft = () => {
      const newTimeLeft = {};
      Object.entries(keyObj.modelNextCheck).forEach(([modelName, nextCheckTimestamp]) => {
        const seconds = Math.max(0, Math.ceil((nextCheckTimestamp - Date.now()) / 1000));
        newTimeLeft[modelName] = seconds;
      });
      setTimeLeft(newTimeLeft);
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [keyObj.modelNextCheck, isExpanded]);

  // Determine status color and label
  let statusColor = '#64748b'; // default slate
  let statusLabel = keyObj.status;
  if (keyObj.status.startsWith('Active') || keyObj.status === 'Healthy') {
    statusColor = '#10b981'; // green
  } else if (keyObj.status.includes('Quota') || keyObj.status === 'Rate Limited') {
    statusColor = '#f59e0b'; // amber
  } else if (keyObj.status.includes('Auth') || keyObj.status === 'Invalid' || keyObj.status === 'Error') {
    statusColor = '#ef4444'; // red
  } else if (keyObj.status === 'Manually Disabled') {
    statusColor = '#64748b'; // slate
  }

  const models = keyObj.modelEnabled ? Object.keys(keyObj.modelEnabled) : [];
  const activeModelsCount = keyObj.modelEnabled ? Object.values(keyObj.modelEnabled).filter(v => v === 'active').length : 0;

  // Toggle model endpoint handler
  const handleToggleModel = async (modelName, currentStatus) => {
    try {
      const newStatus = currentStatus === 'active' ? 'manual_off' : 'active';
      const response = await fetch(`${BACKEND_URL}/api/devtools/keys/model/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': sessionStorage.getItem('devtools_token') ? `Bearer ${sessionStorage.getItem('devtools_token')}` : ''
        },
        body: JSON.stringify({ keyId: keyObj.id, modelName, enabled: newStatus === 'active' })
      });
      if (!response.ok) {
        throw new Error('Failed to toggle model');
      }
      // SSE will broadcast the key update, which updates the state automatically!
    } catch (err) {
      console.error(err);
      alert('Failed to toggle model: ' + err.message);
    }
  };

  const isPaid = keyObj.type === 'paid';
  const isKeyActive = keyObj.enabled;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: 'var(--dt-card-bg)',
      border: '1px solid var(--dt-border)',
      borderRadius: '8px',
      overflow: 'hidden',
      opacity: isKeyActive ? 1 : 0.75,
      boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
      transition: 'opacity 0.2s'
    }}>
      {/* Collapsed Parent Row */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: isPaid ? 'rgba(251, 191, 36, 0.03)' : 'transparent',
          position: 'relative',
          minHeight: '52px',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        {/* Left Status Bar */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '4px',
          backgroundColor: isPaid && isKeyActive ? '#eab308' : statusColor
        }} />

        {/* Key Type Badge */}
        <span style={{
          fontSize: '10px',
          fontWeight: 800,
          padding: '2px 6px',
          borderRadius: '4px',
          letterSpacing: '0.02em',
          backgroundColor: isPaid ? '#fef9c3' : 'var(--dt-btn-bg)',
          color: isPaid ? '#a16207' : 'var(--dt-text-muted)',
          border: isPaid ? '1px solid #fef08a' : '1px solid var(--dt-border)'
        }}>
          {isPaid ? 'PREMIUM' : 'FREE'}
        </span>

        {/* Key Label and ID */}
        <div style={{ flex: 1, minWidth: '150px' }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--dt-text)' }}>{keyObj.label}</span>
          <span style={{ fontSize: '11px', color: 'var(--dt-text-muted)', fontFamily: 'monospace', marginLeft: '8px' }}>({keyObj.id})</span>
        </div>

        {/* Status Chip */}
        <span style={{
          backgroundColor: isKeyActive ? `${statusColor}15` : 'var(--dt-btn-bg)',
          color: isKeyActive ? statusColor : 'var(--dt-text-muted)',
          fontSize: '11px',
          fontWeight: 600,
          padding: '3px 8px',
          borderRadius: '12px',
          border: isKeyActive ? `1px solid ${statusColor}30` : '1px solid var(--dt-border)',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}>
          {!isKeyActive && <span title="Manually disabled - excluded from rotations">🔒</span>}
          {statusLabel}
        </span>

        {/* Model Health Dots */}
        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }} title="Model Health">
          {models.map(m => {
            const state = keyObj.modelEnabled?.[m];
            let dotColor = '#64748b'; // slate
            if (state === 'active') dotColor = '#10b981'; // green
            else if (state === 'quota_depleted') dotColor = '#f59e0b'; // amber
            else if (state === 'manual_off') dotColor = '#94a3b8'; // light slate
            else if (state === 'unavailable') dotColor = '#ef4444'; // red
            
            return (
              <span 
                key={m}
                title={`${m.replace(/^gemini-/, '')}: ${state || 'unknown'}`}
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: dotColor,
                  display: 'inline-block'
                }}
              />
            );
          })}
        </div>

        {/* Requests & Errors */}
        <div style={{ fontSize: '12px', color: 'var(--dt-text-muted)', fontFamily: 'monospace', minWidth: '100px', textAlign: 'right' }}>
          <span>{keyObj.requestsToday || 0} req</span>
          <span style={{ marginLeft: '8px', color: (keyObj.errorsToday || 0) > 0 ? '#ef4444' : 'var(--dt-text-muted)' }}>
            {keyObj.errorsToday || 0} err
          </span>
        </div>

        {/* Toggle Switch */}
        <label 
          className="switch" 
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'relative',
            display: 'inline-block',
            width: '40px',
            height: '22px',
            cursor: 'pointer'
          }}
        >
          <input 
            type="checkbox" 
            checked={isKeyActive}
            onChange={() => onToggle(keyObj.id, isKeyActive)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span className="slider" style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: isKeyActive ? '#6366f1' : 'var(--dt-btn-bg)',
            borderRadius: '22px',
            border: '1px solid var(--dt-border)',
            transition: '0.2s'
          }}>
            <span className="knob" style={{
              position: 'absolute',
              height: '14px', width: '14px',
              left: isKeyActive ? '22px' : '3px',
              bottom: '3px',
              backgroundColor: 'white',
              borderRadius: '50%',
              transition: '0.2s'
            }} />
          </span>
        </label>

        {/* Expand Chevron */}
        <span style={{
          fontSize: '12px',
          color: 'var(--dt-text-muted)',
          display: 'flex',
          alignItems: 'center',
          marginLeft: '4px',
          transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s'
        }}>
          ▼
        </span>
      </div>

      {/* Expanded Model Details Sub-row */}
      {isExpanded && (
        <div style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--dt-border)',
          backgroundColor: 'rgba(241, 245, 249, 0.4)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <h4 style={{ fontSize: '11px', fontWeight: 600, color: 'var(--dt-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>
            Model Rotation Details
          </h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {models.map(m => {
              const state = keyObj.modelEnabled?.[m];
              const isModelEn = state === 'active';
              const nextCheck = timeLeft[m];
              
              let modelColor = '#64748b'; // slate
              if (state === 'active') modelColor = '#10b981'; // green
              else if (state === 'quota_depleted') modelColor = '#f59e0b'; // amber
              else if (state === 'manual_off') modelColor = '#94a3b8'; // light slate
              else if (state === 'unavailable') modelColor = '#ef4444'; // red

              const shortName = m.replace(/^gemini-/, '');
              const isLocked = !isKeyActive;

              return (
                <div 
                  key={m}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--dt-card-bg)',
                    border: `1px solid ${isModelEn ? '#10b98130' : 'var(--dt-border)'}`,
                    fontSize: '12px',
                    opacity: isLocked ? 0.6 : 1,
                    boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                  }}
                >
                  {/* Small Color Dot */}
                  <span style={{
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: modelColor,
                    display: 'inline-block'
                  }} />

                  {/* Model Name & Status */}
                  <span style={{ fontWeight: 600, color: 'var(--dt-text)' }}>{shortName}</span>
                  
                  <span style={{ 
                    fontSize: '10px', 
                    color: modelColor,
                    fontWeight: 500,
                    backgroundColor: `${modelColor}10`,
                    padding: '1px 4px',
                    borderRadius: '3px'
                  }}>
                    {state || 'inactive'}
                    {state === 'quota_depleted' && nextCheck !== undefined && nextCheck > 0 && ` (retry ${nextCheck}s)`}
                  </span>

                  {/* Mini Model Toggle */}
                  <label 
                    className="switch"
                    style={{
                      position: 'relative',
                      display: 'inline-block',
                      width: '28px',
                      height: '16px',
                      cursor: isLocked ? 'not-allowed' : 'pointer',
                      marginLeft: '4px'
                    }}
                  >
                    <input 
                      type="checkbox" 
                      checked={isModelEn}
                      disabled={isLocked}
                      onChange={() => handleToggleModel(m, state)}
                      style={{ opacity: 0, width: 0, height: 0 }}
                    />
                    <span className="slider" style={{
                      position: 'absolute',
                      top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: isModelEn ? '#10b981' : (state === 'manual_off' ? '#1e293b' : 'var(--dt-border)'),
                      borderRadius: '16px',
                      border: '1px solid var(--dt-border)',
                      transition: '0.2s'
                    }}>
                      <span className="knob" style={{
                        position: 'absolute',
                        height: '10px', width: '10px',
                        left: isModelEn ? '14px' : '2px',
                        bottom: '2px',
                        backgroundColor: 'white',
                        borderRadius: '50%',
                        transition: '0.2s'
                      }} />
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};


// Unified Help Modal Metadata Config
const HELP_CONTENTS = {
  dashboard: {
    title: "📊 Dashboard Health Overview",
    instructions: [
      "Monitors system-wide active models, key rotations, and server response health.",
      "Check CPU, Memory, and Active Key Pools in real-time."
    ],
    limitations: "Shows active status only; historical uptimes are not tracked in the current session.",
    insights: "If the keys or active servers drop below safe levels, the application will experience fallback chain delays.",
    antigravityPrompt: "Antigravity, please review the server.js file and analyze if there are any potential memory leaks or optimization opportunities in the key rotation logic, and suggest improvements."
  },
  logs: {
    title: "📜 API Logs Diagnostic Portal",
    instructions: [
      "Dual-view timeline: Chronological vs. Session-Grouped.",
      "Expand entries to inspect full JSON payload details and error traces.",
      "Filter logs by session IDs or search query strings."
    ],
    limitations: "Detailed logs are pruned automatically after a 3-day retention period to save space.",
    insights: "Look for frequent 429 (Rate Limit) or 500 (Internal Server Error) status codes to identify failing keys or model timeouts.",
    antigravityPrompt: "Antigravity, here are some failed API log payloads and error messages: [Paste Logs]. Please debug the root cause of these errors, fix any parsing bugs, and provide the corrected code."
  },
  keys: {
    title: "🔑 Key Management & Rotation Pool",
    instructions: [
      "Manage all Gemini API keys (Paid Key and rotating Free Keys).",
      "Toggle keys on/off to manually force rotation or isolate problems.",
      "Trigger global health checks to test quotas and validate key integrity."
    ],
    limitations: "Free keys are subject to strict rate limits (typically 15 RPM). Paid keys support context caching.",
    insights: "Disable keys showing high error rates (Quota Exceeded 429) so the server bypasses them instantly instead of waiting for retry timeouts.",
    antigravityPrompt: "Antigravity, please help me integrate a new API key into my local config or write a script to automatically test the throughput of all enabled keys in the pool."
  },
  cost: {
    title: "💵 Cost & Usage Intelligence",
    instructions: [
      "Track monthly spend and caching discounts in real-time.",
      "View cost trends in USD or INR with automatic exchange rate conversion.",
      "Examine cost breakdown by model and inspect collapsible session timelines."
    ],
    limitations: "Calculations are estimates based on standard API token pricing.",
    insights: "Identify high-cost sessions and consider shifting intensive sub-tasks (like draft expansion) to cheaper models.",
    antigravityPrompt: "Antigravity, based on my cost analytics, I want to reduce token spend. Let's analyze the prompts in server.js and optimize them to reduce input token size, or shift some sub-tasks to flash-lite."
  },
  template: {
    title: "🎨 Template Explorer & Presets",
    instructions: [
      "Explore pre-defined presentation layouts, color palettes, and themes.",
      "Preview visual layouts and page structures before generation."
    ],
    limitations: "Templates are static configuration files; custom additions must be defined in the backend.",
    insights: "Use the Explorer to align design themes (e.g. corporate navy) with generation styles for consistent visual decks.",
    antigravityPrompt: "Antigravity, please look at the template presets and create a new custom slide theme called 'Cyberpunk Gold' with high-contrast dark-mode colors and premium typography."
  },
  caches: {
    title: "💾 Context Cache Manager",
    instructions: [
      "View active context caches stored on the Paid Key.",
      "Monitor cache sizes (tokens), TTL, and live hit efficiency ratios.",
      "Purge/Delete unused caches manually to terminate storage lease charges instantly."
    ],
    limitations: "Context Caching is only available on the 'Gemini Paid Key'. Minimum cache size is 32k tokens for Gemini 1.5/3.x models.",
    insights: "Caches with 0 hits represent wasted storage cost. Ensure frequently repeated prompts use the exact same topic and structure to hit the cache.",
    antigravityPrompt: "Antigravity, I want to optimize my context caching strategy. Please modify server.js to adjust the default cache TTL, or group consecutive requests to maximize cache hits."
  },
  playground: {
    title: "🛝 Prompt Playground",
    instructions: [
      "A developer sandbox to write system instructions and prompts.",
      "Select models and adjust temperatures to test response quality and output length.",
      "Analyze precise latency and token usage metrics before deploying code."
    ],
    limitations: "Playground runs bypass the sub-task fallback chain to test specific models directly.",
    insights: "Use lower temperatures (e.g. 0.2) for predictable, structured JSON outputs, and higher temperatures (e.g. 0.8) for creative storytelling.",
    antigravityPrompt: "Antigravity, I have perfected a prompt in the playground: '[Paste Prompt]'. Please integrate this prompt into the corresponding generation sub-task in server.js."
  },
  abtest: {
    title: "⚖️ Takeaway A/B Layout Tester",
    instructions: [
      "Compare two different models, temperatures, or system instructions side-by-side.",
      "Input a single prompt/text, compile, and render the resulting HTML slides in isolated sandboxes.",
      "Evaluate styling compliance, page-splits, and visual aesthetics simultaneously."
    ],
    limitations: "Both compile requests run concurrently; this may hit rate limits if using the same key.",
    insights: "Compare a Pro model against a Flash model to see if the visual difference justifies the 10x cost premium.",
    antigravityPrompt: "Antigravity, I have run an A/B layout test and I prefer the output of Variant [A/B]. Here is the compiled HTML: [Paste HTML]. Please extract its CSS styles and set them as the default print template in my codebase."
  },
  analytics: {
    title: "📈 Performance & Reliability Analytics",
    instructions: [
      "View aggregated performance metrics across all models.",
      "Plot average latencies in milliseconds to detect slow response times.",
      "Track call volumes and error-rate percentages to diagnose stability issues."
    ],
    limitations: "Metrics are compiled from the 30-day session logs database.",
    insights: "If a specific model shows a high latency or error rate (429s), update the fallback chain in server.js to prioritize more responsive models.",
    antigravityPrompt: "Antigravity, my performance analytics show that [Model Name] is experiencing high latencies and rate limits. Please modify the model fallback order in server.js to use a faster alternative."
  }
};

export default DevToolsScreen;
