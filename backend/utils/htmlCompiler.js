const fs = require('fs');
const path = require('path');

// Helper to safely read files synchronously with a fallback
function safeReadFile(filePath, fallbackContent = "") {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  } catch (err) {
    // ignore
  }
  return fallbackContent;
}

/**
 * Loads AI-generated SVG assets for the active vibe theme.
 * @param {string} themeSlug - The active theme slug.
 * @returns {{ cornerTr: string, cornerBl: string, border: string, margin: string, bgPattern: string }}
 */
function loadThemeSvgs(themeSlug) {
  const svgDir = path.join(__dirname, '../templates/svgs', themeSlug);
  const loadSvg = (filename) => {
    try {
      const fp = path.join(svgDir, filename);
      return fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : '';
    } catch (_) { return ''; }
  };
  return {
    cornerTr:   loadSvg('corner_top_right.svg'),
    cornerBl:   loadSvg('corner_bottom_left.svg'),
    border:     loadSvg('border_ornament.svg'),
    margin:     loadSvg('margin_accent.svg'),
    bgPattern:  loadSvg('bg_pattern.svg'),
  };
}

/**
 * JSON-Level Section Splitting Validator (Content Validation).
 * Inspects each section's content sizes and splits them if they exceed strict capacity thresholds.
 * @param {Array} pages - Original pages array.
 * @returns {Array} New pages array with split sections.
 */
function validateAndSplitSections(pages) {
  const processedPages = [];

  for (const page of pages) {
    let sections = page.sections;
    if (!sections || !Array.isArray(sections)) {
      // Compatibility wrapper
      sections = [{
        ...page,
        sectionType: page.pageType || 'StandardTextBlock'
      }];
    }

    const newSectionsList = [];

    for (const section of sections) {
      const sectionType = section.sectionType || section.pageType || "";

      if (sectionType === 'StandardTextBlock' || sectionType === 'StandardText') {
        const bullets = section.bullets || [];
        // Threshold: split standard text lists if they exceed 6 bullets
        if (bullets.length > 6) {
          const chunkSize = 5;
          for (let k = 0; k < bullets.length; k += chunkSize) {
            const chunk = bullets.slice(k, k + chunkSize);
            newSectionsList.push({
              ...section,
              header: k === 0 ? section.header : `${section.header} (Continued)`,
              bullets: chunk
            });
          }
        } else {
          newSectionsList.push(section);
        }
      } 
      else if (sectionType === 'DataTable') {
        const rows = section.rows || [];
        const headers = section.headers || [];
        // Threshold: split data tables if they exceed 6 rows
        if (rows.length > 6) {
          const chunkSize = 5;
          for (let k = 0; k < rows.length; k += chunkSize) {
            const chunk = rows.slice(k, k + chunkSize);
            newSectionsList.push({
              ...section,
              header: k === 0 ? (section.header || 'Data Table') : `${section.header || 'Data Table'} (Continued)`,
              headers: headers,
              rows: chunk
            });
          }
        } else {
          newSectionsList.push(section);
        }
      }
      else if (sectionType === 'ProcessTimeline') {
        const steps = section.steps || [];
        // Threshold: split process timelines if they exceed 5 steps
        if (steps.length > 5) {
          const chunkSize = 4;
          for (let k = 0; k < steps.length; k += chunkSize) {
            const chunk = steps.slice(k, k + chunkSize);
            newSectionsList.push({
              ...section,
              header: k === 0 ? (section.header || 'Process Timeline') : `${section.header || 'Process Timeline'} (Continued)`,
              steps: chunk
            });
          }
        } else {
          newSectionsList.push(section);
        }
      }
      else {
        // Fallback: don't split other fixed layout shapes
        newSectionsList.push(section);
      }
    }

    processedPages.push({
      ...page,
      sections: newSectionsList
    });
  }

  return processedPages;
}

/**
 * Visual Weight Calculator for sections.
 * Returns the estimated vertical height weight percentage (0-100%).
 */
