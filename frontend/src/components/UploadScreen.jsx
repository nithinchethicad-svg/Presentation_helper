import { useState } from 'react';

const UploadScreen = ({ 
  speakerNotes, 
  setSpeakerNotes, 
  presentationSlides, 
  setPresentationSlides, 
  onNext,
  onBack
}) => {
  const [dragOverSpeaker, setDragOverSpeaker] = useState(false);
  const [dragOverSlides, setDragOverSlides] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Handle file drop for Speaker Notes
  const handleDropSpeaker = (e) => {
    e.preventDefault();
    setDragOverSpeaker(false);
    setErrorMsg('');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processSpeakerFile(files[0]);
    }
  };

  // Handle file drop for Presentation Slides
  const handleDropSlides = (e) => {
    e.preventDefault();
    setDragOverSlides(false);
    setErrorMsg('');
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      processSlidesFile(files[0]);
    }
  };

  // Process Speaker Notes file (.docx)
  const processSpeakerFile = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'docx') {
      setErrorMsg('Speaker Notes must be a .docx file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setErrorMsg('File size must be under 50MB.');
      return;
    }
    setSpeakerNotes(file);
  };

  // Process Presentation Slides file (.pptx)
  const processSlidesFile = (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'pptx') {
      setErrorMsg('Presentation Slides must be a .pptx file.');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setErrorMsg('File size must be under 50MB.');
      return;
    }
    setPresentationSlides(file);
  };

  return (
    <div className="animate-fade-in">
      {/* Header Bar */}
      <header className="app-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {onBack && (
            <button 
              onClick={onBack}
              className="btn-secondary"
              style={{ padding: '0.5rem 0.85rem', borderRadius: '10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem', border: '1px solid var(--border-light)', background: 'white', cursor: 'pointer' }}
            >
              ← Home
            </button>
          )}
          <img 
            src="/takeaway_notes_generator_logo.png" 
            alt="AI Takeaway Notes Generator" 
            style={{ height: '52px', objectFit: 'contain' }} 
          />
        </div>
      </header>

      {/* Error Message */}
      {errorMsg && (
        <div className="error-alert">
          <span className="error-title">Upload Error</span>
          <span className="error-desc">{errorMsg}</span>
        </div>
      )}

      {/* Split Dashboard Grid */}
      <div className="dashboard-grid">
        
        {/* Left Column: Hero Description */}
        <div className="dashboard-left">
          <div className="hero-badge">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '4px' }}>
              <path d="M12 2L2 22H22L12 2ZM12 6L18.8 19.5H5.2L12 6ZM13 16H11V18H13V16ZM13 10H11V14H13V10Z" fill="currentColor"/>
            </svg>
            Premium Publishing Engine
          </div>
          <h1 className="hero-title">
            Turn Presentation <br />
            Material <span className="purple-gradient">into Elegant</span> <br />
            <span className="blue-gradient">Audience Summaries</span>
          </h1>
          <p className="hero-description">
            Upload speaker notes or presentation slides. Our advanced design engine 
            will analyze, clean, and restructure them into <strong>beautiful, printable takeaways</strong>. 
            Perfect for workshops, corporate keynotes, or classroom curriculum.
          </p>

          <h4 style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, marginBottom: '0.75rem', color: '#0f172a' }}>
            What you can generate:
          </h4>
          <ul className="feature-list">
            <li className="feature-item">
              <span className="feature-check">✓</span> High-impact bulleted core highlights
            </li>
            <li className="feature-item">
              <span className="feature-check">✓</span> Structured Q&A training formats
            </li>
            <li className="feature-item">
              <span className="feature-check">✓</span> Comprehensive executive briefing summaries
            </li>
            <li className="feature-item">
              <span className="feature-check">✓</span> Professional print-ready PDFs using your selected color palettes
            </li>
          </ul>
        </div>

        {/* Right Column: Upload Zones */}
        <div className="dashboard-right">
          <div className="card" style={{ marginBottom: 0, padding: '1.25rem' }}>
            <h3 style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, fontSize: '1.3rem', color: '#0f172a', marginBottom: '1rem' }}>
              Upload Source Files
            </h3>
            
            {/* Upload Box 1: Speaker Notes */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '12px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div className="upload-icon-wrapper icon-purple" style={{ width: '38px', height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'white' }}>
                    <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2ZM18 20H6V4H13V9H18V20Z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>Speaker Notes</h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>DOCX documents containing raw session notes.</p>
                </div>
              </div>
              
              <div 
                className={`drop-zone purple-border ${dragOverSpeaker ? 'drag-over' : ''}`}
                style={{ width: '100%', minHeight: '65px', height: '8vh', maxHeight: '100px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0.25rem' }}
                onDragOver={(e) => { e.preventDefault(); setDragOverSpeaker(true); }}
                onDragLeave={() => setDragOverSpeaker(false)}
                onDrop={handleDropSpeaker}
                onClick={() => document.getElementById('speaker-input').click()}
              >
                <input 
                  id="speaker-input" 
                  type="file" 
                  accept=".docx" 
                  style={{ display: 'none' }} 
                  onChange={(e) => {
                    if (e.target.files.length > 0) processSpeakerFile(e.target.files[0]);
                  }}
                />
                {speakerNotes ? (
                  <>
                    <svg className="drop-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: 'var(--success)', marginBottom: '2px'}}>
                      <path d="M9 16.2L4.8 12L3.4 13.4L9 19L21 7L19.6 5.6L9 16.2Z" fill="currentColor"/>
                    </svg>
                    <span className="drop-label" style={{color: 'var(--success)', fontWeight: 600, fontSize: '0.75rem'}}>File Loaded Successfully</span>
                    <span className="drop-sublabel" style={{maxWidth: '90%', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '0.65rem'}}>{speakerNotes.name}</span>
                  </>
                ) : (
                  <>
                    <svg className="drop-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'var(--text-light)', marginBottom: '2px' }}>
                      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04ZM19 18H6C3.79 18 2 16.21 2 14C2 11.95 3.53 10.24 5.56 10.03L6.63 9.92L7.13 8.97C8.08 7.14 9.94 6 12 6C14.62 6 16.88 7.86 17.39 10.43L17.69 11.93L19.22 12.04C20.78 12.14 22 13.45 22 15C22 16.65 20.65 18 19 18ZM13 13V16H11V13H8L12 9L16 13H13Z" fill="currentColor"/>
                    </svg>
                    <span className="drop-label" style={{ fontWeight: 600, fontSize: '0.75rem' }}>Click or drag & drop to upload</span>
                    <span className="drop-sublabel" style={{ fontSize: '0.65rem' }}>DOCX File (Max 50MB)</span>
                  </>
                )}
              </div>
            </div>

            {/* Upload Box 2: Slides */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', padding: '1rem', borderRadius: '12px', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '0.75rem' }}>
                <div className="upload-icon-wrapper icon-blue" style={{ width: '38px', height: '38px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ color: 'white' }}>
                    <path d="M21 4H3C1.9 4 1 4.9 1 6V18C1 19.1 1.9 20 3 20H21C22.1 20 23 19.1 23 18V6C23 4.9 22.1 4 21 4ZM21 18H3V6H21V18ZM10 16L16 12L10 8V16Z" fill="currentColor"/>
                  </svg>
                </div>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>Presentation Slides</h4>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>PowerPoint slide structures organizing your presentation.</p>
                </div>
              </div>
              
              <div 
                className={`drop-zone blue-border ${dragOverSlides ? 'drag-over' : ''}`}
                style={{ width: '100%', minHeight: '65px', height: '8vh', maxHeight: '100px', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0.25rem' }}
                onDragOver={(e) => { e.preventDefault(); setDragOverSlides(true); }}
                onDragLeave={() => setDragOverSlides(false)}
                onDrop={handleDropSlides}
                onClick={() => document.getElementById('slides-input').click()}
              >
                <input 
                  id="slides-input" 
                  type="file" 
                  accept=".pptx" 
                  style={{ display: 'none' }} 
                  onChange={(e) => {
                    if (e.target.files.length > 0) processSlidesFile(e.target.files[0]);
                  }}
                />
                {presentationSlides ? (
                  <>
                    <svg className="drop-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{color: 'var(--success)', marginBottom: '2px'}}>
                      <path d="M9 16.2L4.8 12L3.4 13.4L9 19L21 7L19.6 5.6L9 16.2Z" fill="currentColor"/>
                    </svg>
                    <span className="drop-label" style={{color: 'var(--success)', fontWeight: 600, fontSize: '0.75rem'}}>File Loaded Successfully</span>
                    <span className="drop-sublabel" style={{maxWidth: '90%', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '0.65rem'}}>{presentationSlides.name}</span>
                  </>
                ) : (
                  <>
                    <svg className="drop-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginBottom: '2px' }}>
                      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4C9.11 4 6.6 5.64 5.35 8.04C2.34 8.36 0 10.91 0 14C0 17.31 2.69 20 6 20H19C21.76 20 24 17.76 24 15C24 12.36 21.95 10.22 19.35 10.04ZM19 18H6C3.79 18 2 16.21 2 14C2 11.95 3.53 10.24 5.56 10.03L6.63 9.92L7.13 8.97C8.08 7.14 9.94 6 12 6C14.62 6 16.88 7.86 17.39 10.43L17.69 11.93L19.22 12.04C20.78 12.14 22 13.45 22 15C22 16.65 20.65 18 19 18ZM13 13V16H11V13H8L12 9L16 13H13Z" fill="currentColor"/>
                    </svg>
                    <span className="drop-label" style={{ fontWeight: 600, fontSize: '0.75rem' }}>Click or drag & drop to upload</span>
                    <span className="drop-sublabel" style={{ fontSize: '0.65rem' }}>PPTX File (Max 50MB)</span>
                  </>
                )}
              </div>
            </div>

            {/* Uploaded Files Status Bar */}
            {(speakerNotes || presentationSlides) && (
              <div className="files-status-bar animate-fade-in" style={{ marginTop: '0.75rem', border: '1px solid #e2e8f0', background: '#f8fafc', padding: '0.75rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
                <div className="status-left" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span className="check-icon" style={{ width: '16px', height: '16px', fontSize: '0.65rem' }}>✓</span>
                  <div>
                    <p style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.8rem', margin: 0 }}>
                      Files loaded and secured.
                    </p>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '2px 0' }}>
                  {speakerNotes && (
                    <span style={{ fontSize: '0.7rem', background: '#e0e7ff', color: '#4f46e5', padding: '4px 8px', borderRadius: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%' }} title={speakerNotes.name}>
                      Notes: {speakerNotes.name}
                    </span>
                  )}
                  {presentationSlides && (
                    <span style={{ fontSize: '0.7rem', background: '#dbeafe', color: '#1d4ed8', padding: '4px 8px', borderRadius: '4px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '100%' }} title={presentationSlides.name}>
                      Slides: {presentationSlides.name}
                    </span>
                  )}
                </div>
                <button className="btn btn-primary" onClick={onNext} style={{ width: '100%', fontSize: '0.8rem', padding: '0.6rem 1rem' }}>
                  Process Files
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginLeft: '4px' }}>
                    <path d="M8.59 16.59L13.17 12L8.59 7.41L10 6L16 12L10 18L8.59 16.59Z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            )}
            
          </div>
        </div>
        
      </div>
    </div>
  );
};

export default UploadScreen;
