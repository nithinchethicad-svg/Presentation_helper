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
 * Returns empty strings for any assets that haven't been generated yet
 * (CSS hides the slots by default, so missing files are a no-op).
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
 * Compiles page JSONs, themes, and palettes into a single A4 print-ready HTML document.
 * Supporting a Section-Block Composite Page Architecture.
 * @param {Array} pages - Array of page JSON objects.
 * @param {string} theme - Selected theme name (slug, e.g. 'formal_professional').
 * @param {string} palette - Selected palette name (slug, e.g. 'corporate_navy').
 * @returns {string} Fully compiled HTML document.
 */
function compileDocument(pages, theme, palette) {
  const templatesDir = path.join(__dirname, '../templates');
  
  // 1. Load Axis CSS Files
  const globalCss = safeReadFile(path.join(templatesDir, 'global.css'), '/* fallback global */');
  const localFontsCss = safeReadFile(path.join(templatesDir, 'local_fonts.css'), '');
  
  // Clean theme & palette slugs for security (allow alphanumeric and underscores only)
  const themeSlug = (theme || 'formal_professional').replace(/[^a-zA-Z0-9_]/g, '');
  const paletteSlug = (palette || 'corporate_navy').replace(/[^a-zA-Z0-9_]/g, '');
  
  const themeCss = safeReadFile(
    path.join(templatesDir, 'themes', `${themeSlug}.css`), 
    safeReadFile(path.join(templatesDir, 'themes', 'formal_professional.css'), '')
  );

  // Load AI-generated SVG decorations for this theme (empty strings if not yet generated)
  const themeSvgs = loadThemeSvgs(themeSlug);
  const paletteCss = safeReadFile(
    path.join(templatesDir, 'palettes', `${paletteSlug}.css`), 
    safeReadFile(path.join(templatesDir, 'palettes', 'corporate_navy.css'), '')
  );

  // 2. Map JSON structures to Page HTML Blocks
  const compiledPages = [];
  const totalPages = pages.length;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const pageNum = i + 1;
    
    // Resolve sections (handling both new nested schema and legacy flat page schemas)
    let sections = page.sections;
    if (!sections || !Array.isArray(sections)) {
      // Backwards compatibility: Wrap flat page fields as a single section block
      sections = [{
        ...page,
        sectionType: page.pageType || 'StandardTextBlock'
      }];
    }

    let sectionsContent = "";
    let hasCover = false;

    for (const section of sections) {
      let sectionType = section.sectionType || section.pageType || "";
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

      let templateHtml = safeReadFile(
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
          .slice(0, 4) // max 4 cards
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
          .slice(0, 5) // max 5 steps
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
      // Cover pages are self-contained layouts containing their own .page wrapper and styles.
      // We don't wrap them in the master page shell (omits headers, footers, and page numbers naturally).
      compiledPages.push(sectionsContent);
    } else {
      // Normal pages: wrap dynamic section stack inside the print-safe A4 master page shell.
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

  // 3. Assemble complete HTML shell
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

  return htmlOutput;
}

module.exports = {
  compileDocument
};

