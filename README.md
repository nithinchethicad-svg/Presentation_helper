# AI Presentation Assistant 🚀

AI Presentation Assistant is a powerful, production-grade presentation companion suite designed to help you brainstorm and create structured speaker notes, design visual slide outlines, and publish polished, print-ready takeaway notes/handouts. Built with a modern **React (Vite) frontend** and a **Node.js Express backend**, it leverages Google Gemini models with key rotation, fallback cascading, and a smart, print-safe layout compilation engine.

---

## 🏗️ Application Overview & Architecture

The application is structured into three primary modules, unified under a beautiful responsive dashboard:

1. **AI Speaker Notes Generator** 🎙️
   - An interactive, section-by-section presentation coach chat workspace.
   - Brainstorms presentation topics, develops a structured Table of Contents, and drafts comprehensive page-by-page speaker notes.
   - Provides live side-by-side A4 document previews inside a sandboxed iframe.
   - Features **line-level list pagination** that cleanly splits content and updates list item numbering across page breaks.
   - Includes an **Intent-First Revision Flow** that asks users what they want to change before suggesting changes or drafting revisions.

2. **AI Takeaway Notes Generator** ⚡
   - Automatically generates styled, high-impact handouts and summaries from uploaded slide decks (`.pptx`) or word documents (`.docx`).
   - Supports rich styling preferences like tone, detail level, and target audience.
   - Offers six pre-configured visual themes (Warm & Encouraging, Formal & Professional, Fun & Energetic, Reflective & Thoughtful, Educational & Informative, Motivational & Inspiring).

3. **AI Slide Generator** 🎨 (Coming Soon)
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
*You can view API status, key health logs, and check quotas at the debug dashboard: `http://localhost:5000/api/logs`.*

### 3. Start the Frontend React App
Navigate to the `frontend/` directory, install dependencies, and launch the Vite dev server:
```bash
cd frontend
npm install
npm run dev
```
*The React app will run on `http://localhost:5173`.*

---

## 🚀 Key Features & Technology Stack

### Smart Frontend Layout & Pagination
- **A4 PDF Formatting**: Strict viewport formatting enforcing A4 CSS page print limits (`210mm x 297mm`) with custom paddings and font sizes.
- **Dynamic Pagination**: Intercepts DOM changes in the preview iframe, scans for text scroll height overflows, and automatically moves paragraph or list blocks to subsequent pages.
- **DOM Placement Preservation**: Ensures modified or edited sections are correctly re-rendered in place in the document structure instead of appending at the end of the container.
- **Empty Page Cleanup**: Scans pages dynamically and removes unused containers using rigorous text length and media verification checks.
- **Neat Chat Bubble Display**: Prevents long background prompts (e.g. for revision instructions) from cluttering the chat timeline by mapping friendly, short display labels for option clicks while passing full prompt context to the Gemini API.

### Resilient Key Rotation & Cascading Backend
- **Key Rotation**: Automatically detects rate-limits (HTTP 429) or transient errors and rotates to the next API key in the sequence.
- **Model Fallback Chain**: If a model fails to reply on all rotating keys, the backend automatically cascades to the next available model in the fallback chain (`gemini-3.5-flash` ➔ `gemini-3.1-pro-preview` ➔ `gemini-3.1-flash-lite` ➔ `gemini-2.5-flash` etc.) to maximize uptime.
- **Print-safe Styling Sanitizer**: Strips animation, transition, cursor, transform, and hover rules from generated CSS. Converts fixed pixel heights to dynamic bounds to prevent clipping, and applies print breaks (`break-inside: avoid`) to table rows and cards.

---

## 📁 Repository Structure

```
├── backend/
│   ├── server.js            # Node/Express API with Gemini rotation and HTML post-processing
│   ├── package.json
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── components/      # Main feature screens (HomeScreen, SpeakerNotesScreen, UploadScreen...)
│   │   └── App.jsx          # React app entry point
│   ├── package.json
│   └── vite.config.js
└── README.md
```
