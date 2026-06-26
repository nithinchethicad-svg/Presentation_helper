# AI Slidekick 🚀

AI Slidekick (formerly AI Presentation Assistant) is a powerful, production-grade presentation companion suite designed to help you brainstorm and create structured speaker notes, design visual slide outlines, and publish polished, print-ready takeaway notes/handouts. Built with a modern **React (Vite) frontend** and a **Node.js Express backend**, it leverages Google Gemini models with key rotation, fallback cascading, a smart, print-safe layout compilation engine, and a complete Developer Tools diagnostic portal.

---

## 🏗️ Application Overview & Architecture

The application is structured into four primary modules, unified under a beautiful responsive dashboard:

1. **AI Speaker Notes Generator** 🎙️
   - An interactive, section-by-section presentation coach chat workspace.
   - Brainstorms presentation topics, develops a structured Table of Contents, and drafts comprehensive page-by-page speaker notes.
   - Provides live side-by-side A4 document previews inside a sandboxed iframe.
   - Features **line-level list pagination** that cleanly splits content and updates list item numbering across page breaks.
   - Features a premium horizontal branding header featuring the **AI Slidekick** logo lockup.

2. **AI Takeaway Notes Generator** ⚡
   - Automatically generates styled, high-impact handouts and summaries from uploaded slide decks (`.pptx`) or word documents (`.docx`).
   - Supports rich styling preferences like tone, detail level, and target audience.
   - Offers six pre-configured visual themes (Warm & Encouraging, Formal & Professional, Fun & Energetic, Reflective & Thoughtful, Educational & Informative, Motivational & Inspiring).

3. **Developer Tools Admin Portal & Telemetry Suite** 🛠️
   - A secure, dedicated console for developers and administrators to monitor system health, test API key quotas, override keys, and analyze operational costs.
   - Accessed via a collapsible, automatic hover-expanding sidebar that transitions smoothly between expanded and collapsed states.

4. **AI Slide Generator** 🎨 (Coming Soon)
   - Outline-to-visual slide generation feature that converts session outlines directly into downloadable slide decks.

---

## 🛠️ How to Run Locally

### 1. Configure Your API Keys
Create or open `backend/.env` and insert your Google Gemini API keys. The backend supports **automated key rotation** across up to 7 keys to prevent 429 quota exhaustion:

```env
# backend/.env
PORT=5000
GEMINI_MODEL=gemini-3.5-flash

# Add your keys. The rotation manager automatically filters out empty/unconfigured keys.
GEMINI_API_KEY_1=AIzaSy...
GEMINI_API_KEY_2=AIzaSy...
# Add up to GEMINI_API_KEY_7 if needed
```

### 2. Start the Backend Server
Navigate to the `backend/` directory, install dependencies, and start the development server:
```bash
cd backend
npm install
npm run dev
```
*The backend server will run on `http://localhost:5000`.*

### 3. Start the Frontend React App
Navigate to the `frontend/` directory, install dependencies, and launch the Vite dev server:
```bash
cd frontend
npm install
npm run dev
```
*The React app will run on `http://localhost:5173`.*

---

## 🌟 Premium Features & Technical Implementation

### 1. Developer Tools Portal (`DevToolsScreen.jsx`)
*   **Automatic Hover Sidebar**: A modern sidebar that automatically expands to `240px` when hovered (`onMouseEnter`) and collapses to `68px` when the cursor leaves (`onMouseLeave`) with a smooth `0.2s` transition, maximizing viewport real estate.
*   **Three-State Manual API Key Override Control**:
    *   *Automatic Rotation (Default)*: Backend cycles through all configured keys.
    *   *Force Specific Configured Key*: Lock backend execution to a specific key index (1-7).
    *   *Force Specific Custom Key*: Manually input and test a temporary custom Gemini key.
*   **Cost & Usage Telemetry**: Divided into two major sub-views using a segmented toggle control:
    *   *📊 Cost Overview*: A high-level dashboard displaying aggregate costs, query count, total token consumption, average cost per query, and interactive charts for cost distribution by model.
    *   *🔍 Detailed Session Logs*: A granular, sortable grid listing every single user/system session, showing start times, elapsed duration, total queries, generated tokens, exact calculated costs, and associated metadata.

