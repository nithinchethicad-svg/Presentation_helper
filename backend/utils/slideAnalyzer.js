const AdmZip = require('adm-zip');
const path = require('path');

/**
 * Analyzes presentation slide complexity and groups slides into page allocations.
 * Implements a Smart Fractional Splitting Algorithm for optimal page budgeting.
 * @param {Buffer} fileBuffer - The file buffer.
 * @param {string} originalName - The original file name.
 * @returns {Promise<Array>} List of page allocations with slide indices.
 */
async function analyzeSlides(fileBuffer, originalName) {
  const ext = originalName.split('.').pop().toLowerCase();
  
  // Default fallback for non-PPTX files (e.g. DOCX or TXT)
  if (ext !== 'pptx') {
    return [
      { pageNumber: 1, slideIndices: [1], complexity: 10, isCover: true, title: "Cover Page" }
    ];
  }

  try {
    const zip = new AdmZip(fileBuffer);
    const zipEntries = zip.getEntries();
    
    // 1. Find and sort slide entries
    const slideEntries = zipEntries.filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/));
    slideEntries.sort((a, b) => {
      const numA = parseInt(a.entryName.match(/\d+/)[0], 10);
      const numB = parseInt(b.entryName.match(/\d+/)[0], 10);
      return numA - numB;
    });

    if (slideEntries.length === 0) {
      return [{ pageNumber: 1, slideIndices: [1], complexity: 10, isCover: true, title: "Cover Page" }];
    }

    const slideData = [];

    // 2. Parse each slide for complexity metrics
    for (let i = 0; i < slideEntries.length; i++) {
      const entry = slideEntries[i];
      const slideIndex = i + 1;
      const xml = entry.getData().toString('utf8');

      // A. Word Count
      let wordCount = 0;
      const textRuns = xml.match(/<a:t>([^<]*)<\/a:t>/g);
      if (textRuns) {
        textRuns.forEach(tMatch => {
          const text = tMatch.slice(5, -6).trim();
          if (text) {
            wordCount += text.split(/\s+/).filter(Boolean).length;
          }
        });
      }

      // B. Table Count
      const tableCount = (xml.match(/<a:tbl\b/g) || []).length;

      // C. Image / Picture Count
      const imageCount = (xml.match(/<p:pic\b/g) || []).length;

      // D. Shape / Container Count
      const shapeCount = (xml.match(/<p:sp\b/g) || []).length;

      // E. Slide Title Extraction
      let slideTitle = "";
      const shapes = xml.split('</p:sp>');
      for (const shape of shapes) {
        if (shape.includes('type="title"') || shape.includes('type="ctrTitle"') || shape.includes('type="subTitle"')) {
          const titleRuns = shape.match(/<a:t>([^<]*)<\/a:t>/g);
          if (titleRuns) {
            slideTitle = titleRuns.map(t => t.slice(5, -6)).join(' ').trim();
            break;
          }
        }
      }
      
      if (!slideTitle && textRuns) {
        for (const tMatch of textRuns) {
          const text = tMatch.slice(5, -6).trim();
          if (text.length > 3 && text.length < 80 && !text.includes('{') && !text.includes('}')) {
            slideTitle = text;
            break;
          }
        }
      }

      // Complexity Score: S = (W * 0.1) + (T * 15) + (P * 10) + (G * 2)
      const complexityScore = (wordCount * 0.1) + (tableCount * 15) + (imageCount * 10) + (shapeCount * 2);

      slideData.push({
        slideIndex,
        title: slideTitle || `Slide ${slideIndex}`,
        wordCount,
        tableCount,
        imageCount,
        shapeCount,
        complexity: Math.max(5, Math.round(complexityScore)) // Minimum 5 points
      });
    }

    // Inherit missing titles sequentially
    for (let i = 0; i < slideData.length; i++) {
      if (slideData[i].title.startsWith('Slide ') && i > 0) {
        const prevTitle = slideData[i - 1].title;
        if (prevTitle && !prevTitle.startsWith('Slide ')) {
          slideData[i].title = prevTitle;
        }
      }
    }

    // 3. Smart Page Budgeting & Fractional Splitting Algorithm
    const pageAllocations = [];
    const MAX_PAGE_COMPLEXITY = 50;

    // Cover Page (Slide 1 is always alone on Page 1)
    pageAllocations.push({
      pageNumber: 1,
      slideIndices: [1],
      complexity: slideData[0].complexity,
      isCover: true,
      title: slideData[0].title
    });

    let currentPageNumber = 2;
    let currentGroup = [];
    let currentGroupComplexity = 0;

    for (let i = 1; i < slideData.length; i++) {
      const slide = slideData[i];
      const isHeavy = slide.tableCount > 0 || slide.complexity >= 35;

      if (isHeavy) {
        // Heavy slide: Flush current group if not empty
        if (currentGroup.length > 0) {
          pageAllocations.push({
            pageNumber: currentPageNumber,
            slideIndices: currentGroup.map(g => g.slideIndex),
            complexity: currentGroupComplexity,
            isCover: false,
            title: currentGroup[0].title,
            sections: currentGroup
          });
          currentPageNumber++;
        }

        // Add heavy slide on its own page and immediately flush
        pageAllocations.push({
          pageNumber: currentPageNumber,
          slideIndices: [slide.slideIndex],
          complexity: slide.complexity,
          isCover: false,
          title: slide.title,
          sections: [{
            slideIndex: slide.slideIndex,
            title: slide.title,
            complexity: slide.complexity
          }]
        });
        currentPageNumber++;
        
        // Reset current group
        currentGroup = [];
        currentGroupComplexity = 0;
      } else {
        // Light slide: Pack sequentially
        if (currentGroupComplexity + slide.complexity <= MAX_PAGE_COMPLEXITY && currentGroup.length < 3) {
          currentGroup.push({
            slideIndex: slide.slideIndex,
            title: slide.title,
            complexity: slide.complexity
          });
          currentGroupComplexity += slide.complexity;
        } else {
          // Exceeds page budget. Evaluate split opportunity!
          const R = MAX_PAGE_COMPLEXITY - currentGroupComplexity;
          
          // If remaining space is substantial (R >= 15) and slide is heavy enough to split (S_i >= 20)
          if (R >= 15 && slide.complexity >= 20 && currentGroup.length < 3) {
            const complexityPart1 = R;
            const complexityPart2 = Math.max(5, slide.complexity - R);

            // Add Part 1 to current page group
            currentGroup.push({
              slideIndex: slide.slideIndex,
              title: slide.title,
              complexity: complexityPart1,
              isSplitPart: 1,
              splitSlideIndex: slide.slideIndex
            });

            // Flush current page group
            pageAllocations.push({
              pageNumber: currentPageNumber,
              slideIndices: currentGroup.map(g => g.slideIndex),
              complexity: MAX_PAGE_COMPLEXITY,
              isCover: false,
              title: currentGroup[0].title,
              isSplitPart: 1,
              splitSlideIndex: slide.slideIndex,
              sections: currentGroup
            });
            currentPageNumber++;

            // Start next page group with Part 2
            currentGroup = [{
              slideIndex: slide.slideIndex,
              title: `${slide.title} (Continued)`,
              complexity: complexityPart2,
              isSplitPart: 2,
              splitSlideIndex: slide.slideIndex
            }];
            currentGroupComplexity = complexityPart2;
          } else {
            // No-split: Flush current group and push entire slide to next page
            if (currentGroup.length > 0) {
              pageAllocations.push({
                pageNumber: currentPageNumber,
                slideIndices: currentGroup.map(g => g.slideIndex),
                complexity: currentGroupComplexity,
                isCover: false,
                title: currentGroup[0].title,
                sections: currentGroup
              });
              currentPageNumber++;
            }

            // Start new page group with current slide
            currentGroup = [{
              slideIndex: slide.slideIndex,
              title: slide.title,
              complexity: slide.complexity
            }];
            currentGroupComplexity = slide.complexity;
          }
        }
      }
    }

    // Flush any remaining page group
    if (currentGroup.length > 0) {
      pageAllocations.push({
        pageNumber: currentPageNumber,
        slideIndices: currentGroup.map(g => g.slideIndex),
        complexity: currentGroupComplexity,
        isCover: false,
        title: currentGroup[0].title,
        sections: currentGroup
      });
    }

    return pageAllocations;

  } catch (error) {
    // Graceful fallback: 1 slide per page
    const fallbackAllocations = [];
    const estimatedLength = ext === 'pptx' ? 10 : 1;
    for (let i = 1; i <= estimatedLength; i++) {
      fallbackAllocations.push({
        pageNumber: i,
        slideIndices: [i],
        complexity: 10,
        isCover: i === 1,
        title: i === 1 ? "Cover Page" : `Section ${i}`
      });
    }
    return fallbackAllocations;
  }
}

module.exports = {
  analyzeSlides
};

