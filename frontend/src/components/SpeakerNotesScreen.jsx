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
  const [, setOptions] = useState([]);
  const [chatSummary, setChatSummary] = useState('');
  const [lastSummarizedIndex, setLastSummarizedIndex] = useState(0);

  // Initial chat setup
  const [chatHistory, setChatHistory] = useState([
    { 
      role: 'model', 
      text: "Welcome to the AI Presentation Assistant! Let's start by brainstorming a title or topic for your presentation.\n\nWhat is the general subject or ideas you are thinking about? I will suggest some good titles for us to choose from!",
      stage: 'title_brainstorm',
      sectionIndex: 0
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
              height: 297mm !important;
              padding: 25mm 20mm 25mm 20mm !important;
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

            @media print {
              html, body {
                background-color: white !important;
                padding: 0 !important;
                margin: 0 !important;
                display: block !important;
              }
              .page {
                box-shadow: none !important;
                margin: 0 !important;
                width: 210mm !important;
                height: 297mm !important;
                page-break-after: always !important;
                break-after: page !important;
                border-radius: 0 !important;
                padding: 25mm 20mm 25mm 20mm !important;
                box-sizing: border-box !important;
                display: block !important;
              }
              .section-block {
                page-break-inside: avoid !important;
                break-inside: avoid !important;
              }
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

      setTimeout(() => {
        try {
          const iframeDoc = iframeRef.current?.contentDocument;
          if (!iframeDoc) return;

          const pages = iframeDoc.querySelectorAll('.page');
          const page1 = iframeDoc.getElementById('page-1');
          const pageHeight = page1?.offsetHeight || 1122;

          let needsRepaginate = false;
          const parser = new DOMParser();
          const doc = parser.parseFromString(`<body>${documentHtml}</body>`, 'text/html');

          // 1. Clean up empty pages (except page-1 and page-2)
          let docModified = false;
          const domPages = doc.querySelectorAll('.page');
          for (let i = 2; i < domPages.length; i++) {
            const domPage = domPages[i];
            const container = domPage.querySelector('.section-content-container');
            if (container) {
              const hasText = container.textContent.trim().length > 0;
              const hasImages = container.querySelector('img') !== null;
              if (!hasText && !hasImages) {
                domPage.remove();
                docModified = true;
              }
            }
          }
          if (docModified) {
            setDocumentHtml(doc.body.innerHTML);
            return;
          }

          // 2. Pagination Check (Overflow & Split)
          for (let i = 1; i < domPages.length; i++) {
            const iframePage = pages[i];
            const domPage = domPages[i];

            if (iframePage && domPage && iframePage.scrollHeight > pageHeight) {
              const domContainer = domPage.querySelector('.section-content-container');
              if (domContainer) {
                const domBlocks = domContainer.querySelectorAll('.section-block');
                if (domBlocks.length > 0) {
                  needsRepaginate = true;

                  const lastBlock = domBlocks[domBlocks.length - 1];
                  const lastBlockIndex = lastBlock.getAttribute('data-section-index');
                  const lastBlockContent = lastBlock.querySelector('.section-content');
                  
                  if (lastBlockContent) {
                    const contentChildren = lastBlockContent.children;
                    
                    // If the last block ends with a list (ul or ol), split the list items!
                    const lastChild = contentChildren[contentChildren.length - 1];
                    const isList = lastChild && (lastChild.tagName === 'UL' || lastChild.tagName === 'OL');
                    
                    if (isList && lastChild.children.length > 1) {
                      // Move the last <li> element of the list
                      const lastLi = lastChild.lastElementChild;
                      const lastLiHtml = lastLi.outerHTML;
                      lastLi.remove();

                      const originalListTag = lastChild.tagName; // UL or OL
                      const startVal = parseInt(lastChild.getAttribute('start') || '1', 10);
                      const originalListItemsCount = lastChild.children.length;

                      const nextPageNum = i + 2;
                      const nextDomPage = domPages[i + 1];

                      if (nextDomPage) {
                        const nextContainer = nextDomPage.querySelector('.section-content-container');
                        let firstBlockOnNextPage = nextContainer.querySelector(`.section-block[data-section-index="${lastBlockIndex}"]`);
                        
                        if (firstBlockOnNextPage) {
                          const nextContent = firstBlockOnNextPage.querySelector('.section-content');
                          let firstChildOfNext = nextContent.firstElementChild;
                          
                          if (firstChildOfNext && firstChildOfNext.tagName === originalListTag) {
                            // Prepend to existing list on next page
                            firstChildOfNext.insertAdjacentHTML('afterbegin', lastLiHtml);
                            if (originalListTag === 'OL') {
                              firstChildOfNext.setAttribute('start', String(startVal + originalListItemsCount));
                            }
                          } else {
                            // Create a new list container at the top of the next block
                            const listHtml = originalListTag === 'OL'
                              ? `<ol start="${startVal + originalListItemsCount}">${lastLiHtml}</ol>`
                              : `<ul>${lastLiHtml}</ul>`;
                            nextContent.insertAdjacentHTML('afterbegin', listHtml);
                          }
                        } else {
                          // Create a new block starting with a list container
                          const listHtml = originalListTag === 'OL'
                            ? `<ol start="${startVal + originalListItemsCount}">${lastLiHtml}</ol>`
                            : `<ul>${lastLiHtml}</ul>`;
                          const newBlockHtml = `
                            <div class="section-block" data-section-index="${lastBlockIndex}" style="margin-bottom: 24px;">
                              <div class="section-content">
                                ${listHtml}
                              </div>
                            </div>
                          `;
                          nextContainer.insertAdjacentHTML('afterbegin', newBlockHtml);
                        }
                      } else {
                        // Create a new page with a new list container
                        const listHtml = originalListTag === 'OL'
                          ? `<ol start="${startVal + originalListItemsCount}">${lastLiHtml}</ol>`
                          : `<ul>${lastLiHtml}</ul>`;
                        const newPageHtml = `
                          <div class="page" id="page-${nextPageNum}">
                            <div class="section-content-container" style="padding-bottom: 20mm;">
                              <div class="section-block" data-section-index="${lastBlockIndex}" style="margin-bottom: 24px;">
                                <div class="section-content">
                                  ${listHtml}
                                </div>
                              </div>
                            </div>
                            <div class="page-footer">
                              <span>${topic || 'Speaker Notes'}</span>
                              <span>Page ${nextPageNum}</span>
                            </div>
                          </div>
                        `;
                        doc.body.insertAdjacentHTML('beforeend', newPageHtml);
                      }
                    } else if (contentChildren.length > 1) {
                      // If the last block has multiple paragraphs/elements (not lists), split the last element
                      const lastChild = contentChildren[contentChildren.length - 1];
                      const lastChildHtml = lastChild.outerHTML;
                      lastChild.remove();

                      const nextPageNum = i + 2;
                      const nextDomPage = domPages[i + 1];

                      if (nextDomPage) {
                        const nextContainer = nextDomPage.querySelector('.section-content-container');
                        let firstBlockOnNextPage = nextContainer.querySelector(`.section-block[data-section-index="${lastBlockIndex}"]`);
                        if (firstBlockOnNextPage) {
                          const nextContent = firstBlockOnNextPage.querySelector('.section-content');
                          nextContent.insertAdjacentHTML('afterbegin', lastChildHtml);
                        } else {
                          const newBlockHtml = `
                            <div class="section-block" data-section-index="${lastBlockIndex}" style="margin-bottom: 24px;">
                              <div class="section-content">
                                ${lastChildHtml}
                              </div>
                            </div>
                          `;
                          nextContainer.insertAdjacentHTML('afterbegin', newBlockHtml);
                        }
                      } else {
                        const newPageHtml = `
                          <div class="page" id="page-${nextPageNum}">
                            <div class="section-content-container" style="padding-bottom: 20mm;">
                              <div class="section-block" data-section-index="${lastBlockIndex}" style="margin-bottom: 24px;">
                                <div class="section-content">
                                  ${lastChildHtml}
                                </div>
                              </div>
                            </div>
                            <div class="page-footer">
                              <span>${topic || 'Speaker Notes'}</span>
                              <span>Page ${nextPageNum}</span>
                            </div>
                          </div>
                        `;
                        doc.body.insertAdjacentHTML('beforeend', newPageHtml);
                      }
                    } else {
                      // Move the entire section block if there are other blocks on this page
                      if (domBlocks.length > 1) {
                        const lastBlockHtml = lastBlock.outerHTML;
                        lastBlock.remove();

                        const nextPageNum = i + 2;
                        const nextDomPage = domPages[i + 1];

                        if (nextDomPage) {
                          const nextContainer = nextDomPage.querySelector('.section-content-container');
                          nextContainer.insertAdjacentHTML('afterbegin', lastBlockHtml);
                        } else {
                          const newPageHtml = `
                            <div class="page" id="page-${nextPageNum}">
                              <div class="section-content-container" style="padding-bottom: 20mm;">
                                ${lastBlockHtml}
                              </div>
                              <div class="page-footer">
                                <span>${topic || 'Speaker Notes'}</span>
                                <span>Page ${nextPageNum}</span>
                              </div>
                            </div>
                          `;
                          doc.body.insertAdjacentHTML('beforeend', newPageHtml);
                        }
                      } else {
                        needsRepaginate = false;
                      }
                    }
                  }

                  if (needsRepaginate) break;
                }
              }
            }
          }

          if (needsRepaginate) {
            setDocumentHtml(doc.body.innerHTML);
            return;
          }

          // 3. Dynamic Page Numbers lookup in ToC
          if (page1) {
            toc.forEach((sec, idx) => {
              const section = iframeDoc.querySelector(`.section-block[data-section-index="${idx}"]`);
              const tocPageSpan = iframeDoc.getElementById(`toc-page-num-${idx}`);
              
              if (section && tocPageSpan) {
                let parentPage = section.closest('.page');
                if (parentPage) {
                  const pageId = parentPage.id;
                  const match = pageId.match(/page-(\d+)/);
                  if (match && match[1]) {
                    tocPageSpan.innerText = `Page ${match[1]}`;
                  }
                }
              }
            });
          }

        } catch (e) {
          console.error("Error in dynamic pagination or ToC page updating:", e);
        }
      }, 100);
    }
  }, [documentHtml, toc]);

  // Adjust Zoom Level
  useEffect(() => {
    if (iframeRef.current) {
      const doc = iframeRef.current.contentDocument || iframeRef.current.contentWindow.document;
      if (doc && doc.body) {
        doc.body.style.zoom = `${zoom}%`;
      }
    }
  }, [zoom, documentHtml]);

  const handleOptionClick = (option) => {
    const lowerOpt = option.toLowerCase();
    
    if (stage === 'title_brainstorm') {
      if (
        lowerOpt.includes('suggest') || 
        lowerOpt.includes('more') || 
        lowerOpt.includes('other') || 
        lowerOpt.includes('different')
      ) {
        handleSendMessage(option, undefined, undefined, undefined, undefined, undefined, option);
      } else {
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
        handleSendMessage(option, undefined, undefined, undefined, undefined, undefined, option);
      }
    } else if (stage === 'section_brainstorm' || stage === 'section_edit') {
      if (lowerOpt.includes('show speaker notes') || lowerOpt.includes('show notes')) {
        handleShowSpeakerNotes();
      } else if (lowerOpt.includes('send to document') || lowerOpt.includes('sent to document')) {
        handleApproveSection();
      } else {
        handleSendMessage(option, undefined, undefined, undefined, undefined, undefined, option);
      }
    } else if (stage === 'complete') {
      if (lowerOpt.startsWith('edit section')) {
        const match = option.match(/edit section\s+(\d+)/i);
        if (match && match[1]) {
          const secIdx = parseInt(match[1], 10) - 1;
          handleStartSectionEdit(secIdx);
        } else {
          handleSendMessage(option, undefined, undefined, undefined, undefined, undefined, option);
        }
      } else {
        handleSendMessage(option, undefined, undefined, undefined, undefined, undefined, option);
      }
    } else {
      if (lowerOpt.startsWith('approve title') || lowerOpt.includes('approve title:')) {
        const approvedTitle = option.includes(':') 
          ? option.split(':')[1].replace(/['"]+/g, '').trim() 
          : topic;
        handleApproveTitle(approvedTitle);
      } else {
        handleSendMessage(option, undefined, undefined, undefined, undefined, undefined, option);
      }
    }
  };

  // --- AI Chat Actions ---

  const handleSendMessage = async (textToSend, stageOverride, topicOverride, indexOverride, tocOverride, documentHtmlOverride, displayTextToSend) => {
    const text = textToSend || inputValue;
    if (!text.trim() || isLoading) return;

    setErrorMsg(null);
    setInputValue('');
    setOptions([]); // Clear options immediately on message send

    const activeStage = stageOverride !== undefined ? stageOverride : stage;
    const activeTopic = topicOverride !== undefined ? topicOverride : topic;
    const activeIndex = indexOverride !== undefined ? indexOverride : currentSectionIndex;
    const activeToc = tocOverride !== undefined ? tocOverride : toc;
    const activeDocumentHtml = documentHtmlOverride !== undefined ? documentHtmlOverride : documentHtml;

    const newHistory = [...chatHistory, { 
      role: 'user', 
      text,
      displayText: displayTextToSend || (textToSend ? textToSend : undefined),
      stage: activeStage,
      sectionIndex: activeIndex
    }];
    setChatHistory(newHistory);
    setIsLoading(true);

    // Filter messages to send only the active stage/section messages to backend
    const activeMessages = newHistory.filter(msg => {
      // Always include the latest user message
      if (msg === newHistory[newHistory.length - 1]) return true;

      if (activeStage === 'section_brainstorm' || activeStage === 'section_edit') {
        return msg.stage === activeStage && msg.sectionIndex === activeIndex;
      }
      return msg.stage === activeStage;
    });

    const extractPartialReply = (accumulatedStr) => {
      const match = accumulatedStr.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
      if (match) {
        return match[1]
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
      return "";
    };

    try {
      const response = await fetch(`${BACKEND_URL}/api/chat-speaker-notes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: activeMessages,
          chatSummary: chatSummary,
          currentDocument: activeDocumentHtml,
          toc: activeToc,
          currentSectionIndex: activeIndex,
          stage: activeStage,
          topic: activeTopic
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.message || 'An error occurred while communicating with the assistant.');
      }

      // Add a temporary model message to the history that we will update in real-time
      setChatHistory(prev => [...prev, { 
        role: 'model', 
        text: '',
        stage: activeStage,
        sectionIndex: activeIndex,
        isStreaming: true,
        options: []
      }]);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || "";

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data: ')) continue;

          const dataStr = line.slice(6).trim();
          if (dataStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(dataStr);
            if (parsed.error) {
              throw new Error(parsed.error);
            }
            if (parsed.chunk) {
              accumulatedText += parsed.chunk;
              const streamingReply = extractPartialReply(accumulatedText);

              // Update the streaming reply in the chat log in real-time
              setChatHistory(prev => {
                const nextHistory = [...prev];
                const lastMsg = nextHistory[nextHistory.length - 1];
                if (lastMsg && lastMsg.role === 'model') {
                  lastMsg.text = streamingReply;
                }
                return nextHistory;
              });
            }
          } catch (e) {
            console.error("Error parsing stream chunk:", e);
          }
        }
      }

      // Parse the fully completed JSON payload
      const finalData = JSON.parse(accumulatedText.trim());

      // Update the final model message in the chat log
      setChatHistory(prev => {
        const nextHistory = [...prev];
        const lastMsg = nextHistory[nextHistory.length - 1];
        if (lastMsg && lastMsg.role === 'model') {
          lastMsg.text = finalData.reply;
          lastMsg.stage = finalData.nextStage || activeStage;
          lastMsg.sectionIndex = finalData.currentSectionIndex !== undefined ? finalData.currentSectionIndex : activeIndex;
          lastMsg.toc = finalData.toc || activeToc;
          lastMsg.proposedSectionContent = finalData.proposedSectionContent;
          lastMsg.options = finalData.options || [];
          lastMsg.isStreaming = false;
        }
        return nextHistory;
      });

      // Update remaining structured states
      if (finalData.topic) {
        setTopic(finalData.topic);
      }
      if (finalData.toc && finalData.toc.length > 0) {
        setToc(finalData.toc);
      }
      if (finalData.nextStage) {
        setStage(finalData.nextStage);
      }
      if (finalData.currentSectionIndex !== undefined) {
        setCurrentSectionIndex(finalData.currentSectionIndex);
      }
      if (finalData.proposedSectionContent) {
        setProposedSectionContent(finalData.proposedSectionContent);
      } else {
        setProposedSectionContent(null);
      }
      if (finalData.options && finalData.options.length > 0) {
        setOptions(finalData.options);
      } else {
        setOptions([]);
      }

    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Failed to communicate with presentation assistant.');
      
      // Clean up history to remove failed bubbles
      setChatHistory(prev => {
        let nextHistory = [...prev];
        if (nextHistory[nextHistory.length - 1]?.role === 'model') {
          nextHistory = nextHistory.slice(0, -1);
        }
        if (nextHistory[nextHistory.length - 1]?.role === 'user') {
          nextHistory = nextHistory.slice(0, -1);
        }
        return nextHistory;
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Effect to automatically summarize completed sections/stages
  useEffect(() => {
    const triggerSummarization = async () => {
      if (chatHistory.length === 0) return;

      const completedMessages = [];
      let nextSummarizeIndex = lastSummarizedIndex;

      for (let i = lastSummarizedIndex; i < chatHistory.length; i++) {
        const msg = chatHistory[i];
        const isMsgActive = (stage === 'section_brainstorm' || stage === 'section_edit')
          ? (msg.stage === stage && msg.sectionIndex === currentSectionIndex)
          : (msg.stage === stage);

        if (!isMsgActive) {
          completedMessages.push(msg);
          nextSummarizeIndex = i + 1;
        } else {
          break; // Stop at the first active message
        }
      }

      const messagesToSummarize = completedMessages.filter(m => m.text && m.text.trim());

      if (messagesToSummarize.length > 0) {
        try {
          const response = await fetch(`${BACKEND_URL}/api/summarize-chats`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ messages: messagesToSummarize })
          });
          const data = await response.json();
          if (response.ok && data.summary) {
            setChatSummary(prev => {
              const prefix = prev ? `${prev}\n\n` : '';
              return `${prefix}${data.summary}`;
            });
            setLastSummarizedIndex(nextSummarizeIndex);
          }
        } catch (err) {
          console.error("Failed to summarize completed chats:", err);
        }
      } else if (nextSummarizeIndex > lastSummarizedIndex) {
        // If there were messages but none of them had valid text to summarize, just advance
        setLastSummarizedIndex(nextSummarizeIndex);
      }
    };

    triggerSummarization();
  }, [stage, currentSectionIndex, chatHistory, lastSummarizedIndex]);

  // Helper: Approve title and switch to scope brainstorming
  const handleApproveTitle = (titleValue) => {
    const finalTitle = titleValue || topic || 'Speaker Notes';
    setTopic(finalTitle);
    setStage('topic_scope');

    // Generate draft cover page with the approved title immediately
    const draftCoverHtml = `
      <div class="page" id="page-1">
        <div style="text-align: center; margin-top: 60px; margin-bottom: 50px;">
          <h1 class="title">${finalTitle}</h1>
          <p class="subtitle">Presentation Speaker Notes</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 40px 0;">
        <div style="border: 2px dashed #e2e8f0; border-radius: 12px; padding: 40px; text-align: center; color: #94a3b8; font-size: 14px; margin-top: 40px;">
          📚 Brainstorming presentation scope... Outline and notes will appear here once Table of Contents is approved.
        </div>
        <div class="page-footer">
          <span>${finalTitle}</span>
        </div>
      </div>
    `;
    setDocumentHtml(draftCoverHtml);

    handleSendMessage(
      `I approve the title: "${finalTitle}". Let's start brainstorming the talking points and scope of the presentation.`,
      'topic_scope',
      finalTitle,
      undefined,
      undefined,
      draftCoverHtml,
      `Approve Title: "${finalTitle}"`
    );
  };

  // Helper: Format and write the ToC page to document
  const applyToCApproval = (tocList, finalTopic) => {
    const titleToUse = finalTopic || topic || 'Speaker Notes';
    const tocHtml = tocList.map((item, idx) => `
      <div class="toc-item" style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 500; color: #334155; margin-bottom: 10px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
        <span style="display: flex; align-items: center;">
          <span style="background: #f1f5f9; color: #475569; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.75rem; margin-right: 10px;">${idx + 1}</span>
          <span>${item}</span>
        </span>
        <span id="toc-page-num-${idx}" class="toc-page-num" style="color: #64748b; font-weight: 600; font-size: 0.8rem;"></span>
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
        <div class="toc-list" style="display: flex; flex-direction: column; gap: 4px;">
          ${tocHtml}
        </div>
        <div class="page-footer">
          <span>${titleToUse}</span>
        </div>
      </div>
      <div class="page" id="page-2">
        <div id="section-content-container" class="section-content-container" style="padding-bottom: 20mm;"></div>
        <div class="page-footer">
          <span>${titleToUse}</span>
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
    
    // Parse current documentHtml using DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${documentHtml}</body>`, 'text/html');
    
    const targetBlocks = doc.querySelectorAll(`.section-block[data-section-index="${currentSectionIndex}"]`);
    
    // Delete all existing blocks for this section
    targetBlocks.forEach(b => b.remove());
    
    const blockContent = `
      <div class="section-block" data-section-index="${currentSectionIndex}" style="margin-bottom: 24px;">
        ${currentSectionIndex > 0 ? '<hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 12px 0 20px 0;">' : ''}
        <div class="section-content">
          ${sectionHtml}
        </div>
      </div>
    `;
    
    // Find all remaining section blocks to determine correct insertion position
    const allBlocks = Array.from(doc.querySelectorAll('.section-block'));
    const preBlocks = allBlocks.filter(b => parseInt(b.getAttribute('data-section-index') || '0', 10) < currentSectionIndex);
    
    if (preBlocks.length > 0) {
      // Insert immediately after the preceding section block
      const anchorBlock = preBlocks[preBlocks.length - 1];
      anchorBlock.insertAdjacentHTML('afterend', blockContent);
    } else {
      const postBlocks = allBlocks.filter(b => parseInt(b.getAttribute('data-section-index') || '0', 10) > currentSectionIndex);
      if (postBlocks.length > 0) {
        // Insert immediately before the succeeding section block
        const anchorBlock = postBlocks[0];
        anchorBlock.insertAdjacentHTML('beforebegin', blockContent);
      } else {
        // No other blocks exist, append to page-2 container
        const page2Container = doc.querySelector('#page-2 .section-content-container');
        if (page2Container) {
          page2Container.insertAdjacentHTML('beforeend', blockContent);
        } else {
          console.warn("Could not find page-2 content container to insert section!");
        }
      }
    }
    
    const updatedHtml = doc.body.innerHTML;
    setDocumentHtml(updatedHtml);

    if (stage === 'section_edit') {
      setStage('complete');
    } else {
      const nextIdx = currentSectionIndex + 1;
      setCurrentSectionIndex(nextIdx);
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
      updatedHtml,
      "Send Table of Contents to Document"
    );
  };

  const handleShowSpeakerNotes = () => {
    handleSendMessage(
      "Generate and show the speaker notes draft for this section.",
      stage,
      topic,
      currentSectionIndex,
      toc,
      documentHtml,
      "Show Speaker Notes"
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
        updatedHtml,
        "Send to Document"
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
        updatedHtml,
        "Send to Document"
      );
    } else {
      handleSendMessage(
        `Send these notes to the document. That was the last section!`,
        'complete',
        topic,
        nextIdx,
        toc,
        updatedHtml,
        "Send to Document"
      );
    }
  };



  const handleStartSectionEdit = (index) => {
    if (index < 0 || index >= toc.length) return;
    setCurrentSectionIndex(index);
    setStage('section_edit');
    setProposedSectionContent(null);
    
    // Extract text content from all split blocks of this section to show the AI
    const iframeDoc = iframeRef.current?.contentDocument;
    let currentNotesText = '';
    if (iframeDoc) {
      const targetBlocks = iframeDoc.querySelectorAll(`.section-block[data-section-index="${index}"]`);
      const texts = Array.from(targetBlocks).map(b => b.innerText || b.textContent || '');
      currentNotesText = texts.join('\n\n');
    }

    handleSendMessage(
      `I would like to edit Section ${index + 1}: "${toc[index]}". Here is the current text: "${currentNotesText.substring(0, 1000)}". Ask me what changes I want to make first.`,
      'section_edit',
      topic,
      index,
      toc,
      undefined,
      `Edit Section ${index + 1}: "${toc[index]}"`
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
          {/* Focus & Progress Status Bar */}
          <div className="chat-status-bar" style={{
            background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
            padding: '0.75rem 1rem',
            borderRadius: '12px',
            border: '1px solid var(--border-light)',
            marginBottom: '1rem',
            fontSize: '0.8rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.02)'
          }}>
            <style>{`
              @keyframes pulse-focus {
                0% { transform: scale(0.95); opacity: 0.8; }
                50% { transform: scale(1.1); opacity: 1; }
                100% { transform: scale(0.95); opacity: 0.8; }
              }
            `}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                display: 'inline-block',
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: stage === 'complete' ? '#10b981' : '#6366f1',
                boxShadow: stage === 'complete' ? '0 0 8px #10b981' : '0 0 8px #6366f1',
                animation: stage === 'complete' ? 'none' : 'pulse-focus 2s infinite ease-in-out'
              }}></span>
              <span style={{ fontWeight: 600, color: '#475569' }}>Focus:</span>
              <span style={{ color: '#0f172a', fontWeight: 700 }}>
                {stage === 'title_brainstorm' && 'Title Brainstorming'}
                {stage === 'topic_scope' && 'Defining Topic Scope'}
                {stage === 'toc' && 'Table of Contents Outline'}
                {stage === 'section_brainstorm' && `Brainstorming Section ${currentSectionIndex + 1}: ${toc[currentSectionIndex] || ''}`}
                {stage === 'section_edit' && `Editing Section ${currentSectionIndex + 1}: ${toc[currentSectionIndex] || ''}`}
                {stage === 'complete' && 'Presentation Completed! 🎉'}
              </span>
            </div>
            {toc.length > 0 && (stage === 'section_brainstorm' || stage === 'section_edit' || stage === 'complete') && (
              <div style={{ color: '#64748b', fontSize: '0.75rem', fontWeight: 600 }}>
                Progress: {stage === 'complete' ? toc.length : currentSectionIndex + 1} / {toc.length}
              </div>
            )}
          </div>

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
                    {(msg.displayText || msg.text).split('\n\n').map((paragraph, pIdx) => (
                      <p key={pIdx} style={{ margin: pIdx > 0 ? '0.5rem 0 0 0' : 0 }}>
                        {paragraph.split('**').map((chunk, cIdx) => 
                          cIdx % 2 === 1 ? <strong key={cIdx}>{chunk}</strong> : chunk
                        )}
                      </p>
                    ))}

                    {/* Inline Table of Contents Card */}
                    {!isUser && msg.toc && msg.toc.length > 0 && msg.stage === 'toc' && (
                      <div style={{
                        marginTop: '0.75rem',
                        background: 'white',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        padding: '0.85rem 1rem',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px'
                      }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          📋 Proposed Table of Contents:
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          {msg.toc.map((sec, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', color: '#334155' }}>
                              <span style={{
                                background: '#f1f5f9',
                                color: '#475569',
                                borderRadius: '50%',
                                width: '20px',
                                height: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '0.75rem'
                              }}>{idx + 1}</span>
                              <span style={{ fontWeight: 500 }}>{sec}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Inline Speaker Notes Draft Card */}
                    {!isUser && msg.proposedSectionContent && (
                      <div style={{
                        marginTop: '0.75rem',
                        background: 'white',
                        borderRadius: '12px',
                        border: '1px solid #e2e8f0',
                        padding: '1rem',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
                        color: 'var(--text-main)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}>
                        <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', borderBottom: '1px solid #e2e8f0', paddingBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          📝 Proposed Speaker Notes Draft:
                        </div>
                        <div 
                          className="proposed-draft-html"
                          dangerouslySetInnerHTML={{ __html: msg.proposedSectionContent }} 
                          style={{ fontSize: '0.8rem', lineHeight: 1.5 }}
                        />
                        {/* Action buttons shown only if this message matches active stage and section */}
                        {msg.stage === stage && msg.sectionIndex === currentSectionIndex && (stage === 'section_brainstorm' || stage === 'section_edit') && index === chatHistory.length - 1 && (
                          <div style={{ display: 'flex', gap: '8px', marginTop: '4px', borderTop: '1px solid #f1f5f9', paddingTop: '10px' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleApproveSection();
                              }}
                              disabled={isLoading}
                              style={{
                                background: 'linear-gradient(135deg, #10b981, #059669)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '0.45rem 0.9rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-sm)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              ✍️ Send to Document
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Inline Suggested Option Buttons */}
                    {index === chatHistory.length - 1 && msg.options && msg.options.length > 0 && !isLoading && (
                      <div style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                        marginTop: '10px',
                        borderTop: '1px solid #e2e8f0',
                        paddingTop: '8px'
                      }}>
                        {msg.options
                          .filter(option => {
                            const lowerOpt = option.toLowerCase();
                            
                            // 1. Filter out Regenerate Draft completely
                            if (lowerOpt.includes('regenerate draft') || lowerOpt.includes('regenerate notes') || lowerOpt.trim() === 'regenerate') {
                              return false;
                            }
                            
                            // 2. Filter out Send to Document if the inline green button is already shown
                            const hasInlineSendButton = msg.stage === stage && msg.sectionIndex === currentSectionIndex && (stage === 'section_brainstorm' || stage === 'section_edit') && index === chatHistory.length - 1 && msg.proposedSectionContent;
                            if (hasInlineSendButton && (lowerOpt.includes('send to document') || lowerOpt.includes('sent to document') || lowerOpt.includes('approve section'))) {
                              return false;
                            }
                            
                            return true;
                          })
                          .map((option, optIdx) => (
                            <button
                              key={optIdx}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOptionClick(option);
                              }}
                              style={{
                                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                padding: '0.45rem 0.9rem',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                                boxShadow: 'var(--shadow-sm)',
                                transition: 'all 0.2s',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              {option}
                            </button>
                          ))}
                      </div>
                    )}
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
                    : "Type feedback or custom details for AI..."
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