### 2. Premium Template Explorer
*   **Card Grid Layout**: Replaced the legacy single-preset dropdown and giant preview iframe with a responsive card-based grid showcasing all A4 printable layouts.
*   **Scale-Preserved Thumbnails**: Employs absolute positioning and CSS 2D transforms (`transform: scale(0.32)`) inside thumbnail iframes to bypass flex-shrink layout bugs, guaranteeing that templates maintain their exact aspect ratio and look visually stunning on all viewports.
*   **Backdrop-Blurred Modal**: Clicking any template card opens a beautiful, glassmorphism-style overlay presenting a high-fidelity full-page preview.
*   **🖨️ Direct Print Integration**: A prominent print button in the preview modal triggers native browser printing directly on the target layout, allowing seamless physical PDF export.

### 3. Scalable Session & IP Auditing (GDPR-Compliant)
*   **Chronological Client-Side Session IDs**: Guest sessions are generated on the client side using the format `anon_YYYYMMDD_HHMMSS_entropy`, which is chronologically sortable and ready to scale to registered/paid user IDs.
*   **Microsecond System Session IDs**: Background cron triggers and server startup tasks generate trace IDs using the format `system_YYYYMMDD_HHMMSS_ffffff`.
*   **Context-Aware Background Tracking**: Leverages Node.js `AsyncLocalStorage` (`sessionLocalStorage.run`) to automatically wrap backend background cron ticks and startup operations. Any sub-logs or model calls made during a tick automatically inherit that tick's `system_` session ID.
*   **GDPR-Compliant Security Logger Middleware**: Captures client IP addresses on the server side (`req.ip` and proxy headers) and outputs them strictly to secure server-side console logs. This keeps PII completely out of client-side local storage or visible session IDs, ensuring GDPR compliance while maintaining session persistence over unstable network handovers.

### 4. Smart Frontend Layout & Pagination
*   **A4 PDF Formatting**: Strict viewport formatting enforcing A4 CSS page print limits (`210mm x 297mm`) with custom paddings and font sizes.
*   **Dynamic Pagination**: Intercepts DOM changes in the preview iframe, scans for text scroll height overflows, and automatically moves paragraph or list blocks to subsequent pages.
*   **DOM Placement Preservation**: Ensures modified or edited sections are correctly re-rendered in place in the document structure instead of appending at the end of the container.
*   **Empty Page Cleanup**: Scans pages dynamically and removes unused containers using rigorous text length and media verification checks.
*   **Neat Chat Bubble Display**: Prevents long background prompts (e.g. for revision instructions) from cluttering the chat timeline by mapping friendly, short display labels for option clicks while passing full prompt context to the Gemini API.

### 5. Resilient Key Rotation & Cascading Backend
*   **Key Rotation**: Automatically detects rate-limits (HTTP 429) or transient errors and rotates to the next API key in the sequence.
*   **Model Fallback Chain**: If a model fails to reply on all rotating keys, the backend automatically cascades to the next available model in the fallback chain (`gemini-3.5-flash` ➔ `gemini-3.1-pro-preview` ➔ `gemini-3.1-flash-lite` ➔ `gemini-2.5-flash` etc.) to maximize uptime.
*   **Print-safe Styling Sanitizer**: Strips animation, transition, cursor, transform, and hover rules from generated CSS. Converts fixed pixel heights to dynamic bounds to prevent clipping, and applies print breaks (`break-inside: avoid`) to table rows and cards.

---

## 📁 Repository Structure

```
├── backend/
│   ├── server.js            # Node/Express API with Gemini rotation, AsyncLocalStorage logging, and IP auditing
│   ├── pricing_defaults.json # Standard model pricing tokens configuration
│   ├── disabled_keys.json   # Persistent record of keys flagged as exhausted/invalid
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/      # Main feature screens (HomeScreen, SpeakerNotesScreen, DevToolsScreen...)
│   │   └── App.jsx          # React app entry point with client-side anon session tracking
│   ├── public/              # Branding assets and favicon resources
│   ├── package.json
│   └── vite.config.js
├── start-app.bat            # Direct double-click script to boot full application
├── start-devtools.bat       # Direct double-click script to boot DevTools portal
└── README.md
```
