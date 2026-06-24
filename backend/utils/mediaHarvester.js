const AdmZip = require('adm-zip');
const sizeOf = require('image-size');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sharp;
try {
  sharp = require('sharp');
} catch (e) {
  // sharp is not installed, fallback gracefully to raw buffers
}

// Create directory if it doesn't exist
const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

/**
 * Parses PPTX/DOCX buffer, extracts images, maps them to headers, and calculates sizing.
 * @param {Buffer} fileBuffer - The file buffer.
 * @param {string} originalName - The original filename.
 * @param {string} outputDir - Directory to save extracted images.
 * @returns {Promise<Array>} List of extracted and mapped image objects.
 */
async function harvestMedia(fileBuffer, originalName, outputDir) {
  const ext = originalName.split('.').pop().toLowerCase();
  if (ext !== 'pptx' && ext !== 'docx') {
    return []; // Only support OpenXML PPTX/DOCX
  }

  ensureDirExists(outputDir);
  const fileHash = crypto.createHash('md5').update(fileBuffer).digest('hex').substring(0, 8);
  const zip = new AdmZip(fileBuffer);
  const zipEntries = zip.getEntries();

  const mediaMap = new Map(); // Maps zip path (e.g. 'ppt/media/image1.png') to extracted public URL
  const extractedImages = [];

  // 1. Extract all media files to disk and index them
  for (const entry of zipEntries) {
    const entryName = entry.entryName;
    const isMedia = entryName.startsWith('ppt/media/') || entryName.startsWith('word/media/');
    
    if (isMedia && !entry.isDirectory) {
      const buffer = entry.getData();
      const filename = path.basename(entryName);
      const fileExt = filename.split('.').pop().toLowerCase();
      
      // We only want standard web-friendly image formats
      if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(fileExt)) {
        const baseName = filename.substring(0, filename.lastIndexOf('.')) || filename;
        const uniqueBaseName = `img_${fileHash}_${baseName}`;
        
        let uniqueName = `${uniqueBaseName}.${fileExt}`;
        let outputPath = path.join(outputDir, uniqueName);
        let isCompressed = false;
        
        // Attempt to compress png/jpg/jpeg to WebP if sharp is available
        if (sharp && ['png', 'jpg', 'jpeg'].includes(fileExt)) {
          const webpName = `${uniqueBaseName}.webp`;
          const webpPath = path.join(outputDir, webpName);
          
          try {
            await sharp(buffer)
              .webp({ quality: 85 })
              .toFile(webpPath);
            
            uniqueName = webpName;
            outputPath = webpPath;
            isCompressed = true;
          } catch (err) {
            // Graceful fallback to original buffer on compression error
          }
        }
        
        if (!isCompressed) {
          fs.writeFileSync(outputPath, buffer);
        }
        
        // Read pixel dimensions to calculate Aspect Ratio
        let width = 800;
        let height = 600;
        try {
          const dimensions = sizeOf(outputPath);
          width = dimensions.width || 800;
          height = dimensions.height || 600;
        } catch (e) {
          // Ignore dimensions read error, fallback to default
        }

        mediaMap.set(entryName, {
          publicPath: `/extracted_media/${uniqueName}`,
          width,
          height,
          aspectRatio: width / height
        });
      }
    }
  }

  if (mediaMap.size === 0) {
    return []; // No media files found
  }

  // 2. Parse XML to map images to slides/headings and calculate area coverage
  if (ext === 'pptx') {
    return parsePptxLayout(zip, mediaMap, fileHash);
  } else {
    return parseDocxLayout(zip, mediaMap, fileHash);
  }
}

/**
 * Parses PPTX slides to map images to slide headers and calculate Area Coverage.
 */
