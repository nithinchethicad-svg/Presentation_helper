import React, { useState, useEffect } from 'react';
import UploadScreen from './components/UploadScreen';
import QuestionnaireScreen from './components/QuestionnaireScreen';
import ViewerScreen from './components/ViewerScreen';

const DEFAULT_PREFERENCES = {
  colorScheme: 'Cool Tech (Indigo & Slate)',
  contentPriorities: 'Core takeaways, vocabulary definitions, and action items',
  targetAudience: 'Working Professionals & Managers',
  setting: 'School / Academic',
  customSetting: '',
  detailLevel: 'Moderate',
  writingTheme: 'Formal & Professional',
  eventName: '',
  eventDate: '',
  coverInfo: '',
  additionalInstructions: '',
  extractEventName: false,
  extractEventDate: false,
  extractCoverInfo: false,
  strictFileContentOnly: true,
};

const BACKEND_URL = 'http://localhost:5000';

// Human-readable loading stages shown in the progress bar
const LOADING_STAGES = [
  { step: 1, pct: 8,  icon: '📂', title: 'Opening your files',          desc: 'Reading through your uploaded documents and slides.' },
  { step: 2, pct: 25, icon: '🔍', title: 'Understanding the content',   desc: 'Identifying key topics, sections, and important points.' },
  { step: 3, pct: 48, icon: '🎨', title: 'Designing the layout',        desc: 'Choosing the right structure, colours, and visual style for your document.' },
  { step: 4, pct: 68, icon: '✍️', title: 'Writing your takeaway notes', desc: 'Crafting clear, well-organised summaries for each section.' },
  { step: 5, pct: 85, icon: '🖨️', title: 'Making it print-ready',       desc: 'Checking the document is clean, properly formatted, and ready to download.' },
  { step: 6, pct: 96, icon: '✅', title: 'Almost done!',                 desc: 'Doing a final quality check before showing you the result.' },
];

