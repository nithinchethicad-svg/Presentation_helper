// Static Option Lists



const DETAIL_OPTIONS = [
  { value: 'Brief',         label: 'Brief',         desc: 'High-impact highlights only' },
  { value: 'Moderate',      label: 'Moderate',      desc: 'Balanced & standard summary' },
  { value: 'Comprehensive', label: 'Comprehensive', desc: 'Exhaustive deep breakdown' },
];

const AUDIENCE_OPTIONS = [
  { value: 'Executives & Stakeholders',          label: 'Executives & Stakeholders' },
  { value: 'General Public / Novices',           label: 'General Public / Novices' },
  { value: 'Technical Experts & Engineers',      label: 'Technical Experts & Engineers' },
  { value: 'High School Students / Teenagers',   label: 'High School Students / Teenagers' },
  { value: 'Young Adults (18–30)',               label: 'Young Adults (18–30)' },
  { value: 'Working Professionals & Managers',   label: 'Working Professionals & Managers' },
  { value: 'Faith Community & Congregation',     label: 'Faith Community & Congregation' },
  { value: 'Investors & Financial Stakeholders', label: 'Investors & Financial Stakeholders' },
  { value: 'Mixed / General Audience',           label: 'Mixed / General Audience' },
];

const SETTING_OPTIONS = [
  { value: 'School / Academic',        label: 'School / Academic' },
  { value: 'Office / Workplace',       label: 'Office / Workplace' },
  { value: 'Business Meeting',         label: 'Business Meeting' },
  { value: 'Financial Investment',     label: 'Financial Investment' },
  { value: 'Church / Ministry',        label: 'Church / Ministry' },
  { value: 'Workshop / Training',      label: 'Workshop / Training' },
  { value: 'Conference / Summit',      label: 'Conference / Summit' },
  { value: 'Community Social',         label: 'Community Social' },
  { value: 'Other',                    label: 'Other (specify below)' },
];

const COLOR_SCHEMES = [
  { value: 'Corporate Navy',    label: 'Corporate Navy',    desc: 'Deep navy & royal blue',      previewClass: 'preview-corporate-navy' },
  { value: 'Warm Forest',       label: 'Warm Forest',       desc: 'Forest green & moss emerald', previewClass: 'preview-warm-forest' },
  { value: 'Electric Purple',   label: 'Electric Purple',   desc: 'Royal purple & indigo neon',  previewClass: 'preview-electric-purple' },
  { value: 'Sunset Amber',      label: 'Sunset Amber',      desc: 'Terracotta rust & warm orange',previewClass: 'preview-sunset-amber' },
  { value: 'Elegant Charcoal',  label: 'Elegant Charcoal',  desc: 'Charcoal gray & antique gold', previewClass: 'preview-elegant-charcoal' },
  { value: 'Midnight Teal',     label: 'Midnight Teal',     desc: 'Deep ocean teal & fresh mint', previewClass: 'preview-midnight-teal' },
  { value: 'Crimson Gold',      label: 'Crimson Gold',      desc: 'Deep crimson & amber gold',   previewClass: 'preview-crimson-gold' },
  { value: 'Nordic Sage',       label: 'Nordic Sage',       desc: 'Earthy sage green & eucalyptus',previewClass: 'preview-nordic-sage' },
  { value: 'Cyberpunk Neon',    label: 'Cyberpunk Neon',    desc: 'Matte dark carbon & hot pink', previewClass: 'preview-cyberpunk-neon' },
  { value: 'Vintage Cream',     label: 'Vintage Cream',     desc: 'Warm vanilla sepia & ivory',  previewClass: 'preview-vintage-cream' },
];

const VIBE_THEMES = [
  {
    value: 'Warm & Encouraging',
    label: 'Warm & Encouraging',
    icon: '🌸',
    desc: 'Soft, friendly, and supportive',
    accent: '#f97316',
  },
  {
    value: 'Formal & Professional',
    label: 'Formal & Professional',
    icon: '🏛️',
    desc: 'Sharp, precise, and corporate',
    accent: '#334155',
  },
  {
    value: 'Fun & Energetic',
    label: 'Fun & Energetic',
    icon: '⚡',
    desc: 'Bold, playful, and electric',
    accent: '#ec4899',
  },
  {
    value: 'Reflective & Thoughtful',
    label: 'Reflective & Thoughtful',
    icon: '🌿',
    desc: 'Calm, minimal, and contemplative',
    accent: '#059669',
  },
  {
    value: 'Educational & Informative',
    label: 'Educational & Informative',
    icon: '📚',
    desc: 'Structured, clear, and systematic',
    accent: '#2563eb',
  },
  {
    value: 'Motivational & Inspiring',
    label: 'Motivational & Inspiring',
    icon: '🚀',
    desc: 'Dynamic, bold, and forward-moving',
    accent: '#7c3aed',
  },
];