function calculateSectionWeight(section) {
  const sectionType = section.sectionType || section.pageType || "";
  
  if (sectionType === 'CoverBlock' || sectionType === 'CoverPage') return 100;
  if (sectionType === 'DataTable' || sectionType === 'ProcessTimeline') return 70;
  if (sectionType === 'MultiCardGrid') return 55;
  if (sectionType === 'TwoColumnBlock' || sectionType === 'TwoColumnSplit' || sectionType === 'MediaBlock' || sectionType === 'MixedMedia') return 45;
  if (sectionType === 'HeroCallout') return 35;
  
  if (sectionType === 'StandardTextBlock' || sectionType === 'StandardText') {
    const bulletsCount = (section.bullets || []).length;
    return 15 + (bulletsCount * 5); // 15% base + 5% per bullet
  }
  
  return 30; // default fallback weight
}

/**
 * Paging Reflow Algorithm (Sequential Shift & Smart Page Absorption).
 * Flattens all content sections and re-partitions them into A4 pages ensuring no page exceeds 100% weight.
 * @param {Array} pages - Split pages array.
 * @returns {Array} Reflowed and neatly partitioned pages array.
 */
/**
 * Dynamic Component Splitting Helper.
 * Checks if a section can be split mathematically based on the available weight budget.
 * Enforces a strict minimum of 2 items on both sides of a split to prevent widow/orphan elements.
 * Returns [SectionA, SectionB] if split is successful, or null if it cannot be split.
 */
function trySplitSection(section, availableWeight) {
  const sectionType = section.sectionType || section.pageType || "";
  const minItems = 2; // Widow/Orphan Protection: Min 2 items on both sides

  // 1. Standard Text Block (List of bullets)
  if (sectionType === 'StandardTextBlock' || sectionType === 'StandardText') {
    const bullets = section.bullets || [];
    if (bullets.length < minItems * 2) return null; // Need at least 4 bullets to split (2 on each side)

    // Formula: Weight = 15% base + count * 5%
    // count * 5 <= availableWeight - 15
    // count <= (availableWeight - 15) / 5
    const maxBullets = Math.floor((availableWeight - 15) / 5);
    if (maxBullets >= minItems && (bullets.length - maxBullets) >= minItems) {
      return [
        {
          ...section,
          bullets: bullets.slice(0, maxBullets)
        },
        {
          ...section,
          header: section.header ? `${section.header} (Continued)` : 'Key Focus (Continued)',
          bullets: bullets.slice(maxBullets)
        }
      ];
    }
  }

  // 2. Data Table (Rows)
  if (sectionType === 'DataTable') {
    const rows = section.rows || [];
    if (rows.length < minItems * 2) return null; // Need at least 4 rows to split

    // Formula: Weight = 20% base + count * 10%
    const maxRows = Math.floor((availableWeight - 20) / 10);
    if (maxRows >= minItems && (rows.length - maxRows) >= minItems) {
      return [
        {
          ...section,
          rows: rows.slice(0, maxRows)
        },
        {
          ...section,
          header: section.header ? `${section.header} (Continued)` : 'Data Table (Continued)',
          rows: rows.slice(maxRows)
        }
      ];
    }
  }

  // 3. Process Timeline (Steps)
  if (sectionType === 'ProcessTimeline') {
    const steps = section.steps || [];
    if (steps.length < minItems * 2) return null; // Need at least 4 steps to split

    // Formula: Weight = 20% base + count * 10%
    const maxSteps = Math.floor((availableWeight - 20) / 10);
    if (maxSteps >= minItems && (steps.length - maxSteps) >= minItems) {
      return [
        {
          ...section,
          steps: steps.slice(0, maxSteps)
        },
        {
          ...section,
          header: section.header ? `${section.header} (Continued)` : 'Process Timeline (Continued)',
          steps: steps.slice(maxSteps)
        }
      ];
    }
  }

  // 4. Multi Card Grid (Cards)
  if (sectionType === 'MultiCardGrid') {
    const cards = section.cards || [];
    if (cards.length < minItems * 2) return null; // Need at least 4 cards to split

    // Formula: Weight = 15% base + count * 10%
    const maxCards = Math.floor((availableWeight - 15) / 10);
    if (maxCards >= minItems && (cards.length - maxCards) >= minItems) {
      return [
        {
          ...section,
          cards: cards.slice(0, maxCards)
        },
        {
          ...section,
          header: section.header ? `${section.header} (Continued)` : 'Key Points (Continued)',
          cards: cards.slice(maxCards)
        }
      ];
    }
  }
  return null; // Cannot split
}

