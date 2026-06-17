const HomeScreen = ({ onNavigate }) => {
  return (
    <div className="animate-fade-in home-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', padding: 'clamp(0.5rem, 2vh, 1.5rem) 0', minHeight: '0' }}>
      
      {/* Header Bar */}
      <header className="app-header" style={{ justifyContent: 'center', alignItems: 'center', marginBottom: 'clamp(1rem, 3.5vh, 2rem)' }}>
        <img 
          src="/presentation_assistant_logo.png" 
          alt="AI Presentation Assistant" 
          style={{ height: 'clamp(120px, 18vh, 170px)', objectFit: 'contain' }} 
        />
      </header>

      {/* Hero Intro */}
      <div style={{ textAlign: 'center', maxWidth: '750px', margin: '0 auto clamp(0.75rem, 2.5vh, 1.75rem) auto', padding: '0 1rem' }}>
        <div className="hero-badge" style={{ margin: '0 auto clamp(0.5rem, 1.5vh, 0.85rem) auto', padding: '0.3rem 0.6rem', fontSize: 'clamp(0.7rem, 1.2vw, 0.75rem)' }}>
          ✨ The Ultimate Presentation Workflow
        </div>
        <h1 style={{ fontFamily: 'var(--font-headings)', fontSize: 'clamp(1.5rem, 4vw, 2.4rem)', fontWeight: 800, color: '#0f172a', lineHeight: 1.15, marginBottom: 'clamp(0.5rem, 1.5vh, 0.75rem)', letterSpacing: '-0.02em' }}>
          Supercharge Your <span className="purple-gradient">Presentations</span> with AI
        </h1>
        <p style={{ fontSize: 'clamp(0.85rem, 1.5vw, 1rem)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Brainstorm engaging speaker notes, build slide outlines, and publish print-ready takeaways. 
          Select a capability below to begin your creation journey.
        </p>
      </div>

      {/* 3-Card Dashboard Grid */}
      <div className="home-grid" style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: 'clamp(1rem, 2vh, 1.5rem)',
        maxWidth: '1100px',
        margin: '0 auto',
        width: '100%',
        padding: '0 1rem clamp(1rem, 2vh, 1.5rem) 1rem'
      }}>
        
        {/* Card 1: Speaker Notes */}
        <div 
          onClick={() => onNavigate('speaker-notes')}
          className="home-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: '16px',
            padding: 'clamp(1rem, 2.5vh, 1.5rem) clamp(1rem, 2vw, 1.25rem)',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: 'var(--shadow-md)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: 'clamp(220px, 32vh, 290px)'
          }}
        >
          <div>
            <img 
              src="/speaker_notes_generator_logo.png" 
              alt="AI Speaker Notes Generator" 
              style={{ height: 'clamp(85px, 13vh, 115px)', objectFit: 'contain', marginBottom: 'clamp(0.5rem, 1.5vh, 1rem)', alignSelf: 'flex-start' }} 
            />
            <p style={{ fontSize: 'clamp(0.8rem, 1.8vh, 0.875rem)', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 'clamp(0.75rem, 2vh, 1.25rem)' }}>
              Collaborate section-by-section with Gemini. Answer specific prompts to generate structured A4 speaker notes, organize a table of contents, and review ideas in real-time.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--primary)', fontSize: '0.9rem' }}>
            <span>Launch workspace</span>
            <span>→</span>
          </div>
        </div>

        {/* Card 2: Slide Generator (Coming Soon) */}
        <div 
          onClick={() => onNavigate('slides-coming-soon')}
          className="home-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: '16px',
            padding: 'clamp(1rem, 2.5vh, 1.5rem) clamp(1rem, 2vw, 1.25rem)',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: 'var(--shadow-md)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: 'clamp(220px, 32vh, 290px)'
          }}
        >
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'clamp(0.5rem, 1.5vh, 1rem)' }}>
              <img 
                src="/slide_generator_logo.png" 
                alt="AI Slide Generator" 
                style={{ height: 'clamp(85px, 13vh, 115px)', objectFit: 'contain', alignSelf: 'flex-start' }} 
              />
              <span style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: 'white',
                fontSize: '0.65rem',
                fontWeight: 700,
                padding: '0.2rem 0.5rem',
                borderRadius: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginTop: '10px'
              }}>
                Coming Soon
              </span>
            </div>
            <p style={{ fontSize: 'clamp(0.8rem, 1.8vh, 0.875rem)', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 'clamp(0.75rem, 2vh, 1.25rem)' }}>
              Generate beautifully formatted visual presentation slides directly from your session outlines or generated speaker notes. Download and present instantly.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: '#d97706', fontSize: '0.9rem' }}>
            <span>Preview feature</span>
            <span>→</span>
          </div>
        </div>

        {/* Card 3: Takeaway Notes */}
        <div 
          onClick={() => onNavigate('takeaway-upload')}
          className="home-card"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-light)',
            borderRadius: '16px',
            padding: 'clamp(1rem, 2.5vh, 1.5rem) clamp(1rem, 2vw, 1.25rem)',
            cursor: 'pointer',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            boxShadow: 'var(--shadow-md)',
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: 'clamp(220px, 32vh, 290px)'
          }}
        >
          <div>
            <img 
              src="/takeaway_notes_generator_logo.png" 
              alt="AI Takeaway Notes Generator" 
              style={{ height: 'clamp(85px, 13vh, 115px)', objectFit: 'contain', marginBottom: 'clamp(0.5rem, 1.5vh, 1rem)', alignSelf: 'flex-start' }} 
            />
            <p style={{ fontSize: 'clamp(0.8rem, 1.8vh, 0.875rem)', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 'clamp(0.75rem, 2vh, 1.25rem)' }}>
              Publish styled, high-impact audience summaries from existing slideshows or speaker notes. Bypasses file upload if sent directly from your brainstorm session.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600, color: 'var(--success)', fontSize: '0.9rem' }}>
            <span>Create handouts</span>
            <span>→</span>
          </div>
        </div>

      </div>
    </div>
  );
};

export default HomeScreen;