function parsePptxLayout(zip, mediaMap, fileHash) {
  const extractedImages = [];

  // Get slide size (EMUs) from ppt/presentation.xml (Default to widescreen: 12192000 x 6858000)
  let slideWidth = 12192000;
  let slideHeight = 6858000;
  const presentationEntry = zip.getEntry('ppt/presentation.xml');
  if (presentationEntry) {
    const xml = presentationEntry.getData().toString('utf8');
    const sizeMatch = xml.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
    if (sizeMatch) {
      slideWidth = parseInt(sizeMatch[1], 10);
      slideHeight = parseInt(sizeMatch[2], 10);
    }
  }
  const totalSlideArea = slideWidth * slideHeight;

  // Track slide headers to handle missing titles via inheritance
  const slideHeaders = [];
  const slideImageRefs = []; // Array of [{ slideIndex, relId, cx, cy, embed }]

  // Read all slide XML and slide relationships
  const entries = zip.getEntries();
  const slideEntries = entries.filter(e => e.entryName.match(/^ppt\/slides\/slide\d+\.xml$/));
  
  // Sort slide entries numerically: slide1.xml, slide2.xml, ...
  slideEntries.sort((a, b) => {
    const numA = parseInt(a.entryName.match(/\d+/)[0], 10);
    const numB = parseInt(b.entryName.match(/\d+/)[0], 10);
    return numA - numB;
  });

  for (let i = 0; i < slideEntries.length; i++) {
    const slideEntry = slideEntries[i];
    const slideIndex = i + 1;
    const slideXml = slideEntry.getData().toString('utf8');
    
    // A. Extract Slide Title/Header
    let slideTitle = "";
    
    // Match titles inside designated placeholder shapes
    const shapes = slideXml.split('</p:sp>');
    for (const shape of shapes) {
      if (shape.includes('type="title"') || shape.includes('type="ctrTitle"') || shape.includes('type="subTitle"')) {
        const textRuns = shape.match(/<a:t>([^<]*)<\/a:t>/g);
        if (textRuns) {
          slideTitle = textRuns.map(t => t.slice(5, -6)).join(' ').trim();
          break;
        }
      }
    }
    
    // Fallback: Use the very first non-empty text element (between 3 and 100 characters)
    if (!slideTitle) {
      const allTextRuns = slideXml.match(/<a:t>([^<]*)<\/a:t>/g);
      if (allTextRuns) {
        for (const tMatch of allTextRuns) {
          const text = tMatch.slice(5, -6).trim();
          if (text.length > 3 && text.length < 100 && !text.includes('{') && !text.includes('}')) {
            slideTitle = text;
            break;
          }
        }
      }
    }
    
    slideHeaders.push(slideTitle || `Slide ${slideIndex}`);

    // B. Parse Slide Relationships to map relationship IDs to target media files
    const relsEntryName = `ppt/slides/_rels/${path.basename(slideEntry.entryName)}.rels`;
    const relsEntry = zip.getEntry(relsEntryName);
    const relIdToPath = new Map();
    
    if (relsEntry) {
      const relsXml = relsEntry.getData().toString('utf8');
      const relRegex = /<Relationship\s+[^>]*?Id="([^"]+)"\s+[^>]*?Type="[^"]*?relationships\/image"\s+[^>]*?Target="([^"]+)"/g;
      let match;
      while ((match = relRegex.exec(relsXml)) !== null) {
        const id = match[1];
        let target = match[2];
        
        // Resolve relative path: "../media/image1.png" -> "ppt/media/image1.png"
        if (target.startsWith('../')) {
          target = 'ppt/' + target.substring(3);
        }
        relIdToPath.set(id, target);
      }
    }

    // C. Find all picture shapes (`<p:pic>`) in the slide XML to get sizes
    // Regex matches the picture embed relation and its width (cx) and height (cy) extents
    const picRegex = /<p:pic>[\s\S]*?<a:blip[^>]*?r:embed="([^"]+)"[\s\S]*?<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/g;
    let picMatch;
    while ((picMatch = picRegex.exec(slideXml)) !== null) {
      const embedId = picMatch[1];
      const cx = parseInt(picMatch[2], 10);
      const cy = parseInt(picMatch[3], 10);
      
      const mediaPath = relIdToPath.get(embedId);
      if (mediaPath && mediaMap.has(mediaPath)) {
        slideImageRefs.push({
          slideIndex,
          mediaPath,
          cx,
          cy,
          coverage: (cx * cy) / totalSlideArea
        });
      }
    }
  }

  // Inherit slide titles for slides without titles
  for (let i = 0; i < slideHeaders.length; i++) {
    if (slideHeaders[i].startsWith('Slide ') && i > 0) {
      // If slide has no header, inherit the header of the previous slide
      const prevHeader = slideHeaders[i - 1];
      if (prevHeader && !prevHeader.startsWith('Slide ')) {
        slideHeaders[i] = prevHeader;
      }
    }
  }

  // 3. Process image references and resolve CSS classes using the Layout Matrix
  slideImageRefs.forEach((ref) => {
    const media = mediaMap.get(ref.mediaPath);
    const slideHeader = slideHeaders[ref.slideIndex - 1] || `Slide ${ref.slideIndex}`;
    
    const coverage = ref.coverage;
    const R = media.aspectRatio;
    
    let resolvedClass = 'img-float-wide'; // Default fallback
    let layoutType = 'float_right';
    
    if (coverage >= 0.35) {
      if (R >= 1.4) {
        resolvedClass = 'img-hero-landscape';
        layoutType = 'full_width';
      } else {
        resolvedClass = 'img-hero-split';
        layoutType = 'split_column';
      }
    } else if (coverage < 0.05) {
      resolvedClass = 'img-inline-icon';
      layoutType = 'inline_icon';
    } else {
      if (R >= 1.4) {
        resolvedClass = 'img-float-wide';
        layoutType = 'float_right';
      } else {
        resolvedClass = 'img-float-compact';
        layoutType = 'float_right';
      }
    }

    extractedImages.push({
      id: path.basename(media.publicPath),
      src: media.publicPath,
      slideIndex: ref.slideIndex,
      slideHeader: slideHeader,
      resolvedClass,
      layoutType,
      aspectRatio: R,
      slideCoverage: coverage,
      caption: `Figure: Embedded slide graphic from "${slideHeader}"`
    });
  });

  return extractedImages;
}

