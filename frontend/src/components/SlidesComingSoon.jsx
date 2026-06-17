const SlidesComingSoon = ({ onBack }) => {
  return (
    <div className="animate-fade-in slides-coming-soon-container" style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center', alignItems: 'center', minHeight: '80vh', padding: '2rem' }}>
      <div className="card" style={{
        maxWidth: '600px',
        width: '100%',
        textAlign: 'center',
        padding: '3.5rem 2.5rem',
        borderRadius: '24px',
        boxShadow: 'var(--shadow-lg)',
        border: '1px solid var(--border-light)'
      }}>
        <img 
          src="/slide_generator_logo.png" 
          alt="AI Slide Generator" 
          style={{ height: '120px', objectFit: 'contain', marginBottom: '1.5rem' }} 
        />
        
        <span style={{
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          color: 'white',
          fontSize: '0.8rem',
          fontWeight: 700,
          padding: '0.35rem 0.85rem',
          borderRadius: '20px',
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          display: 'inline-block',
          marginBottom: '1.25rem'
        }}>
          Under Active Development
        </span>

        <h1 style={{ fontFamily: 'var(--font-headings)', fontSize: '2.2rem', fontWeight: 800, color: '#0f172a', marginBottom: '1rem', letterSpacing: '-0.01em' }}>
          AI Slide Generator
        </h1>
        
        <p style={{ fontSize: '1rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '2.5rem' }}>
          We are building a premium slide publishing engine! Soon, you will be able to take your brainstormed speaker notes or uploaded slides and transform them into gorgeous, custom-styled presentation decks in PowerPoint format.
        </p>

        <button 
          onClick={onBack}
          className="btn-primary"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.75rem',
            borderRadius: '12px',
            fontSize: '0.95rem',
            fontWeight: 600,
            border: 'none',
            cursor: 'pointer',
            backgroundColor: '#0f172a',
            color: 'white',
            transition: 'all 0.2s'
          }}
        >
          ← Go Back
        </button>
      </div>
    </div>
  );
};

export default SlidesComingSoon;