// ─── AI Extract Toggle Hook ───────────────────────────────────────────────────

/**
 * A labelled text input paired with an "AI extract" toggle button.
 * - When the toggle is ON  → hides the input, shows a green badge.
 * - When the toggle is OFF → shows the input and restores whatever the user had typed.
 */
const ExtractableField = ({ label, fieldKey, value, extractKey, extractValue, onChangeText, onToggleExtract, placeholder, type = 'text' }) => {
  const isActive = extractValue;

  return (
    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
      {/* Label row with toggle button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <label className="form-label" style={{ margin: 0 }}>{label}</label>
        <button
          type="button"
          onClick={() => onToggleExtract(extractKey)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.65rem',
            borderRadius: '20px',
            border: isActive ? '1.5px solid #059669' : '1.5px solid #cbd5e1',
            background: isActive ? '#ecfdf5' : '#f8fafc',
            color: isActive ? '#065f46' : '#64748b',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.2s',
            whiteSpace: 'nowrap',
          }}
        >
          {isActive ? '✓' : '✨'} Let AI extract from files
        </button>
      </div>

      {/* Conditionally render input OR badge */}
      {isActive ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.65rem 1rem',
          background: '#ecfdf5',
          border: '1px solid #6ee7b7',
          borderRadius: '10px',
          color: '#065f46',
          fontSize: '0.875rem',
          fontWeight: 500,
        }}>
          <span>✨</span>
          <span>AI will auto-extract this from your uploaded material</span>
        </div>
      ) : (
        type === 'textarea' ? (
          <textarea
            className="form-input"
            placeholder={placeholder}
            value={value}
            onChange={e => onChangeText(fieldKey, e.target.value)}
            rows={3}
            style={{ resize: 'vertical' }}
          />
        ) : (
          <input
            type="text"
            className="form-input"
            placeholder={placeholder}
            value={value}
            onChange={e => onChangeText(fieldKey, e.target.value)}
          />
        )
      )}
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

