import React, { useRef, useState, useEffect } from 'react';

const ViewerScreen = ({
  htmlContent,
  onBack,
  onReset,
  onRevise,
  isRevising,
  isLoading,
  loadingStage
}) => {
  const iframeRef = useRef(null);
  const [revisionText, setRevisionText] = useState('');
  const [zoom, setZoom] = useState(100);

  // Inject HTML content into the iframe when it changes
  useEffect(() => {
    if (iframeRef.current && htmlContent) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
      doc.open();
      doc.write(htmlContent);
      doc.close();

      // Inject PDF workspace styles + hard kill of any remaining interactive CSS
      const style = doc.createElement('style');
      style.textContent = `
        /* Overrides to enforce PDF viewer styling in iframe */
        @media screen {
          html, body {
            background-color: #525659 !important;
            margin: 0 !important;
            padding: 20px 10px !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            min-height: 100vh !important;
            box-sizing: border-box !important;
          }

          /* Visual page breaks on screen */
          .page {
            margin: 0 auto 24px auto !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
            border-radius: 4px !important;
            background-color: white !important;
          }

          /* Enforce responsive scaling on mobile screen viewports */
          @media (max-width: 840px) {
            .page {
              width: 90vw !important;
              min-height: calc(90vw * 1.414) !important;
              padding: 5vw !important;
            }
          }
        }

        /* Prevent scrollbars inside generated document elements (e.g. code boxes, tables) */
        * {
          overflow: visible !important;
          max-height: none !important;
          max-width: 100% !important;
          box-sizing: border-box !important;
          /* Kill any remaining hover / interactive styles from AI output */
          transition: none !important;
          animation: none !important;
          cursor: default !important;
        }

        /* RE-APPLY page clipping AFTER the * rule above — prevents large text bleeding out */
        .page {
          overflow: hidden !important;
        }

        /* Prevent large headings and elements from exceeding page width */
        h1, h2, h3, h4, h5, h6,
        p, li, td, th, span, div, pre, code, table, blockquote, figure, aside, section, article {
          word-break: break-word !important;
          overflow-wrap: break-word !important;
          hyphens: auto !important;
          max-width: 100% !important;
        }

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

        /* Standard heading line-heights */
        h1, h2, h3, h4, h5, h6 { line-height: 1.35 !important; }

        /* ── SHAPE CONTAINMENT ──────────────────────────────────────────────
           Shape containers must grow with their text content.
           All divs/sections inside .page are allowed to expand vertically.   */
        .page div, .page section, .page article,
        .page aside, .page figure, .page blockquote {
          height: auto !important;
          min-height: 0 !important;
          overflow: visible !important;
        }

        /* Prevent self-contained layout blocks from breaking mid-element (avoid table, list, aside containers) as a suggestion */
        .card, .callout-box, .stat-card, .notes-card, .step-card,
        .page tr, .page li, .page blockquote, .page figure {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        /* Enforce narrow page boundaries and margins */
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

        /* Ensure text never touches the edge of a shaped container */
        .page div[style*="border-radius"],
        .page div[style*="background"],
        .page div[style*="border:"],
        .page div[style*="border :"] {
          padding: max(var(--sp, 0px), 10px) !important;
          box-sizing: border-box !important;
          word-break: break-word !important;
          overflow-wrap: break-word !important;
        }

        /* Keep page-level boundaries but hide horizontal scrollbars on printing */
        html, body, .page {
          overflow-x: hidden !important;
        }

        /* Kill all colour changes on hover — document must be print-static */
        *:hover {
          color: inherit !important;
          background-color: inherit !important;
          border-color: inherit !important;
          box-shadow: inherit !important;
          opacity: inherit !important;
          text-decoration: inherit !important;
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
      `;
      doc.head.appendChild(style);

      // Programmatically delete all :hover rules from live stylesheets inside iframe
      try {
        const sheets = doc.styleSheets;
        for (let i = 0; i < sheets.length; i++) {
          let rules;
          try { rules = sheets[i].cssRules || sheets[i].rules; } catch(e) { continue; }
          if (!rules) continue;
          for (let j = rules.length - 1; j >= 0; j--) {
            const rule = rules[j];
            if (rule.selectorText && rule.selectorText.indexOf(':hover') !== -1) {
              try { sheets[i].deleteRule(j); } catch(e) {}
            } else if (rule.cssRules) {
              for (let k = rule.cssRules.length - 1; k >= 0; k--) {
                const inner = rule.cssRules[k];
                if (inner.selectorText && inner.selectorText.indexOf(':hover') !== -1) {
                  try { rule.deleteRule(k); } catch(e) {}
                }
              }
            }
          }
        }
      } catch(e) {
        console.warn("Iframe hover cleaner warning:", e);
      }
    }
  }, [htmlContent]);

  // Apply zoom factor dynamically to the iframe's body zoom style
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
      if (doc && doc.body) {
        doc.body.style.zoom = `${zoom}%`;
      }
    }
  }, [zoom, htmlContent]);

  // Handle PDF print conversion of the iframe contents
  const handlePrintPDF = () => {
    if (iframeRef.current) {
      try {
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
      } catch (err) {
        console.error("Failed to print iframe directly:", err);
        // Fallback: If printing iframe directly fails (e.g. cross-origin issues or blockages),
        // try opening in a popup and printing.
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          alert("Popup blocker active! Please allow popups to print/download the PDF.");
          return;
        }
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
      }
    }
  };

  const handleSubmitRevision = (e) => {
    e.preventDefault();
    if (!revisionText.trim() || isRevising) return;
    onRevise(revisionText);
    setRevisionText('');
  };

  return (
    <div className="animate-fade-in viewer-screen-container">
      
      {/* Left Column: Branding, Title, and Controls */}
      <div className="viewer-left-column">
        
        {/* Top: Branding & Title Block */}
        <div className="viewer-left-top">
          <header className="app-header" style={{ marginBottom: '0.75rem' }}>
            <div className="logo-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 3H5C3.9 3 3 3.9 3 5V19C3 20.1 3.9 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3ZM19 19H5V5H19V19ZM17 17H7V15H17V17ZM17 13H7V11H17V13ZM17 9H7V7H17V9Z" fill="currentColor"/>
              </svg>
            </div>
            <span className="logo-text">Takeaway Notes</span>
          </header>

          <div style={{ marginBottom: '0.25rem' }}>
            <h2 style={{ fontFamily: 'var(--font-headings)', fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', marginBottom: '0.25rem' }}>
              Viewer & Revision Desk
            </h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.35 }}>
              Review the publication design and request layout, color, or text updates directly using AI.
            </p>
          </div>
        </div>

        {/* Middle: AI Editor Commands */}
        <div className="viewer-left-middle">
          <div className="card" style={{ marginBottom: 0, padding: '1.25rem' }}>
            <h3 style={{ fontFamily: 'var(--font-headings)', fontWeight: 600, fontSize: '1rem', color: '#0f172a', marginBottom: '0.5rem' }}>
              AI Editor Commands
            </h3>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem', lineHeight: 1.35 }}>
              Instruct the AI Designer to tweak the layout. Type instructions like:
              <br />
              • <em>"Add callout boxes for key vocab"</em>
              <br />
              • <em>"Change layout to a 2-column grid"</em>
              <br />
              • <em>"Make header colors darker blue"</em>
            </p>

            <form onSubmit={handleSubmitRevision}>
              <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                <textarea
                  className="revision-textarea"
                  style={{ minHeight: '100px', fontSize: '0.85rem' }}
                  placeholder="Type your revision command here..."
                  value={revisionText}
                  onChange={(e) => setRevisionText(e.target.value)}
                  disabled={isRevising || isLoading}
                  required
                />
              </div>

              <button 
                type="submit" 
                className="btn btn-primary" 
                style={{ width: '100%', fontSize: '0.85rem', padding: '0.6rem 1rem' }}
                disabled={isRevising || isLoading || !revisionText.trim()}
              >
                {isRevising ? 'Revising...' : 'Apply Revision'}
              </button>
            </form>
          </div>
        </div>

        {/* Bottom: Navigation Actions */}
        <div className="viewer-left-bottom">
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
            <button className="btn btn-secondary" onClick={onBack} disabled={isRevising || isLoading} style={{ flex: 1, fontSize: '0.8rem', padding: '0.6rem 0.75rem' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '4px' }}>
                <path d="M15.41 16.59L10.83 12L15.41 7.41L14 6L8 12L14 18L15.41 16.59Z" fill="currentColor"/>
              </svg>
              Edit Settings
            </button>
            <button className="btn btn-danger" onClick={onReset} disabled={isRevising || isLoading} style={{ flex: 1, fontSize: '0.8rem', padding: '0.6rem 0.75rem' }}>
              Reset All
            </button>
          </div>
        </div>

      </div>

      {/* Right Column: PDF Viewer Panel spanning 100% Height */}
      <div className="viewer-right-column">
        <div className="pdf-viewer-container">
          
          {/* PDF Toolbar */}
          <div className="pdf-toolbar">
            <div className="pdf-toolbar-left">
              <span className="pdf-badge">PDF</span>
              <span className="pdf-doc-title">takeaway_notes.pdf</span>
            </div>
            
            <div className="pdf-toolbar-center">
              <div className="pdf-zoom-controls">
                <button 
                  type="button" 
                  className="pdf-zoom-btn"
                  onClick={() => setZoom(prev => Math.max(50, prev - 25))}
                  disabled={zoom <= 50 || isRevising || isLoading}
                  title="Zoom Out"
                >
                  −
                </button>
                <span className="pdf-zoom-value">{zoom}%</span>
                <button 
                  type="button" 
                  className="pdf-zoom-btn"
                  onClick={() => setZoom(prev => Math.min(150, prev + 25))}
                  disabled={zoom >= 150 || isRevising || isLoading}
                  title="Zoom In"
                >
                  +
                </button>
              </div>
            </div>

            <div className="pdf-toolbar-right">
              <button 
                type="button" 
                className="pdf-print-btn" 
                onClick={handlePrintPDF}
                disabled={isRevising || isLoading}
                title="Print / Save as PDF"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ marginRight: '4px' }}>
                  <path d="M19 8H5C3.34 8 2 9.34 2 11V17H6V21H18V17H22V11C22 9.34 20.66 8 19 8ZM16 19H8V15H16V19ZM19 12C18.45 12 18 11.55 18 11C18 10.45 18.45 10 19 10C19.55 10 20 10.45 20 11C20 11.55 19.55 12 19 12ZM18 3H6V7H18V3Z" fill="currentColor"/>
                </svg>
                Print / Save PDF
              </button>
            </div>
          </div>

          {/* Viewport Workspace */}
          <div className="pdf-viewport">
            {isRevising && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(30, 41, 59, 0.75)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10,
                color: 'white'
              }}>
                <div className="spinner"></div>
                <p style={{ fontWeight: 600 }}>Applying AI Revisions...</p>
                <p style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '0.25rem' }}>This will take a few seconds.</p>
              </div>
            )}
            
            {isLoading && (
              <div className="skeleton-workspace">
                <div className="skeleton-overlay-card" style={{ width: 420 }}>
                  {/* Stage icon */}
                  <div style={{
                    width: 56, height: 56, borderRadius: '50%',
                    background: 'linear-gradient(135deg, #6366f1, #2563eb)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    marginBottom: '1.25rem', fontSize: '1.6rem'
                  }}>
                    {loadingStage?.icon || '✨'}
                  </div>

                  <h3 style={{ fontFamily: 'var(--font-headings)', fontWeight: 700, fontSize: '1.15rem', color: '#0f172a', marginBottom: '0.35rem', textAlign: 'center' }}>
                    {loadingStage?.title || 'Getting started...'}
                  </h3>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1.25rem', textAlign: 'center', lineHeight: 1.5 }}>
                    {loadingStage?.desc || 'Please wait a moment.'}
                  </p>

                  {/* Progress bar track */}
                  <div style={{
                    width: '100%', height: 8, background: '#e2e8f0',
                    borderRadius: 99, overflow: 'hidden', marginBottom: '0.6rem'
                  }}>
                    <div style={{
                      height: '100%',
                      width: `${loadingStage?.pct ?? 5}%`,
                      background: 'linear-gradient(90deg, #6366f1, #2563eb)',
                      borderRadius: 99,
                      transition: 'width 0.7s ease'
                    }} />
                  </div>

                  {/* Percentage + step label */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
                      Step {loadingStage?.step ?? 1} of 6
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 700 }}>
                      {loadingStage?.pct ?? 5}%
                    </span>
                  </div>
                </div>

                <div className="skeleton-page">
                  <div className="skeleton-line heading"></div>
                  <div className="skeleton-line subheading"></div>
                  <div style={{ margin: '15px 0' }}></div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line short"></div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line vshort"></div>
                  <div className="skeleton-block"></div>
                  <div style={{ margin: '15px 0' }}></div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line short"></div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line vshort"></div>
                  <div className="skeleton-block"></div>
                  <div style={{ margin: '15px 0' }}></div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line short"></div>
                </div>
              </div>
            )}
            
            <iframe 
              ref={iframeRef} 
              className="iframe-sandbox" 
              title="Takeaway Notes Content"
              sandbox="allow-same-origin allow-scripts allow-modals"
              style={{ 
                width: '100%', 
                height: '100%', 
                border: 'none', 
                overflow: 'auto',
                display: isLoading ? 'none' : 'block'
              }}
            />
          </div>
        </div>
      </div>
      
    </div>
  );
};

export default ViewerScreen;