/**
 * Paging Reflow Algorithm (Fine-Grained Dynamic Component Splitting & Queue-Based Cascade).
 * Flattens all content sections and re-partitions them into A4 pages ensuring no page exceeds 100% weight,
 * dynamically splitting components at page boundaries to maximize page utilization.
 * @param {Array} pages - Split pages array.
 * @returns {Array} Reflowed and neatly partitioned pages array.
 */
function reflowPages(pages) {
  const reflowed = [];
  const normalSections = [];
  
  let basePageTitle = "Key Highlights";

  for (const page of pages) {
    const sections = page.sections || [];
    const hasCover = sections.some(s => s.sectionType === 'CoverBlock' || s.sectionType === 'CoverPage');

    if (hasCover) {
      reflowed.push(page);
    } else {
      if (page.pageTitle || page.title) {
        basePageTitle = page.pageTitle || page.title;
      }
      normalSections.push(...sections);
    }
  }

  if (normalSections.length === 0) {
    return reflowed;
  }

  let currentPageSections = [];
  let currentPageWeight = 0;
  let pageIndex = reflowed.length + 1;
  const queue = [...normalSections];

  // Infinite Loop Guard
  let loopGuard = 0;
  const maxLoops = queue.length * 10;

  while (queue.length > 0 && loopGuard < maxLoops) {
    loopGuard++;
    const section = queue.shift();
    const weight = calculateSectionWeight(section);

    if (currentPageWeight + weight <= 100) {
      // 1. Section fits completely on current page
      currentPageSections.push(section);
      currentPageWeight += weight;
    } else {
      // 2. Exceeds capacity: check if we can split it to fill the remaining space
      const availableWeight = 100 - currentPageWeight;
      const splitResult = trySplitSection(section, availableWeight);

      if (splitResult) {
        const [sectionA, sectionB] = splitResult;
        
        // Part A fits exactly in the remaining space of the current page
        currentPageSections.push(sectionA);
        
        // Push the full page
        reflowed.push({
          pageTitle: currentPageSections[0]?.header || `${basePageTitle} (Page ${pageIndex})`,
          sections: currentPageSections
        });
        pageIndex++;
        
        // Reset for the next page
        currentPageSections = [];
        currentPageWeight = 0;
        
        // Put Part B at the front of the queue to flow onto the next page
        queue.unshift(sectionB);
      } else {
        // 3. Cannot be split (or too small space): push the entire section to the next page
        if (currentPageSections.length > 0) {
          reflowed.push({
            pageTitle: currentPageSections[0]?.header || `${basePageTitle} (Page ${pageIndex})`,
            sections: currentPageSections
          });
          pageIndex++;
          currentPageSections = [];
          currentPageWeight = 0;
        }
        
        queue.unshift(section);
      }
    }
  }

  // Push the final remaining page
  if (currentPageSections.length > 0) {
    reflowed.push({
      pageTitle: currentPageSections[0]?.header || `${basePageTitle} (Page ${pageIndex})`,
      sections: currentPageSections
    });
  }

  return reflowed;
}

/**
 * Compiles page JSONs, themes, and palettes into a A4 print-ready HTML document.
 * @param {Array} pages - Array of page JSON objects.
 * @param {string} theme - Selected theme name (slug).
 * @param {string} palette - Selected palette name (slug).
 * @returns {{ html: string, json: Array }} Compiled HTML document and the reflowed JSON.
 */