const QuestionnaireScreen = ({ preferences, setPreferences, onBack, onGenerate }) => {

  const handleChange = (field, value) => {
    setPreferences(prev => ({ ...prev, [field]: value }));
  };

  // Toggle extract boolean; preserve previous text value via preferences state
  const handleToggleExtract = (extractKey) => {
    setPreferences(prev => ({ ...prev, [extractKey]: !prev[extractKey] }));
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    onGenerate();
  };

  return (
    <div className="animate-fade-in">
      {/* Header Bar */}
      <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={onBack}>
          <img 
            src="/ai_slidekick_logo.png?v=3" 
            alt="AI Slidekick" 
            style={{ height: '32px', width: 'auto', objectFit: 'contain' }} 
          />
          <div style={{ borderLeft: '1px solid var(--border-light)', height: '24px', margin: '0 8px' }} />
          <img 
            src="/takeaway_notes_generator_logo.png" 
            alt="AI Takeaway Notes Generator" 
            style={{ height: '32px', objectFit: 'contain' }} 
          />
        </div>
      </header>

      {/* Page heading */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontFamily: 'var(--font-headings)', fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
          Customize Your Output Takeaways
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
          Adjust layout preferences, tone, and design styles. The AI Designer will format the output document accordingly.
        </p>
      </div>

      <form onSubmit={handleFormSubmit}>
        <div className="dashboard-grid">

          {/* ── LEFT COLUMN ── */}
          <div className="dashboard-left" style={{ gap: '1.25rem' }}>

            {/* Card 1: Content & Layout Structure */}
            <div className="card" style={{ width: '100%', marginBottom: 0, padding: '1.5rem' }}>
              <h3 style={cardHeadingStyle}>Content & Layout Structure</h3>

              {/* Detail Level */}
              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label className="form-label">Level of Detail</label>
                <p className="form-subtitle">How thorough should the takeaway notes be?</p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {DETAIL_OPTIONS.map(opt => (
                    <div
                      key={opt.value}
                      onClick={() => handleChange('detailLevel', opt.value)}
                      style={{
                        flex: '1 1 0',
                        minWidth: '100px',
                        padding: '0.75rem 1rem',
                        borderRadius: '10px',
                        border: preferences.detailLevel === opt.value ? '2px solid var(--primary)' : '1px solid var(--border-light)',
                        background: preferences.detailLevel === opt.value ? 'var(--primary-light)' : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        textAlign: 'center',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: preferences.detailLevel === opt.value ? 'var(--primary-hover)' : '#0f172a' }}>{opt.label}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>{opt.desc}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Content Fidelity Constraints */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Content Fidelity Constraints</label>
                <p className="form-subtitle">Control how closely the AI summarized text adheres to your source material.</p>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.85rem 1rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border-light)',
                  background: '#f8fafc',
                  gap: '1rem'
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', marginBottom: '0.15rem' }}>Strict File Content Limit</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.35 }}>
                      Summarize ONLY information explicitly stated in your uploaded documents. Outside definitions, history, or background details will not be added.
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}>
                      <input
                        type="checkbox"
                        checked={preferences.strictFileContentOnly || false}
                        onChange={e => handleChange('strictFileContentOnly', e.target.checked)}
                        style={{ display: 'none' }}
                      />
                      <div style={{
                        width: '42px',
                        height: '24px',
                        borderRadius: '12px',
                        background: preferences.strictFileContentOnly ? '#059669' : '#cbd5e1',
                        position: 'relative',
                        transition: 'background 0.2s',
                        padding: '2px',
                        boxSizing: 'border-box'
                      }}>
                        <div style={{
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%',
                          background: 'white',
                          position: 'absolute',
                          left: preferences.strictFileContentOnly ? '20px' : '2px',
                          transition: 'left 0.2s',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                        }} />
                      </div>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* Card 2: Audience & Context */}
            <div className="card" style={{ width: '100%', marginBottom: 0, padding: '1.5rem' }}>
              <h3 style={cardHeadingStyle}>Audience & Context</h3>

              <div className="form-grid">
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Primary Audience</label>
                  <select className="form-select" value={preferences.targetAudience} onChange={e => handleChange('targetAudience', e.target.value)}>
                    {AUDIENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Setting / Context</label>
                  <select className="form-select" value={preferences.setting} onChange={e => handleChange('setting', e.target.value)}>
                    {SETTING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>

              {/* Custom setting textbox (only when 'Other' selected) */}
              {preferences.setting === 'Other' && (
                <div className="form-group" style={{ marginBottom: 0, marginTop: '0.25rem' }}>
                  <label className="form-label">Describe your setting</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Community fundraising gala, Youth retreat, Tech hackathon…"
                    value={preferences.customSetting}
                    onChange={e => handleChange('customSetting', e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Card 3: Event & Branding Details */}
            <div className="card" style={{ width: '100%', marginBottom: 0, padding: '1.5rem' }}>
              <h3 style={cardHeadingStyle}>Event & Branding Details</h3>
              <p className="form-subtitle" style={{ marginBottom: '1.25rem' }}>
                Fill in the fields below or let the AI Designer extract the information directly from your uploaded files.
              </p>

              <ExtractableField
                label="Event / Session Name"
                fieldKey="eventName"
                value={preferences.eventName}
                extractKey="extractEventName"
                extractValue={preferences.extractEventName}
                onChangeText={handleChange}
                onToggleExtract={handleToggleExtract}
                placeholder="e.g. Annual Leadership Summit 2025"
              />

              <ExtractableField
                label="Date & Time"
                fieldKey="eventDate"
                value={preferences.eventDate}
                extractKey="extractEventDate"
                extractValue={preferences.extractEventDate}
                onChangeText={handleChange}
                onToggleExtract={handleToggleExtract}
                placeholder="e.g. 20 June 2025, 9:00 AM – 5:00 PM"
              />

              <ExtractableField
                label="Who / What Should Appear on the Cover?"
                fieldKey="coverInfo"
                value={preferences.coverInfo}
                extractKey="extractCoverInfo"
                extractValue={preferences.extractCoverInfo}
                onChangeText={handleChange}
                onToggleExtract={handleToggleExtract}
                placeholder="e.g. Speaker name, organisation logo, event host"
              />

              {/* Content Priorities */}
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label">Content Priorities & Key Highlights</label>
                <p className="form-subtitle">Specify what to focus on and any key points to emphasise (e.g. vocab definitions, formulas, action steps, timelines).</p>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. Core formulas, vocab terms, code blocks, timelines"
                  value={preferences.contentPriorities}
                  onChange={e => handleChange('contentPriorities', e.target.value)}
                  required
                />
              </div>

              {/* Additional Instructions (no AI extract button) */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Optional Additional Instructions</label>
                <textarea
                  className="form-input"
                  placeholder="Any other special instructions for the AI Designer…"
                  value={preferences.additionalInstructions}
                  onChange={e => handleChange('additionalInstructions', e.target.value)}
                  rows={3}
                  style={{ resize: 'vertical' }}
                />
              </div>
            </div>

          </div>{/* end dashboard-left */}

          {/* ── RIGHT COLUMN ── */}
          <div className="dashboard-right">

            {/* Card 4: Colour Palette */}
            <div className="card" style={{ marginBottom: 0, padding: '1.5rem', width: '100%' }}>
              <h3 style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, fontSize: '1.1rem', color: '#0f172a', marginBottom: '0.25rem' }}>
                Colour Palette
              </h3>
              <p className="form-subtitle" style={{ marginBottom: '1.25rem' }}>
                Select a visual theme. The AI Designer will use these colours to style the A4 document.
              </p>

              <div className="theme-card-grid">
                {COLOR_SCHEMES.map(scheme => (
                  <div
                    key={scheme.value}
                    className={`theme-card ${preferences.colorScheme === scheme.value ? 'selected' : ''}`}
                    onClick={() => handleChange('colorScheme', scheme.value)}
                  >
                    <div className={`theme-gradient-bar ${scheme.previewClass}`} />
                    <div>
                      <div className="theme-title">{scheme.label}</div>
                      <div className="theme-desc">{scheme.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Card 5: Writing Vibe & Theme */}
            <div className="card" style={{ marginBottom: 0, padding: '1.5rem', width: '100%' }}>
              <h3 style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, fontSize: '1.1rem', color: '#0f172a', marginBottom: '0.25rem' }}>
                Writing Vibe & Theme
              </h3>
              <p className="form-subtitle" style={{ marginBottom: '1.25rem' }}>
                The AI Designer will match typography, shapes, and infographic style to the selected vibe.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                {VIBE_THEMES.map(vibe => {
                  const isSelected = preferences.writingTheme === vibe.value;
                  return (
                    <div
                      key={vibe.value}
                      onClick={() => handleChange('writingTheme', vibe.value)}
                      style={{
                        padding: '0.875rem 1rem',
                        borderRadius: '12px',
                        border: isSelected ? `2px solid ${vibe.accent}` : '1px solid var(--border-light)',
                        background: isSelected ? `${vibe.accent}12` : 'white',
                        cursor: 'pointer',
                        transition: 'all 0.18s',
                        userSelect: 'none',
                      }}
                    >
                      <div style={{ fontSize: '1.4rem', marginBottom: '0.3rem' }}>{vibe.icon}</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: isSelected ? vibe.accent : '#0f172a', lineHeight: 1.2 }}>{vibe.label}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.2rem', lineHeight: 1.3 }}>{vibe.desc}</div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>{/* end dashboard-right */}

        </div>{/* end dashboard-grid */}

        {/* Footer Actions */}
        <div className="actions-row">
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M15.41 16.59L10.83 12L15.41 7.41L14 6L8 12L14 18L15.41 16.59Z" fill="currentColor"/>
            </svg>
            Back to Uploads
          </button>

          <button type="submit" className="btn btn-primary">
            Generate Takeaway Notes
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.58L9 16.17Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
};

// ─── Shared style helper ──────────────────────────────────────────────────────
const cardHeadingStyle = {
  fontFamily: 'var(--font-headings)',
  fontWeight: 700,
  fontSize: '1.1rem',
  color: '#0f172a',
  marginBottom: '1rem',
  borderBottom: '1px solid #f1f5f9',
  paddingBottom: '0.5rem',
};

export default QuestionnaireScreen;
