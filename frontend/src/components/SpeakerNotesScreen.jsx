import { useState, useEffect, useRef } from 'react';

const SpeakerNotesScreen = ({ 
  onBack, 
  onSendToTakeaways, 
  onNavigateToSlides, 
  BACKEND_URL = 'http://localhost:5000' 
}) => {
  const iframeRef = useRef(null);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  // --- State Variables ---
  const [topic, setTopic] = useState('');
  const [stage, setStage] = useState('title_brainstorm'); // 'title_brainstorm' | 'topic_scope' | 'toc' | 'section_brainstorm' | 'section_edit' | 'complete'
  const [toc, setToc] = useState([]);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [proposedSectionContent, setProposedSectionContent] = useState(null);
  
  // Accumulated document HTML content (pages)
  const [documentHtml, setDocumentHtml] = useState('');
  const [zoom, setZoom] = useState(100);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [options, setOptions] = useState([]);

  // Initial chat setup
  const [chatHistory, setChatHistory] = useState([
    { 
      role: 'model', 
      text: "Welcome to the AI Presentation Assistant! Let's start by brainstorming a title or topic for your presentation.\n\nWhat is the general subject or ideas you are thinking about? I will suggest some good titles for us to choose from!" 
    }
  ]);

  // Auto scroll to bottom of chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, isLoading]);

  // Auto resize the text input height as the user types
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = '46px'; 
      const scrollHeight = inputRef.current.scrollHeight;
      inputRef.current.style.height = `${Math.min(160, Math.max(46, scrollHeight))}px`;
    }
  }, [inputValue]);

  // Inject CSS and HTML into preview iframe
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
      doc.open();
      
      const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Presentation Speaker Notes</title>
          <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Georgia&display=swap">
          <style>
            html, body {
              background-color: #525659 !important;
              margin: 0 !important;
              padding: 20px 10px !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              min-height: 100vh !important;
              box-sizing: border-box !important;
              font-family: 'Inter', sans-serif;
            }

            * {
              box-sizing: border-box !important;
            }

            /* A4 Page Formatting */
            .page {
              background-color: white !important;
              width: 210mm !important;
              min-height: 297mm !important;
              padding: 25mm 20mm !important;
              margin: 0 auto 24px auto !important;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
              border-radius: 4px !important;
              overflow: hidden !important;
              position: relative !important;
              box-sizing: border-box !important;
            }

            @media (max-width: 840px) {
              .page {
                width: 90vw !important;
                min-height: calc(90vw * 1.414) !important;
                padding: 5vw !important;
              }
            }

            /* Typography Hierarchy */
            .title {
              font-size: 30px !important;
              font-weight: 800 !important;
              color: #1e3a8a !important;
              line-height: 1.25 !important;
              margin-bottom: 8px !important;
            }

            .subtitle {
              font-size: 18px !important;
              font-weight: 500 !important;
              color: #64748b !important;
              margin-top: 0 !important;
              margin-bottom: 24px !important;
            }

            .section-title {
              font-size: 22px !important;
              font-weight: 700 !important;
              color: #0f766e !important;
              border-bottom: 2px solid #cbd5e1 !important;
              padding-bottom: 6px !important;
              margin-top: 0 !important;
              margin-bottom: 20px !important;
            }

            h2, h3, h4 {
              color: #1e293b !important;
              font-weight: 700 !important;
              margin-top: 20px !important;
              margin-bottom: 10px !important;
            }

            h2 { font-size: 18px !important; }
            h3 { font-size: 15px !important; }

            p, li, td {
              font-family: 'Georgia', serif !important;
              font-size: 11.5pt !important;
              line-height: 1.6 !important;
              color: #334155 !important;
              margin-top: 0 !important;
              margin-bottom: 12px !important;
            }

            ul, ol {
              margin-top: 0 !important;
              margin-bottom: 12px !important;
              padding-left: 20px !important;
            }

            li {
              margin-bottom: 6px !important;
            }

            /* Table of Contents Formatting */
            .toc-list {
              display: flex !important;
              flex-direction: column !important;
              gap: 12px !important;
              margin-top: 24px !important;
            }

            .toc-item {
              display: flex !important;
              justify-content: space-between !important;
              align-items: center !important;
              font-size: 13px !important;
              font-weight: 500 !important;
              color: #334155 !important;
            }

            .toc-item-dots {
              flex-grow: 1 !important;
              border-bottom: 1px dashed #cbd5e1 !important;
              margin: 0 10px !important;
            }

            /* Page numbering placeholder at bottom */
            .page-footer {
              position: absolute !important;
              bottom: 15mm !important;
              left: 20mm !important;
              right: 20mm !important;
              display: flex !important;
              justify-content: space-between !important;
              font-size: 10px !important;
              color: #94a3b8 !important;
              border-top: 1px solid #f1f5f9 !important;
              padding-top: 6px !important;
            }
          </style>
        </head>
        <body>
          ${documentHtml || `
            <div class="page" id="page-1">
              <div style="text-align: center; margin-top: 60px; margin-bottom: 40px;">
                <h1 class="title">Your Presentation Speaker Notes</h1>
                <p class="subtitle">Enter your topic in the chat to start brainstorming...</p>
              </div>
              <div style="border: 2px dashed #e2e8f0; border-radius: 12px; padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; margin-top: 40px;">
                📚 Document outline and notes will generate page-by-page as you approve them in the chat.
              </div>
            </div>
          `}
        </body>
        </html>
      `;

      doc.write(fullHtml);
      doc.close();
    }
  }, [documentHtml]);

  // Adjust Zoom Level
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
      if (doc && doc.body) {
        doc.body.style.zoom = `${zoom}%`;
      }
    }
  }, [zoom, documentHtml]);

  // --- AI Chat Actions ---

  const handleSendMessage = async (textToSend, stageOverride, topicOverride, indexOverride, tocOverride, documentHtmlOverride) => {
    const text = textToSend || inputValue;
    if (!text.trim() || isLoading) return;

    setErrorMsg(null);
    setInputValue('');
    setOptions([]); // Clear options immediately on message send

    const newHistory = [...chatHistory, { role: 'user', text }];
    setChatHistory(newHistory);
    setIsLoading(true);

    const activeStage = stageOverride !== undefined ? stageOverride : stage;
    const activeTopic = topicOverride !== undefined ? topicOverride : topic;
    const activeIndex = indexOverride !== undefined ? indexOverride : currentSectionIndex;
    const activeToc = tocOverride !== undefined ? tocOverride : toc;
    const activeDocumentHtml = documentHtmlOverride !== undefined ? documentHtmlOverride : documentHtml;

    try {
      const response = await fetch(`${BACKEND_URL}/api/chat-speaker-notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: newHistory,
          currentDocument: activeDocumentHtml,
          toc: activeToc,
          currentSectionIndex: activeIndex,
          stage: activeStage,
          topic: activeTopic
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'An error occurred while calling the chatbot.');
      }

      // Add AI reply to chat log
      setChatHistory(prev => [...prev, { role: 'model', text: data.reply }]);

      // Update state based on structured response
      if (data.topic) {
        setTopic(data.topic);
      }
      if (data.toc && data.toc.length > 0) {
        setToc(data.toc);
      }
      if (data.nextStage) {
        setStage(data.nextStage);
      }
      if (data.currentSectionIndex !== undefined) {
        setCurrentSectionIndex(data.currentSectionIndex);
      }
      if (data.proposedSectionContent) {
        setProposedSectionContent(data.proposedSectionContent);
      } else {
        setProposedSectionContent(null);
      }
      if (data.options && data.options.length > 0) {
        setOptions(data.options);
      } else {
        setOptions([]);
      }



    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to communicate with presentation assistant.');
      // Remove the last message from history if failed so user can try again
      setChatHistory(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  // Helper: Approve title and switch to scope brainstorming
  const handleApproveTitle = (titleValue) => {
    const finalTitle = titleValue || topic || 'Speaker Notes';
    setTopic(finalTitle);
    setStage('topic_scope');
    handleSendMessage(
      `I approve the title: "${finalTitle}". Let's start brainstorming the talking points and scope of the presentation.`,
      'topic_scope',
      finalTitle
    );
  };

  // Helper: Format and write the ToC page to document
  const applyToCApproval = (tocList, finalTopic) => {
    const titleToUse = finalTopic || topic || 'Speaker Notes';
    const tocHtml = tocList.map((item, idx) => `
      <div class="toc-item">
        <span>${idx + 1}. ${item}</span>
        <div class="toc-item-dots"></div>
        <span>Page ${idx + 2}</span>
      </div>
    `).join('');

    const coverPageHtml = `
      <div class="page" id="page-1">
        <div style="text-align: center; margin-top: 60px; margin-bottom: 50px;">
          <h1 class="title">${titleToUse}</h1>
          <p class="subtitle">Presentation Speaker Notes</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 40px 0;">
        <h2 class="section-title">Table of Contents</h2>
        <div class="toc-list">
          ${tocHtml}
        </div>
        <div class="page-footer">
          <span>AI Presentation Assistant</span>
          <span>Page 1 of ${tocList.length + 1}</span>
        </div>
      </div>
    `;
    setDocumentHtml(coverPageHtml);
    setStage('section_brainstorm');
    setCurrentSectionIndex(0);
    setProposedSectionContent(null);
    return coverPageHtml;
  };

  // Helper: Append or edit section notes as a page in the document
  const applySectionApproval = (sectionHtml) => {
    const pageNum = currentSectionIndex + 2; // cover/ToC is Page 1, section 1 is Page 2
    const totalPages = toc.length + 1;

    const newPageHtml = `
      <div class="page" id="page-${pageNum}">
        <div class="section-content">
          ${sectionHtml}
        </div>
        <div class="page-footer">
          <span>${toc[currentSectionIndex] || 'Speaker Notes'}</span>
          <span>Page ${pageNum} of ${totalPages}</span>
        </div>
      </div>
    `;

    let updatedHtml = documentHtml;

    if (stage === 'section_edit') {
      // Safely replace the target page HTML inside documentHtml in-place using DOMParser
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(`<body>${documentHtml}</body>`, 'text/html');
        const targetPage = doc.getElementById(`page-${pageNum}`);
        if (targetPage) {
          targetPage.innerHTML = `
            <div class="section-content">
              ${sectionHtml}
            </div>
            <div class="page-footer">
              <span>${toc[currentSectionIndex] || 'Speaker Notes'}</span>
              <span>Page ${pageNum} of ${totalPages}</span>
            </div>
          `;
        }
        updatedHtml = doc.body.innerHTML;
      } catch (e) {
        console.error("DOMParser replace error, falling back:", e);
      }
      setDocumentHtml(updatedHtml);
      setStage('complete');
    } else {
      // Normal brainstorming mode: client-side local append
      updatedHtml = documentHtml + '\n' + newPageHtml;
      setDocumentHtml(updatedHtml);
      
      // Advance section index
      const nextIdx = currentSectionIndex + 1;
      setCurrentSectionIndex(nextIdx);

      // Check if we finished all sections
      if (nextIdx >= toc.length) {
        setStage('complete');
      }
    }
    setProposedSectionContent(null);
    return updatedHtml;
  };

  // --- Button Shortcut Commands ---

  const handleApproveToC = () => {
    const updatedHtml = applyToCApproval(toc, topic);
    handleSendMessage(
      "Send this Table of Contents to the document. Let's start brainstorming the first section.",
      'section_brainstorm',
      topic,
      0,
      toc,
      updatedHtml
    );
  };

  const handleShowSpeakerNotes = () => {
    handleSendMessage(
      "Generate and show the speaker notes draft for this section.",
      stage,
      topic,
      currentSectionIndex,
      toc,
      documentHtml
    );
  };

  const handleApproveSection = () => {
    if (!proposedSectionContent) return;
    const updatedHtml = applySectionApproval(proposedSectionContent);

    if (stage === 'section_edit') {
      handleSendMessage(
        `Update these revised notes in the document.`,
        'complete',
        topic,
        currentSectionIndex,
        toc,
        updatedHtml
      );
      return;
    }

    const nextIdx = currentSectionIndex + 1;
    const nextSectionName = toc[nextIdx];
    if (nextSectionName) {
      handleSendMessage(
        `Send these notes to the document. Let's move to the next section: "${nextSectionName}".`,
        'section_brainstorm',
        topic,
        nextIdx,
        toc,
        updatedHtml
      );
    } else {
      handleSendMessage(
        `Send these notes to the document. That was the last section!`,
        'complete',
        topic,
        nextIdx,
        toc,
        updatedHtml
      );
    }
  };

  const handleRegenerateSection = () => {
    const sectionName = toc[currentSectionIndex] || 'this section';
    handleSendMessage(`Could you please revise or regenerate the draft speaker notes for "${sectionName}"? Please provide a different version or format.`);
  };

  const handleStartSectionEdit = (index) => {
    if (index < 0 || index >= toc.length) return;
    setCurrentSectionIndex(index);
    setStage('section_edit');
    setProposedSectionContent(null);
    
    // Extract current page HTML text content to show the AI
    const pageNum = index + 2;
    const iframeDoc = iframeRef.current?.contentDocument;
    const targetPage = iframeDoc?.getElementById(`page-${pageNum}`);
    const currentNotesText = targetPage ? targetPage.innerText || targetPage.textContent : '';

    handleSendMessage(
      `Let's revise Section ${index + 1}: "${toc[index]}". Here is the current text in the document: "${currentNotesText.substring(0, 1000)}". What changes would you like to make?`,
      'section_edit',
      topic,
      index,
      toc
    );
  };

  // --- Document Export Utilities ---

  const handleDownloadWord = () => {
    if (!documentHtml) return;

    const iframeBody = iframeRef.current?.contentDocument?.body?.innerHTML || documentHtml;

    const header = 
      `<html xmlns:o='urn:schemas-microsoft-com:office:office' ` +
      `xmlns:w='urn:schemas-microsoft-com:office:word' ` +
      `xmlns='http://www.w3.org/TR/REC-html40'>` +
      `<head><title>${topic || 'Speaker Notes'}</title>` +
      `<style>` +
      `body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.5; padding: 20px; }` +
      `h1 { font-size: 20pt; color: #1e3a8a; font-weight: bold; margin-top: 18pt; margin-bottom: 6pt; }` +
      `h2 { font-size: 16pt; color: #0f766e; font-weight: bold; margin-top: 14pt; margin-bottom: 6pt; }` +
      `h3 { font-size: 13pt; color: #374151; font-weight: bold; margin-top: 12pt; margin-bottom: 4pt; }` +
      `p { margin-top: 0; margin-bottom: 8pt; color: #334155; }` +
      `ul, ol { margin-top: 0; margin-bottom: 8pt; padding-left: 20px; }` +
      `li { margin-bottom: 4pt; color: #334155; }` +
      `.page { margin-bottom: 40px; border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; }` +
      `.page-footer { font-size: 9pt; color: #94a3b8; margin-top: 20px; text-align: right; }` +
      `br.page-break { page-break-before: always; }` +
      `</style></head><body>`;
    
    const footer = `</body></html>`;
    
    let formattedBody = iframeBody.replace(/class="page"/g, 'class="page"');
    formattedBody = formattedBody.replace(/id="page-(\d+)"/g, (match, num) => {
      if (parseInt(num) > 1) {
        return `class="page" style="page-break-before: always;"`;
      }
      return match;
    });

    const source = header + formattedBody + footer;
    const blob = new Blob(['\ufeff' + source], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(topic || 'speaker_notes').replace(/\s+/g, '_')}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintPDF = () => {
    if (iframeRef.current) {
      try {
        iframeRef.current.contentWindow.focus();
        iframeRef.current.contentWindow.print();
      } catch (err) {
        console.error("Iframe print error:", err);
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          alert("Popup blocker active! Please allow popups to print/download the PDF.");
          return;
        }
        
        const headHtml = iframeRef.current.contentDocument.head.innerHTML;
        const bodyHtml = iframeRef.current.contentDocument.body.innerHTML;

        printWindow.document.write(`<html><head>${headHtml}</head><body>${bodyHtml}</body></html>`);
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
        printWindow.close();
      }
    }
  };

  const handleForwardToTakeaways = () => {
    if (!documentHtml) return;
    
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(documentHtml, 'text/html');
    const textContent = parsedDoc.body.innerText || parsedDoc.body.textContent || "";
    
    onSendToTakeaways(textContent);
  };

  return (
    <div className="animate-fade-in speaker-notes-layout" style={{ display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minHeight: 0 }}>
      
      {/* Top Workspace Navbar */}
      <div className="workspace-navbar" style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '0.75rem 0',
        borderBottom: '1px solid var(--border-light)',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        {/* Left: Back Button & Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button 
            onClick={onBack}
            className="btn-secondary"
            style={{ padding: '0.5rem 0.85rem', borderRadius: '10px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.35rem', border: '1px solid var(--border-light)', background: 'white', cursor: 'pointer' }}
          >
            ← Home
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <img 
              src="/speaker_notes_generator_logo.png" 
              alt="AI Speaker Notes Generator" 
              style={{ height: '52px', objectFit: 'contain' }} 
            />
            {topic && (
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500, maxWidth: '280px', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', borderLeft: '1px solid var(--border-light)', paddingLeft: '0.75rem' }}>
                Topic: {topic}
              </p>
            )}
          </div>
        </div>

        {/* Center: Zoom Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', background: '#f1f5f9', padding: '0.25rem', borderRadius: '10px' }}>
          <button 
            onClick={() => setZoom(z => Math.max(50, z - 10))}
            style={{ border: 'none', background: 'none', width: '28px', height: '28px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Zoom Out"
          >
            -
          </button>
          <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', minWidth: '40px', textAlign: 'center' }}>
            {zoom}%
          </span>
          <button 
            onClick={() => setZoom(z => Math.min(150, z + 10))}
            style={{ border: 'none', background: 'none', width: '28px', height: '28px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            title="Zoom In"
          >
            +
          </button>
        </div>

        {/* Right: Export & Handouts Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button 
            disabled={!documentHtml}
            onClick={handleDownloadWord}
            className="btn-secondary"
            style={{ 
              padding: '0.5rem 0.85rem', 
              borderRadius: '10px', 
              fontSize: '0.85rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              border: '1px solid var(--border-light)', 
              background: 'white', 
              cursor: documentHtml ? 'pointer' : 'not-allowed', 
              opacity: documentHtml ? 1 : 0.5 
            }}
            title="Download formatted document in Microsoft Word (.doc) format"
          >
            📄 Word
          </button>
          <button 
            disabled={!documentHtml}
            onClick={handlePrintPDF}
            className="btn-secondary"
            style={{ 
              padding: '0.5rem 0.85rem', 
              borderRadius: '10px', 
              fontSize: '0.85rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              border: '1px solid var(--border-light)', 
              background: 'white', 
              cursor: documentHtml ? 'pointer' : 'not-allowed', 
              opacity: documentHtml ? 1 : 0.5 
            }}
            title="Print or Save as PDF"
          >
            🖨️ PDF
          </button>
          
          <button 
            onClick={onNavigateToSlides}
            className="btn-secondary"
            style={{ 
              padding: '0.5rem 0.85rem', 
              borderRadius: '10px', 
              fontSize: '0.85rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              border: '1px solid #fcd34d', 
              background: '#fffbeb', 
              color: '#b45309',
              fontWeight: 600,
              cursor: 'pointer' 
            }}
          >
            🎨 Slides
          </button>

          <button 
            disabled={!documentHtml}
            onClick={handleForwardToTakeaways}
            className="btn-primary"
            style={{ 
              padding: '0.5rem 1rem', 
              borderRadius: '10px', 
              fontSize: '0.85rem', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '0.35rem', 
              border: 'none', 
              cursor: documentHtml ? 'pointer' : 'not-allowed', 
              opacity: documentHtml ? 1 : 0.5,
              backgroundColor: 'var(--success)',
              color: 'white',
              fontWeight: 600
            }}
          >
            ⚡ Generate Takeaway Notes
          </button>
        </div>
      </div>

      {/* Main Split workspace Workspace */}
      <div className="workspace-split-container" style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(360px, 1.1fr) 1.9fr',
        gap: '1.5rem',
        flex: 1,
        minHeight: 0,
        height: 'calc(100vh - 120px)',
        alignItems: 'stretch'
      }}>
        
        {/* Left Side: Conversational Chat Interface & checklist */}
        <div className="chat-panel card" style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '1.25rem',
          borderRadius: '20px',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--border-light)',
          background: 'white',
          minHeight: 0
        }}>
          {/* Progress Timeline Header */}
          {toc.length > 0 && (
            <div className="chat-timeline" style={{
              background: '#f8fafc',
              padding: '0.65rem 0.85rem',
              borderRadius: '12px',
              border: '1px solid var(--border-light)',
              marginBottom: '0.75rem',
              fontSize: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              maxHeight: '120px',
              overflowY: 'auto'
            }}>
              <div style={{ fontWeight: 700, color: '#0f172a' }}>Brainstorming Progress:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 0.75rem' }}>
                <span style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Title Page</span>
                {toc.map((section, idx) => {
                  const isActive = idx === currentSectionIndex && (stage === 'section_brainstorm' || stage === 'section_edit');
                  const isDone = (idx < currentSectionIndex && stage !== 'section_edit') || stage === 'complete';
                  return (
                    <span 
                      key={idx}
                      onClick={() => {
                        if (stage === 'complete') {
                          handleStartSectionEdit(idx);
                        }
                      }}
                      style={{
                        color: isDone ? 'var(--success)' : isActive ? 'var(--primary)' : 'var(--text-light)',
                        fontWeight: isActive || isDone ? 600 : 400,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                        cursor: stage === 'complete' ? 'pointer' : 'default'
                      }}
                      title={stage === 'complete' ? 'Click to edit this section' : ''}
                    >
                      {isDone ? '✓' : isActive ? '●' : '○'} {idx + 1}. {section}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Chat Messages Log */}
          <div className="chat-messages-container" style={{
            flex: 1,
            overflowY: 'auto',
            paddingRight: '0.5rem',
            marginBottom: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            minHeight: 0
          }}>
            {chatHistory.map((msg, index) => {
              const isUser = msg.role === 'user';
              return (
                <div 
                  key={index} 
                  style={{
                    display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                    width: '100%'
                  }}
                >
                  <div style={{
                    maxWidth: '85%',
                    background: isUser ? 'var(--primary)' : '#f1f5f9',
                    color: isUser ? 'white' : 'var(--text-main)',
                    padding: '0.85rem 1.1rem',
                    borderRadius: isUser ? '16px 16px 2px 16px' : '16px 16px 16px 2px',
                    fontSize: '0.875rem',
                    lineHeight: 1.5,
                    boxShadow: 'var(--shadow-sm)'
                  }}>
                    {msg.text.split('\n\n').map((paragraph, pIdx) => (
                      <p key={pIdx} style={{ margin: pIdx > 0 ? '0.5rem 0 0 0' : 0 }}>
                        {paragraph.split('**').map((chunk, cIdx) => 
                          cIdx % 2 === 1 ? <strong key={cIdx}>{chunk}</strong> : chunk
                        )}
                      </p>
                    ))}
                  </div>
                </div>
              );
            })}
            
            {/* Loading pulse bubble */}
            {isLoading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
                <div style={{
                  background: '#f1f5f9',
                  padding: '0.85rem 1.25rem',
                  borderRadius: '16px 16px 16px 2px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <span className="dot-pulse" style={{ width: '6px', height: '6px', backgroundColor: 'var(--text-light)', borderRadius: '50%', display: 'inline-block', animation: 'bounce 1.4s infinite ease-in-out both' }}></span>
                  <span className="dot-pulse" style={{ width: '6px', height: '6px', backgroundColor: 'var(--text-light)', borderRadius: '50%', display: 'inline-block', animation: 'bounce 1.4s infinite ease-in-out both', animationDelay: '0.2s' }}></span>
                  <span className="dot-pulse" style={{ width: '6px', height: '6px', backgroundColor: 'var(--text-light)', borderRadius: '50%', display: 'inline-block', animation: 'bounce 1.4s infinite ease-in-out both', animationDelay: '0.4s' }}></span>
                </div>
              </div>
            )}

            {/* Error Message alert */}
            {errorMsg && (
              <div style={{ background: '#fee2e2', border: '1px solid #fca5a5', padding: '0.75rem 1rem', borderRadius: '10px', color: '#991b1b', fontSize: '0.8rem', fontWeight: 500 }}>
                ⚠️ Error: {errorMsg}
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>

          {/* Quick Contextual Action Buttons */}
          <div className="chat-actions-container" style={{
            display: 'flex',
            gap: '0.5rem',
            flexWrap: 'wrap',
            marginBottom: '0.75rem'
          }}>
            {options && options.length > 0 ? (
              <>
                {options.map((option, idx) => (
                  <button 
                    key={idx}
                    onClick={() => {
                      const lowerOpt = option.toLowerCase();
                      
                      // Stage-specific routing for options
                      if (stage === 'title_brainstorm') {
                        if (
                          lowerOpt.includes('suggest') || 
                          lowerOpt.includes('more') || 
                          lowerOpt.includes('other') || 
                          lowerOpt.includes('different')
                        ) {
                          handleSendMessage(option);
                        } else {
                          // Plain title choice: approve it directly
                          handleApproveTitle(option);
                        }
                      } else if (stage === 'toc') {
                        if (
                          lowerOpt.includes('send toc') || 
                          lowerOpt.includes('approve toc') || 
                          lowerOpt.includes('send to document') ||
                          lowerOpt.includes('approve table of contents')
                        ) {
                          handleApproveToC();
                        } else {
                          handleSendMessage(option);
                        }
                      } else if (stage === 'section_brainstorm' || stage === 'section_edit') {
                        if (lowerOpt.includes('show speaker notes') || lowerOpt.includes('show notes')) {
                          handleShowSpeakerNotes();
                        } else if (lowerOpt.includes('send to document') || lowerOpt.includes('sent to document')) {
                          handleApproveSection();
                        } else if (lowerOpt.includes('regenerate draft') || lowerOpt.includes('regenerate notes')) {
                          handleRegenerateSection();
                        } else {
                          handleSendMessage(option);
                        }
                      } else if (stage === 'complete') {
                        if (lowerOpt.startsWith('edit section')) {
                          const match = option.match(/edit section\s+(\d+)/i);
                          if (match && match[1]) {
                            const secIdx = parseInt(match[1], 10) - 1;
                            handleStartSectionEdit(secIdx);
                          } else {
                            handleSendMessage(option);
                          }
                        } else {
                          handleSendMessage(option);
                        }
                      } else {
                        // Fallback/Legacy matching
                        if (lowerOpt.startsWith('approve title') || lowerOpt.includes('approve title:')) {
                          const approvedTitle = option.includes(':') 
                            ? option.split(':')[1].replace(/['"]+/g, '').trim() 
                            : topic;
                          handleApproveTitle(approvedTitle);
                        } else {
                          handleSendMessage(option);
                        }
                      }
                    }}
                    disabled={isLoading}
                    style={{
                      background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))',
                      color: 'white',
                      border: 'none',
                      borderRadius: '20px',
                      padding: '0.55rem 1.1rem',
                      fontSize: '0.825rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)',
                      transition: 'all 0.2s'
                    }}
                  >
                    {option}
                  </button>
                ))}
                

              </>
            ) : (
              <>
                {stage === 'toc' && toc.length > 0 && (
                  <button 
                    onClick={handleApproveToC}
                    disabled={isLoading}
                    style={{
                      background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.5rem 1rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    ✅ Send ToC to Document
                  </button>
                )}

                {(stage === 'section_brainstorm' || stage === 'section_edit') && !proposedSectionContent && (
                  <button 
                    onClick={handleShowSpeakerNotes}
                    disabled={isLoading}
                    style={{
                      background: 'linear-gradient(135deg, var(--primary), var(--primary-hover))',
                      color: 'white',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '0.5rem 1rem',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      boxShadow: 'var(--shadow-sm)'
                    }}
                  >
                    🔍 Show Speaker Notes for this Section
                  </button>
                )}

                {(stage === 'section_brainstorm' || stage === 'section_edit') && proposedSectionContent && (
                  <>
                    <button 
                      onClick={handleApproveSection}
                      disabled={isLoading}
                      style={{
                        background: 'linear-gradient(135deg, var(--success), #059669)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '0.5rem 1rem',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: 'var(--shadow-sm)'
                      }}
                    >
                      ✍️ Send to Document
                    </button>
                    <button 
                      onClick={handleRegenerateSection}
                      disabled={isLoading}
                      style={{
                        background: 'white',
                        border: '1px solid var(--border-light)',
                        color: 'var(--text-main)',
                        borderRadius: '8px',
                        padding: '0.5rem 1rem',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      🔄 Regenerate Draft
                    </button>
                  </>
                )}

                {stage === 'complete' && toc.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }}>
                    <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-light)' }}>
                      Click any section in the timeline at the top to revise it, or choose below:
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                      {toc.map((sec, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleStartSectionEdit(idx)}
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid var(--border-light)',
                            borderRadius: '12px',
                            padding: '0.4rem 0.75rem',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            cursor: 'pointer',
                            color: 'var(--text-muted)'
                          }}
                        >
                          ✏️ Edit {idx + 1}: ${sec.substring(0, 15)}...
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Chat Form Input */}
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
            style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
          >
            <textarea 
              ref={inputRef}
              className="form-input"
              value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={
                isLoading 
                  ? "AI is thinking..." 
                  : stage === 'title_brainstorm'
                    ? "Describe your topic or suggest a title..."
                    : "Type feedback or custom details for Gemini..."
              }
              disabled={isLoading}
              style={{
                flex: 1,
                borderRadius: '12px',
                border: '1px solid var(--border-light)',
                padding: '0.75rem 1rem',
                fontSize: '0.875rem',
                outline: 'none',
                height: '46px',
                resize: 'none',
                fontFamily: 'inherit',
                lineHeight: '1.4',
                overflowY: 'auto'
              }}
            />
            <button 
              type="submit"
              disabled={!inputValue.trim() || isLoading}
              style={{
                background: inputValue.trim() && !isLoading ? 'var(--primary)' : '#e2e8f0',
                color: inputValue.trim() && !isLoading ? 'white' : 'var(--text-light)',
                border: 'none',
                width: '46px',
                height: '46px',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: inputValue.trim() && !isLoading ? 'pointer' : 'default',
                transition: 'all 0.2s',
                flexShrink: 0
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M2.01 21L23 12L2.01 3L2 10L17 12L2 14L2.01 21Z" fill="currentColor"/>
              </svg>
            </button>
          </form>
        </div>

        {/* Right Side: Page-by-page A4 Preview */}
        <div className="preview-panel" style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
          borderRadius: '20px',
          boxShadow: 'var(--shadow-md)',
          border: '1px solid var(--border-light)',
          background: '#525659',
          minWidth: 0
        }}>
          <iframe 
            ref={iframeRef}
            title="Speaker Notes A4 Document Preview"
            style={{
              border: 'none',
              width: '100%',
              height: '100%',
              background: '#525659'
            }}
          />
        </div>
      </div>
      
      {/* Dynamic Keyframe Bounce Animation for Loading Indicator */}
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1.0); }
        }
      `}</style>
    </div>
  );
};

export default SpeakerNotesScreen;