/**
 * Parses DOCX file to map images to the current active text header.
 */
function parseDocxLayout(zip, mediaMap, fileHash) {
  const extractedImages = [];
  const docEntry = zip.getEntry('word/document.xml');
  if (!docEntry) return [];

  const docXml = docEntry.getData().toString('utf8');

  // Parse DOCX Relationships
  const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
  const relIdToPath = new Map();
  if (relsEntry) {
    const relsXml = relsEntry.getData().toString('utf8');
    const relRegex = /<Relationship\s+[^>]*?Id="([^"]+)"\s+[^>]*?Type="[^"]*?relationships\/image"\s+[^>]*?Target="([^"]+)"/g;
    let match;
    while ((match = relRegex.exec(relsXml)) !== null) {
      const id = match[1];
      let target = match[2];
      if (target.startsWith('media/')) {
        target = 'word/' + target;
      }
      relIdToPath.set(id, target);
    }
  }

  // Scan sequentially through document XML
  // We split the document XML by paragraph (`<w:p>`) to map images to headings
  const paragraphs = docXml.split('</w:p>');
  let currentHeader = "Introduction";

  paragraphs.forEach((para) => {
    // Check if this paragraph is a heading
    const styleMatch = para.match(/<w:pStyle\s+w:val="Heading(\d+)"/);
    if (styleMatch) {
      const textRuns = para.match(/<w:t>([^<]*)<\/w:t>/g);
      if (textRuns) {
        const headingText = textRuns.map(t => t.slice(5, -6)).join(' ').trim();
        if (headingText) {
          currentHeader = headingText;
        }
      }
    }

    // Check for images in this paragraph
    // In DOCX, images are embedded inside `<wp:docPr>` or `<a:blip>` tags
    const blipRegex = /<a:blip[^>]*?r:embed="([^"]+)"[\s\S]*?<wp:extent\s+cx="(\d+)"\s+cy="(\d+)"/g;
    let blipMatch;
    while ((blipMatch = blipRegex.exec(para)) !== null) {
      const embedId = blipMatch[1];
      const cx = parseInt(blipMatch[2], 10);
      const cy = parseInt(blipMatch[3], 10);

      const mediaPath = relIdToPath.get(embedId);
      if (mediaPath && mediaMap.has(mediaPath)) {
        const media = mediaMap.get(mediaPath);
        const R = media.aspectRatio;

        // In DOCX we don't have slide area, so we use cx (width in EMUs) as importance
        // Widescreen page printable width is approx. 6,000,000 EMUs
        const isProminent = cx >= 4500000;
        
        let resolvedClass = 'img-float-wide';
        let layoutType = 'float_right';

        if (isProminent) {
          if (R >= 1.4) {
            resolvedClass = 'img-hero-landscape';
            layoutType = 'full_width';
          } else {
            resolvedClass = 'img-hero-split';
            layoutType = 'split_column';
          }
        } else {
          if (R >= 1.4) {
            resolvedClass = 'img-float-wide';
            layoutType = 'float_right';
          } else {
            resolvedClass = 'img-float-compact';
            layoutType = 'float_right';
          }
        }

        extractedImages.push({
          id: path.basename(media.publicPath),
          src: media.publicPath,
          slideHeader: currentHeader,
          resolvedClass,
          layoutType,
          aspectRatio: R,
          caption: `Figure: Embedded illustration from "${currentHeader}"`
        });
      }
    }
  });

  return extractedImages;
}

module.exports = {
  harvestMedia
};
