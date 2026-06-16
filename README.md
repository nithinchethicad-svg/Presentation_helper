# Takeaway Notes Summarizer - AI-Powered Presentation Summary Generator

An elegant, 3-screen React web application with a Node.js Express backend optimized for extracting content from `.docx` and `.pptx` files, customizing takeaway preferences, generating styled summaries via the Gemini API, and printing them cleanly to PDF.

---

## 🛠️ How to Run Locally

### 1. Configure Your API Keys
Open `backend/.env` and insert your Gemini API keys. You can specify up to 7 keys for automatic rotation:
```env
# backend/.env
GEMINI_MODEL=gemini-1.5-pro

# Add your keys here. Leaving keys empty is fine if you have fewer than 7.
GEMINI_API_KEY_1=your_key_1
GEMINI_API_KEY_2=your_key_2
...
```

### 2. Start the Backend Server
Open a command prompt and navigate to the `backend/` folder:
```bash
cd backend
npm run start
```
*(Runs on http://localhost:5000)*

### 3. Start the Frontend React App
Open a separate command prompt and navigate to the `frontend/` folder:
```bash
cd frontend
npm run dev
```
*(Runs on http://localhost:5173)*

---

## 🚀 Key Features

1. **Screen 1 (Upload)**: Drag-and-drop file upload interface matching your custom mockup design (with separate fields for Word documents and PowerPoint slides).
2. **Screen 2 (Questionnaire)**: Configures Tone, Format, Custom Color Schemes (Cool Tech, Warm Corporate, Sleek Dark, Vibrant Modern), Target Audience, and Use Case.
3. **Screen 3 (Viewer & Revision)**: 
   - Sandboxed preview iframe.
   - **Download PDF**: Uses the browser print dialog to print *only* the summary page.
   - **AI Editor Commands**: Type edits like *"make headings bigger"* or *"add a list of glossary terms"* to update the document layout live.
4. **Key Rotation & Graceful Quota Handling**: Automatically switches keys when hitting HTTP 429 rate limits. Displays a clean, user-friendly alert when all keys are exhausted.