function App() {
  const [view, setView] = useState('upload'); // 'upload' | 'questionnaire' | 'viewer'
  const [speakerNotes, setSpeakerNotes] = useState(null);
  const [presentationSlides, setPresentationSlides] = useState(null);
  
  const [preferences, setPreferences] = useState({ ...DEFAULT_PREFERENCES });
  
  const [generatedHtml, setGeneratedHtml] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStage, setLoadingStage] = useState(null);
  const [isRevising, setIsRevising] = useState(false);
  const [error, setError] = useState(null); // { title: '', desc: '' }

  // Advance through loading stages while isLoading is true
  useEffect(() => {
    if (!isLoading) {
      setLoadingStage(null);
      return;
    }
    setLoadingStage(LOADING_STAGES[0]);
    let idx = 1;
    // Spread stages across ~55 seconds (typical AI generation time)
    const delays = [6000, 12000, 10000, 10000, 9000]; // ms between stage advances
    const timers = [];
    let elapsed = 0;
    delays.forEach((delay, i) => {
      elapsed += delay;
      const t = setTimeout(() => {
        if (idx < LOADING_STAGES.length) {
          setLoadingStage(LOADING_STAGES[idx]);
          idx++;
        }
      }, elapsed);
      timers.push(t);
    });
    return () => timers.forEach(clearTimeout);
  }, [isLoading]);

  // Exemption for Questionnaire Page Scroll
  useEffect(() => {
    if (view === 'questionnaire') {
      document.body.classList.add('allow-page-scroll');
      document.documentElement.classList.add('allow-page-scroll');
    } else {
      document.body.classList.remove('allow-page-scroll');
      document.documentElement.classList.remove('allow-page-scroll');
    }
    return () => {
      document.body.classList.remove('allow-page-scroll');
      document.documentElement.classList.remove('allow-page-scroll');
    };
  }, [view]);

  // Navigate to Screen 2
  const handleNext = () => {
    setView('questionnaire');
    setError(null);
  };

  // Navigate back to Screen 1 from Screen 2, or Screen 2 from Screen 3
  const handleBack = () => {
    if (view === 'viewer') {
      setView('questionnaire');
    } else {
      setView('upload');
    }
    setError(null);
  };

  // Clear all states and return to Screen 1
  const handleReset = () => {
    setSpeakerNotes(null);
    setPresentationSlides(null);
    setPreferences({ ...DEFAULT_PREFERENCES });
    setGeneratedHtml('');
    setIsLoading(false);
    setIsRevising(false);
    setError(null);
    setView('upload');
  };

  // Call the backend /api/generate endpoint
  const handleGenerate = async () => {
    setIsLoading(true);
    setView('viewer'); // Transition to viewer immediately so it can show the skeleton loader
    setError(null);

    const formData = new FormData();
    
    // Append files if they exist
    if (speakerNotes) {
      formData.append('files', speakerNotes);
    }
    if (presentationSlides) {
      formData.append('files', presentationSlides);
    }

    // Append preferences (booleans must be serialized as strings)
    Object.keys(preferences).forEach(key => {
      formData.append(key, String(preferences[key]));
    });

    try {
      const response = await fetch(`${BACKEND_URL}/api/generate`, {
        method: 'POST',
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'rate_limit_exceeded') {
          throw {
            title: 'Daily Limit Reached',
            desc: 'All 7 Gemini API keys have exceeded their free rate limits for the day. Please try again tomorrow or contact support.'
          };
        } else {
          throw {
            title: 'Generation Failed',
            desc: data.message || 'An error occurred during note generation.'
          };
        }
      }

      setGeneratedHtml(data.html);
    } catch (err) {
      console.error("Fetch error:", err);
      setError({
        title: err.title || 'Connection Failed',
        desc: err.desc || 'Could not connect to the backend server. Make sure your server is running on port 5000.'
      });
      setView('questionnaire'); // Revert back to questionnaire screen if generation fails
    } finally {
      setIsLoading(false);
    }
  };

  // Call the backend /api/revise endpoint
  const handleRevise = async (instructions) => {
    setIsRevising(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/api/revise`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentHtml: generatedHtml,
          instructions,
          preferences
        })
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'rate_limit_exceeded') {
          throw {
            title: 'Daily Limit Reached',
            desc: 'All 7 Gemini API keys have exceeded their free rate limits for the day. Please try again later.'
          };
        } else {
          throw {
            title: 'Revision Failed',
            desc: data.message || 'An error occurred during the revision request.'
          };
        }
      }

      setGeneratedHtml(data.html);
    } catch (err) {
      console.error("Revision error:", err);
      setError({
        title: err.title || 'Revision Failed',
        desc: err.desc || 'Failed to apply revisions. Ensure the backend server is running and your API keys are valid.'
      });
    } finally {
      setIsRevising(false);
    }
  };

  return (
    <div className="app-container">
      {/* Global Error Alert */}
      {error && (
        <div className="error-alert animate-fade-in">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span className="error-title">{error.title}</span>
            <button 
              style={{ background: 'none', border: 'none', color: '#991b1b', cursor: 'pointer', fontWeight: 'bold' }}
              onClick={() => setError(null)}
            >
              ✕
            </button>
          </div>
          <span className="error-desc">{error.desc}</span>
        </div>
      )}

      {/* Main Screens Navigation state machine */}
      <>
        {view === 'upload' && (
          <UploadScreen
            speakerNotes={speakerNotes}
            setSpeakerNotes={setSpeakerNotes}
            presentationSlides={presentationSlides}
            setPresentationSlides={setPresentationSlides}
            onNext={handleNext}
          />
        )}

        {view === 'questionnaire' && (
          <QuestionnaireScreen
            preferences={preferences}
            setPreferences={setPreferences}
            onBack={handleBack}
            onGenerate={handleGenerate}
          />
        )}

        {view === 'viewer' && (
          <ViewerScreen
            htmlContent={generatedHtml}
            onBack={handleBack}
            onReset={handleReset}
            onRevise={handleRevise}
            isRevising={isRevising}
            isLoading={isLoading}
            loadingStage={loadingStage}
          />
        )}
      </>
    </div>
  );
}

export default App;