function compileDocument(pages, theme, palette) {
  const templatesDir = path.join(__dirname, '../templates');
  
  // 1. Run Content Validation (Splitting) & the Paging Reflow Algorithm
  const splitPages = validateAndSplitSections(pages);
  const reflowedPages = reflowPages(splitPages);

  // 2. Load Core CSS Files
  const globalCss = safeReadFile(path.join(templatesDir, 'global.css'), '/* fallback global */');
  const localFontsCss = safeReadFile(path.join(templatesDir, 'local_fonts.css'), '');
  
  const themeSlug = (theme || 'formal_professional').replace(/[^a-zA-Z0-9_]/g, '');
  const paletteSlug = (palette || 'corporate_navy').replace(/[^a-zA-Z0-9_]/g, '');
  
  const themeCss = safeReadFile(
    path.join(templatesDir, 'themes', `${themeSlug}.css`), 
    safeReadFile(path.join(templatesDir, 'themes', 'formal_professional.css'), '')
  );

  const themeSvgs = loadThemeSvgs(themeSlug);
  const paletteCss = safeReadFile(
    path.join(templatesDir, 'palettes', `${paletteSlug}.css`), 
    safeReadFile(path.join(templatesDir, 'palettes', 'corporate_navy.css'), '')
  );

  // 3. Map JSON structures to Page HTML Blocks
  const compiledPages = [];
  const totalPages = reflowedPages.length;

  for (let i = 0; i < reflowedPages.length; i++) {
    const page = reflowedPages[i];
    const pageNum = i + 1;
    const sections = page.sections || [];

    let sectionsContent = "";
    let hasCover = false;

    for (const section of sections) {
      const sectionType = section.sectionType || section.pageType || "";
      let presetId = 'standard_text'; // Default fallback
      
      if (sectionType === 'CoverBlock' || sectionType === 'CoverPage') {
        presetId = 'cover';
        hasCover = true;
      }
      else if (sectionType === 'TwoColumnBlock' || sectionType === 'TwoColumnSplit') presetId = 'two_column';
      else if (sectionType === 'MultiCardGrid') presetId = 'grid';
      else if (sectionType === 'ProcessTimeline') presetId = 'timeline';
      else if (sectionType === 'DataTable') presetId = 'table';
      else if (sectionType === 'HeroCallout') presetId = 'callout';
      else if (sectionType === 'MediaBlock' || sectionType === 'MixedMedia') presetId = 'media_wrapped';
      else if (sectionType === 'StandardTextBlock' || sectionType === 'StandardText') presetId = 'standard_text';

      const templateHtml = safeReadFile(
        path.join(templatesDir, 'components', `${presetId}.html`),
        '<!-- fallback --><div class="card"><h3>{{title}}</h3></div>'
      );

      let compiledSection = templateHtml;

      // Compile section based on its template type
      if (presetId === 'cover') {
        compiledSection = compiledSection
          .replace(/{{title}}/g, section.title || page.pageTitle || 'Key Highlights')
          .replace(/{{subtitle}}/g, section.subtitle || '')
          .replace(/{{author}}/g, section.author || 'Presenter')
          .replace(/{{date}}/g, section.date || 'June 2026')
          .replace(/{{footer}}/g, section.footer || '');
      } 
      else if (presetId === 'two_column') {
        const leftHeader = section.leftColumnHeader || 'Concept Summary';
        const rightHeader = section.rightColumnHeader || 'Key Takeaways';
        
        const leftBullets = (section.leftColumnBullets || [])
          .map(b => `<li>${b}</li>`)
          .join('\n');
        const rightBullets = (section.rightColumnBullets || [])
          .map(b => `<li>${b}</li>`)
          .join('\n');

        compiledSection = compiledSection
          .replace(/{{leftColumnHeader}}/g, leftHeader)
          .replace(/{{rightColumnHeader}}/g, rightHeader)
          .replace(/{{leftColumnBullets}}/g, leftBullets)
          .replace(/{{rightColumnBullets}}/g, rightBullets);
      }
      else if (presetId === 'grid') {
        const cardList = section.cards || [];
        const cardsGridHtml = cardList
          .slice(0, 4)
          .map(c => `
            <div class="card">
              <h4 class="card-title">${c.header || 'Key Point'}</h4>
              <div class="card-body">${c.content || 'Supporting details.'}</div>
            </div>
          `)
          .join('\n');

        compiledSection = compiledSection.replace(/{{cardsGrid}}/g, cardsGridHtml);
      }
      else if (presetId === 'timeline') {
        const stepsList = section.steps || [];
        const timelineHtml = stepsList
          .slice(0, 5)
          .map((s, idx) => `
            <div class="timeline-item">
              <div class="timeline-badge">${s.stepNumber || (idx + 1)}</div>
              <div class="timeline-card">
                <h4 class="timeline-card-header">${s.header || 'Milestone'}</h4>
                <p class="timeline-card-desc">${s.description || 'Details about this milestone.'}</p>
              </div>
            </div>
          `)
          .join('\n');

        compiledSection = compiledSection.replace(/{{timelineSteps}}/g, timelineHtml);
      }
      else if (presetId === 'table') {
        const headers = section.headers || ['Topic', 'Details'];
        const rows = section.rows || [['Sample Row', 'Sample Details']];
        
        const thHtml = headers.map(h => `<th>${h}</th>`).join('');
        const tbHtml = rows
          .map(row => {
            const cells = row.map(cell => `<td>${cell}</td>`).join('');
            return `<tr>${cells}</tr>`;
          })
          .join('\n');

        const tableContentHtml = `
          <thead>
            <tr>${thHtml}</tr>
          </thead>
          <tbody>
            ${tbHtml}
          </tbody>
        `;

        compiledSection = compiledSection.replace(/{{tableContent}}/g, tableContentHtml);
      }
      else if (presetId === 'callout') {
        compiledSection = compiledSection
          .replace(/{{quoteText}}/g, section.quoteText || 'A single focus point holds the greatest impact.')
          .replace(/{{author}}/g, section.author || 'Key Insight')
          .replace(/{{highlightText}}/g, section.highlightText || 'Focus core energy on actionable milestones.');
      }
      else if (presetId === 'media_wrapped') {
        let mediaBlockHtml = '';
        if (section.imageId) {
          mediaBlockHtml = `
            <div class="media-container ${section.resolvedClass || 'float-right'}">
              <img src="/extracted_media/${section.imageId}" alt="${section.caption || 'Slide illustration'}" />
              <div class="image-caption">${section.caption || 'Figure: Slide graphic'}</div>
            </div>
          `;
        }

        const bulletsHtml = (section.bullets || [])
          .map(b => `<li>${b}</li>`)
          .join('\n');

        compiledSection = compiledSection
          .replace(/{{mediaBlock}}/g, mediaBlockHtml)
          .replace(/{{textContent}}/g, section.textContent || '')
          .replace(/{{bulletsList}}/g, bulletsHtml);
      }
      else if (presetId === 'standard_text') {
        const bulletsHtml = (section.bullets || [])
          .map(b => `<li>${b}</li>`)
          .join('\n');

        compiledSection = compiledSection
          .replace(/{{header}}/g, section.header || 'Key Focus')
          .replace(/{{bullets}}/g, bulletsHtml);
      }

      sectionsContent += compiledSection + "\n";
    }

    if (hasCover) {
      compiledPages.push(sectionsContent);
    } else {
      const pageShell = safeReadFile(path.join(templatesDir, 'page_shell.html'), '{{sectionsContent}}');
      const pageTitle = page.pageTitle || page.title || 'Key Highlights';
      
      const compiledPage = pageShell
        .replace(/{{pageTitle}}/g, pageTitle)
        .replace(/{{sectionsContent}}/g, sectionsContent)
        .replace(/{{PAGE_NUM}}/g, pageNum)
        .replace(/{{TOTAL_PAGES}}/g, totalPages)
        .replace(/{{AI_SVG_CORNER_TR}}/g,  themeSvgs.cornerTr)
        .replace(/{{AI_SVG_CORNER_BL}}/g,  themeSvgs.cornerBl)
        .replace(/{{AI_SVG_BORDER}}/g,     themeSvgs.border)
        .replace(/{{AI_SVG_MARGIN}}/g,     themeSvgs.margin)
        .replace(/{{AI_SVG_BG_PATTERN}}/g, themeSvgs.bgPattern);

      compiledPages.push(compiledPage);
    }
  }

  // 4. Assemble complete HTML shell
  const htmlOutput = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Takeaway Notes</title>
  <style>
    /* Local font declarations */
    ${localFontsCss}

    /* Global layout foundation */
    ${globalCss}
    
    /* Active Vibe Theme Axis */
    ${themeCss}
    
    /* Active Color Palette Axis */
    ${paletteCss}
  </style>
</head>
<body>
  ${compiledPages.join('\n')}
</body>
</html>`;

  return {
    html: htmlOutput,
    json: reflowedPages
  };
}

/**
 * Compiles Speaker Notes sections into a distraction-free, local, print-safe HTML document.
 * Utilizing Inter + Lora typography. Supports options for Cover + ToC isolation.
 * @param {Array} sections - Array of speaker notes section strings or objects.
 * @param {string} title - Presentation Title.
 * @param {string} subtitle - Presentation Subtitle.
 * @param {Object} options - Custom options: { toc: Array, excludeCover: boolean, excludeContent: boolean }
 * @returns {string} Fully compiled Speaker Notes HTML document.
 */
function compileSpeakerNotes(sections, title, subtitle, options = {}) {
  const templatesDir = path.join(__dirname, '../templates');
  const localFontsCss = safeReadFile(path.join(templatesDir, 'local_fonts.css'), '');
  const speakerNotesCss = safeReadFile(path.join(templatesDir, 'themes', 'speaker_notes.css'), '');
  const standardTemplate = safeReadFile(path.join(templatesDir, 'components', 'speaker_notes_standard.html'), '');

  const compiledBlocks = [];

  sections.forEach((section, idx) => {
    let sectionTitle = `Section ${idx + 1}`;
    let notesContent = "";

    if (typeof section === 'string') {
      notesContent = section;
    } else if (section && typeof section === 'object') {
      sectionTitle = section.title || section.header || sectionTitle;
      notesContent = section.content || section.notesContent || "";
    }

    const compiledBlock = standardTemplate
      .replace(/{{sectionIndex}}/g, idx)
      .replace(/{{title}}/g, sectionTitle)
      .replace(/{{notesContent}}/g, notesContent);

    compiledBlocks.push(compiledBlock);
  });

  // Compile ToC list items if requested
  let tocHtml = "";
  if (options.toc && Array.isArray(options.toc)) {
    tocHtml = options.toc.map((item, idx) => `
      <div class="toc-item" style="display: flex; justify-content: space-between; align-items: flex-end; font-size: 14px; font-weight: 500; color: #334155; margin-bottom: 14px; font-family: 'Inter', sans-serif;">
        <span class="toc-title-wrapper" style="display: flex; align-items: center; flex-shrink: 0;">
          <span class="toc-number-badge" style="background: #f1f5f9; color: #475569; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; margin-right: 10px;">${idx + 1}</span>
          <span style="font-size: 14px; font-weight: 600; color: #1e293b;">${item}</span>
        </span>
        <span class="toc-item-dots" style="flex-grow: 1; border-bottom: 2px dotted #cbd5e1; margin: 0 10px; position: relative; top: -4px;"></span>
        <span class="toc-page-num" style="color: #475569; font-weight: 700; font-size: 14px; flex-shrink: 0; white-space: nowrap;">Page ${idx + 2}</span>
      </div>
    `).join('');
  }

  const pages = [];

  // Page 1: Cover and Table of Contents
  if (!options.excludeCover) {
    const coverHtml = `
      <div class="page" id="page-1">
        <div style="text-align: center; margin-top: 40px; margin-bottom: 30px;">
          <h1 class="title">${title || 'Presentation Title'}</h1>
          <p class="subtitle">${subtitle || 'Speaker Notes'}</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #cbd5e1; margin: 30px 0;">
        <h2 class="section-title">Table of Contents</h2>
        <div class="toc-list" style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 40px;">
          ${tocHtml || `
            <div style="text-align: center; color: #94a3b8; font-family: 'Inter', sans-serif; font-size: 11pt; padding: 20px;">
              No sections defined in the outline yet.
            </div>
          `}
        </div>
        <div class="page-footer">
          <span>${title || 'Speaker Notes'}</span>
          <span>Page 1</span>
        </div>
      </div>
    `;
    pages.push(coverHtml);
  }

  // Page 2: Standard Content Page
  if (!options.excludeContent && compiledBlocks.length > 0) {
    const pageId = options.excludeCover ? "page-1" : "page-2";
    const pageNum = options.excludeCover ? 1 : 2;
    const contentHtml = `
      <div class="page" id="${pageId}">
        <div class="section-content-container" style="padding-bottom: 20mm;">
          ${compiledBlocks.join('\n')}
        </div>
        <div class="page-footer">
          <span>${title || 'Speaker Notes'}</span>
          <span>Page ${pageNum}</span>
        </div>
      </div>
    `;
    pages.push(contentHtml);
  }

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'Speaker Notes'}</title>
  <style>
    /* Local font declarations */
    ${localFontsCss}

    /* Distraction-Free Stylesheet */
    ${speakerNotesCss}
  </style>
</head>
<body>
  ${pages.join('\n')}
</body>
</html>`;

  return fullHtml;
}

module.exports = {
  compileDocument,
  compileSpeakerNotes
};
