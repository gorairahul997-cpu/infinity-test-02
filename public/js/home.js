/* home.js — Landing page logic (v2: multi-format, history link, smart suggestions) */

// ── State ────────────────────────────────────────────────────────────
let selectedClass = null;
let selectedSubject = null;
let selectedExam = null;
let selectedQTypes = []; // Array: multiple formats now allowed
let selectedDiff = 'Adaptive';

// ── Selectors ────────────────────────────────────────────────────────
function selectClass(btn) {
  document.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedClass = btn.dataset.class;
  clearError();
}

function selectSubject(btn) {
  document.querySelectorAll('.subj-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedSubject = btn.dataset.subject;
  clearError();

  // Predict output is only for Computer Science/Applications
  const predictBtn = document.getElementById('btn-fmt-predict');
  if (predictBtn) {
    if (selectedSubject === 'Computer Science' || selectedSubject === 'Computer Applications') {
      predictBtn.style.display = 'flex';
    } else {
      predictBtn.style.display = 'none';
      if (selectedQTypes.includes('predict')) {
        selectQType(predictBtn); // unselect it
      }
    }
  }

  loadSmartSuggestions();
}

function selectPill(btn, groupId) {
  document.querySelectorAll(`#${groupId} .pill-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (groupId === 'exam-group') { selectedExam = btn.dataset.value; clearError(); }
  if (groupId === 'diff-group') { selectedDiff = btn.dataset.value; }
}

// Multi-select for question types (toggle)
function selectQType(btn) {
  const val = btn.dataset.value;
  btn.classList.toggle('active');

  if (btn.classList.contains('active')) {
    if (!selectedQTypes.includes(val)) selectedQTypes.push(val);
  } else {
    selectedQTypes = selectedQTypes.filter(t => t !== val);
  }
  clearError();
}

function updateCount(input) {
  document.getElementById('count-display').textContent = input.value;
}

// ── Smart Suggestions (from localStorage history) ────────────────────
function loadSmartSuggestions() {
  const sugBox = document.getElementById('smart-suggestions');
  if (!sugBox) return;

  const allHistory = JSON.parse(localStorage.getItem('infinityHistory') || '[]');
  if (!allHistory.length || !selectedSubject) {
    sugBox.classList.add('hidden');
    return;
  }

  // Filter history for selected subject
  const subjectHistory = [];
  allHistory.forEach(session => {
    if (session.settings && session.settings.subject === selectedSubject) {
      (session.history || []).forEach(h => {
        if (h.question) {
          subjectHistory.push({
            topic: h.question.topic || 'General',
            result: h.result,
          });
        }
      });
    }
  });

  if (!subjectHistory.length) { sugBox.classList.add('hidden'); return; }

  // Calculate topic accuracy
  const topicMap = {};
  subjectHistory.forEach(h => {
    if (!topicMap[h.topic]) topicMap[h.topic] = { correct: 0, total: 0 };
    topicMap[h.topic].total++;
    if (h.result === 'correct') topicMap[h.topic].correct++;
  });

  const weakTopics = Object.entries(topicMap)
    .filter(([_, d]) => d.total >= 2 && (d.correct / d.total) < 0.5)
    .sort((a, b) => (a[1].correct / a[1].total) - (b[1].correct / b[1].total))
    .slice(0, 3);

  if (!weakTopics.length) { sugBox.classList.add('hidden'); return; }

  sugBox.classList.remove('hidden');

  // Build safely with DOM methods — no innerHTML with user data
  sugBox.innerHTML = ''; // clear (no user data here)

  const title = document.createElement('h4');
  title.className = 'suggest-title';
  title.textContent = '🎯 Weak Topics Detected';
  sugBox.appendChild(title);

  const chips = document.createElement('div');
  chips.className = 'suggest-chips';

  weakTopics.forEach(([topic, d]) => {
    const pct = Math.round((d.correct / d.total) * 100);
    const btn = document.createElement('button');
    btn.className = 'suggest-chip';

    const topicSpan = document.createElement('span');
    topicSpan.className = 'suggest-topic';
    topicSpan.textContent = topic; // safe — text only

    const pctSpan = document.createElement('span');
    pctSpan.className = 'suggest-pct ' + (pct < 30 ? 'critical' : 'warn');
    pctSpan.textContent = pct + '%';

    btn.appendChild(topicSpan);
    btn.appendChild(pctSpan);
    btn.addEventListener('click', () => {
      document.getElementById('topic-input').value = topic; // safe assignment
      btn.classList.add('used');
    });

    chips.appendChild(btn);
  });

  sugBox.appendChild(chips);
}

// ── Validation & Start ────────────────────────────────────────────────
function startPractice() {
  clearError();
  if (!selectedClass) return showError('Please select your class (9, 10, 11, or 12).');
  if (!selectedSubject) return showError('Please select a subject.');
  if (!selectedExam) return showError('Please select a target exam.');
  if (!selectedQTypes.length) return showError('Please choose at least one question format.');

  const settings = {
    classLevel: selectedClass,
    subject: selectedSubject,
    examType: selectedExam,
    questionTypes: selectedQTypes, // Array now
    questionType: selectedQTypes[0], // backward compat
    difficulty: selectedDiff,
    count: parseInt(document.getElementById('q-count').value, 10),
    timer: parseInt(document.getElementById('timer-select').value, 10),
    topic: document.getElementById('topic-input').value.trim(),
    useCache: JSON.parse(localStorage.getItem('infinityPrefs') || '{}').useCache !== false
  };

  sessionStorage.setItem('practiceSettings', JSON.stringify(settings));
  window.location.href = 'practice.html';
}

// ── Generate PDF Paper (no practice, just paper) ─────────────────────
async function generatePaper() {
  clearError();
  if (!selectedClass) return showError('Please select your class.');
  if (!selectedSubject) return showError('Please select a subject.');
  if (!selectedExam) return showError('Please select a target exam.');
  if (!selectedQTypes.length) return showError('Please choose at least one question format.');

  const btn = document.getElementById('lp-pdf-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating...'; }

  try {
    const count = parseInt(document.getElementById('q-count').value, 10);
    const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
    const res = await fetch('/api/generate-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        classLevel: selectedClass,
        subject: selectedSubject,
        examType: selectedExam,
        questionTypes: selectedQTypes,
        difficulty: selectedDiff,
        topic: document.getElementById('topic-input').value.trim(),
        count,
        useCache: prefs.useCache !== false,
        academicProfile: prefs.academicProfile
      }),
    });

    const data = await res.json();
    if (!data.success || !data.questions.length) throw new Error('Failed to generate questions');

    // Store for PDF generation
    sessionStorage.setItem('pdfQuestions', JSON.stringify({
      questions: data.questions,
      settings: {
        subject: selectedSubject,
        examType: selectedExam,
        classLevel: selectedClass,
        difficulty: selectedDiff,
        topic: document.getElementById('topic-input').value.trim(),
      },
      date: new Date().toISOString(),
    }));

    window.location.href = 'paper.html';
  } catch (err) {
    showError('PDF generation failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📄 Generate PDF Paper'; }
  }
}

function showError(msg) {
  const el = document.getElementById('setup-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearError() {
  document.getElementById('setup-error').classList.add('hidden');
}

// ── API Status Check ─────────────────────────────────────────────────
async function checkApiStatus() {
  const dots = document.querySelectorAll('.status-dot');
  const text = document.querySelector('.nav-status span:not(.status-dot)');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.keySet) {
      dots.forEach(d => {
        d.classList.remove('offline');
        d.classList.add('online');
      });
      if (text) text.textContent = data.pipeline || 'AI Ready';
    } else {
      dots.forEach(d => {
        d.classList.remove('online');
        d.classList.add('offline');
      });
      if (text) text.textContent = 'API Key Missing';
    }
  } catch {
    dots.forEach(d => {
      d.classList.remove('online');
      d.classList.add('offline');
    });
    if (text) text.textContent = 'Server Offline';
  }
}

// ── Settings & Preferences ───────────────────────────────────────────
function toggleSetting(key, value) {
  const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
  prefs[key] = value;
  localStorage.setItem('infinityPrefs', JSON.stringify(prefs));

  if (key === 'performanceMode') {
    const isLowEnd = (navigator.hardwareConcurrency || 4) <= 2;
    if (value || isLowEnd) {
      document.documentElement.classList.add('low-end');
    } else {
      document.documentElement.classList.remove('low-end');
    }
  }
  
  if (key === 'useAdaptive') {
    applyAdaptiveSettings(value);
  }

  if (key === 'useKatex') {
    window.location.reload();
  }
}

function saveAcademicProfile(value) {
  const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
  prefs.academicProfile = value;
  localStorage.setItem('infinityPrefs', JSON.stringify(prefs));
}

function applyAdaptiveSettings(useAdaptive) {
  const adaptiveBtn = document.querySelector('.diff-adaptive');
  if (adaptiveBtn) {
    if (useAdaptive !== false) {
      adaptiveBtn.style.display = 'inline-block';
    } else {
      adaptiveBtn.style.display = 'none';
      if (selectedDiff === 'Adaptive') {
        const medBtn = document.querySelector('.diff-med');
        if (medBtn) selectPill(medBtn, 'diff-group');
      }
    }
  }
}

function loadPreferences() {
  const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
  if (prefs.useCache === undefined) prefs.useCache = true;
  if (prefs.useAdaptive === undefined) prefs.useAdaptive = true;
  if (prefs.useKatex === undefined) prefs.useKatex = true;
  localStorage.setItem('infinityPrefs', JSON.stringify(prefs));

  const autoAdv = document.getElementById('setting-autoadvance');
  const strict = document.getElementById('setting-strict');
  const perf = document.getElementById('setting-performance');
  const cacheTog = document.getElementById('setting-cache');
  const adaptiveTog = document.getElementById('setting-adaptive');
  const katexTog = document.getElementById('setting-katex');
  
  if (autoAdv) autoAdv.checked = !!prefs.autoAdvance;
  if (strict) strict.checked = !!prefs.strictMode;
  if (perf) perf.checked = !!prefs.performanceMode;
  if (cacheTog) cacheTog.checked = !!prefs.useCache;
  if (adaptiveTog) adaptiveTog.checked = !!prefs.useAdaptive;
  if (katexTog) katexTog.checked = !!prefs.useKatex;

  const academicProfile = document.getElementById('setting-academic-profile');
  if (academicProfile) academicProfile.value = prefs.academicProfile || '';

  applyAdaptiveSettings(prefs.useAdaptive);
}

// ── Init ─────────────────────────────────────────────────────────────
checkApiStatus();
loadPreferences();
document.querySelector('#diff-group .pill-btn[data-value="Adaptive"]').classList.add('active');

// Load history count for badge
const historyCount = JSON.parse(localStorage.getItem('infinityHistory') || '[]').length;
const histBadge = document.getElementById('history-count');
if (histBadge && historyCount > 0) histBadge.textContent = historyCount;

// ── Formula Explainer Logic ──────────────────────────────────────────
async function fetchFormulas() {
  const topic = document.getElementById('formula-topic-input').value.trim();
  if (!topic) return alert('Please enter a topic.');

  const btn = document.getElementById('btn-fetch-formulas');
  btn.textContent = 'Searching...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/formulas/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    const data = await res.json();
    const listDiv = document.getElementById('formula-list-results');
    listDiv.innerHTML = '';

    if (!data.success) throw new Error(data.error);

    data.formulas.forEach((f, idx) => {
      const el = document.createElement('div');
      el.className = 'formula-card-item';
      el.style.cssText = `
        padding: 1.25rem;
        background: var(--surface-2);
        border: 1px solid var(--border);
        border-radius: var(--r);
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        animation: slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) ${idx * 0.05}s both;
      `;
      el.innerHTML = `
        <div style="flex: 1; min-width: 0;">
          <strong style="color: var(--text); font-size: 0.95rem; font-weight: 700; display: block; margin-bottom: 0.4rem;">${f.name}</strong>
          <span style="font-family: 'JetBrains Mono', monospace; font-size: 1.1rem; color: var(--primary); display: inline-block;">${f.formula}</span>
        </div>
        <div class="formula-card-arrow" style="width: 32px; height: 32px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
          <span style="font-size: 1rem; color: var(--primary); transition: transform 0.2s;">→</span>
        </div>
      `;
      el.onmouseover = () => {
        if (el.classList.contains('active-card')) return;
        el.style.borderColor = 'var(--primary)';
        el.style.background = 'var(--primary-glow)';
        const arrow = el.querySelector('.formula-card-arrow');
        arrow.style.borderColor = 'var(--primary)';
        arrow.style.background = 'var(--primary)';
        arrow.querySelector('span').style.color = '#fff';
        arrow.querySelector('span').style.transform = 'translateX(2px)';
      };
      el.onmouseout = () => {
        if (el.classList.contains('active-card')) return;
        el.style.borderColor = 'var(--border)';
        el.style.background = 'var(--surface-2)';
        const arrow = el.querySelector('.formula-card-arrow');
        arrow.style.borderColor = 'var(--border)';
        arrow.style.background = 'var(--surface)';
        arrow.querySelector('span').style.color = 'var(--primary)';
        arrow.querySelector('span').style.transform = 'none';
      };
      el.onclick = () => {
        document.querySelectorAll('.formula-card-item').forEach(c => {
          c.classList.remove('active-card');
          c.style.borderColor = 'var(--border)';
          c.style.background = 'var(--surface-2)';
          const a = c.querySelector('.formula-card-arrow');
          if (a) {
            a.style.borderColor = 'var(--border)';
            a.style.background = 'var(--surface)';
            a.querySelector('span').style.color = 'var(--primary)';
            a.querySelector('span').style.transform = 'none';
          }
        });
        
        el.classList.add('active-card');
        el.style.borderColor = 'var(--primary)';
        el.style.background = 'var(--primary-glow)';
        const arrow = el.querySelector('.formula-card-arrow');
        arrow.style.borderColor = 'var(--primary)';
        arrow.style.background = 'var(--primary)';
        arrow.querySelector('span').style.color = '#fff';
        arrow.querySelector('span').style.transform = 'translateX(2px)';

        const finalFormula = f.formula;
        const chip = document.getElementById('formula-selected-chip');
        const chipName = document.getElementById('formula-selected-name');
        const chipRender = document.getElementById('formula-selected-render');
        
        // Store the raw formula on the chip element for retrieval
        chip.dataset.formula = finalFormula;
        chip.dataset.topic = topic;
        
        // Populate chip
        chipName.textContent = f.name;
        chipRender.textContent = finalFormula;
        chip.classList.remove('hidden');
        chip.style.display = 'flex';
        
        // Clear the manual input so it doesn't show garbage
        document.getElementById('formula-deep-input').value = '';
        
        // Render KaTeX inside chip
        if (window.renderMathInElement) {
          renderMathInElement(chip, { delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }], throwOnError: false });
        }
        
        // Scroll to deep dive card smoothly
        const deepCard = document.getElementById('formula-deep-card');
        if (deepCard) deepCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        
        explainFormula(finalFormula, topic);
      };
      listDiv.appendChild(el);
    });

    if (window.renderMathInElement) {
      renderMathInElement(listDiv, { 
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false
      });
    }
  } catch (err) {
    alert('Failed to fetch formulas: ' + err.message);
  } finally {
    btn.textContent = 'Search';
    btn.disabled = false;
  }
}

async function explainFormula(formObj, topicCtx) {
  // Priority: 1) Explicitly passed formula, 2) Selected chip formula, 3) Manual input
  let formula;
  if (typeof formObj === 'string' && formObj.trim()) {
    formula = formObj.trim();
  } else {
    const chip = document.getElementById('formula-selected-chip');
    if (chip && !chip.classList.contains('hidden') && chip.dataset.formula) {
      formula = chip.dataset.formula;
    } else {
      formula = (document.getElementById('formula-deep-input').value || '').trim();
    }
  }
  if (!formula) return alert('Please click a formula above or type one manually.');
  
  // Resolve topic context
  const resolvedTopic = topicCtx
    || (document.getElementById('formula-selected-chip').dataset.topic || '')
    || document.getElementById('formula-topic-input').value.trim();
  

  const btn = document.getElementById('btn-explain-formula');
  btn.textContent = 'Analyzing...';
  btn.disabled = true;

  const resDiv = document.getElementById('formula-deep-results');
  resDiv.classList.remove('hidden');
  resDiv.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding: 1.5rem 0;">AI is deep diving into the formula...</div>';

  try {
    const res = await fetch('/api/formulas/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formula, topic: resolvedTopic })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    resDiv.innerHTML = `
      <div class="explain-header" style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border); padding-bottom: 0.75rem;">
        <span style="font-size: 1.5rem;">📐</span>
        <h3 style="color: var(--text); font-weight: 800; font-size: 1.15rem; letter-spacing: -0.02em; margin: 0;">Formula breakdown</h3>
      </div>
      
      <div class="explain-math-box" id="explain-math-render" style="font-size: 1.35rem; margin-bottom: 1.5rem; text-align: center; background: var(--surface); padding: 1.5rem; border-radius: var(--r); border: 1.5px solid var(--border); box-shadow: inset 0 2px 4px rgba(0,0,0,0.02); color: var(--primary); overflow-x: auto;">
      </div>
      
      <div style="display: grid; gap: 1.25rem;">
        <div>
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; display: block; margin-bottom: 0.35rem;">What is it?</span>
          <p style="color: var(--text); font-size: 0.9rem; line-height: 1.5; font-weight: 500;">${data.explanation.what}</p>
        </div>
        
        <div>
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; display: block; margin-bottom: 0.35rem;">Variables Glossary</span>
          <ul style="color: var(--text); font-size: 0.88rem; line-height: 1.6; padding-left: 1.25rem; display: flex; flex-direction: column; gap: 0.3rem;">
            ${data.explanation.variables.map(v => `<li style="font-weight: 500;">${v}</li>`).join('')}
          </ul>
        </div>
        
        <div>
          <span style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.07em; display: block; margin-bottom: 0.35rem;">When to use it?</span>
          <p style="color: var(--text); font-size: 0.9rem; line-height: 1.5; font-weight: 500;">${data.explanation.when}</p>
        </div>
        
        <div style="background: rgba(245, 158, 11, 0.06); border: 1px dashed rgba(245, 158, 11, 0.3); border-radius: var(--r-sm); padding: 1rem; display: flex; gap: 0.75rem; align-items: flex-start; margin-top: 0.25rem;">
          <span style="font-size: 1.25rem; line-height: 1; filter: saturate(1.2);">⚠️</span>
          <div style="flex: 1; min-width: 0;">
            <strong style="color: #b45309; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 0.2rem;">Common student trap</strong>
            <p style="color: #92400e; font-size: 0.85rem; line-height: 1.45; font-weight: 500; margin: 0;">${data.explanation.trap}</p>
          </div>
        </div>
      </div>
    `;

    // Render the main math box directly with KaTeX for guaranteed output
    const mathBox = document.getElementById('explain-math-render');
    if (mathBox && window.katex) {
      // Strip outer $$ delimiters before passing to katex.renderToString
      let rawLatex = (data.explanation.math_render || '').trim();
      rawLatex = rawLatex.replace(/^\$\$\s*/, '').replace(/\s*\$\$$/, '');
      try {
        mathBox.innerHTML = katex.renderToString(rawLatex, { displayMode: true, throwOnError: false });
      } catch (e) {
        mathBox.innerHTML = `<span style="font-family:monospace;font-size:0.95rem;">${data.explanation.math_render}</span>`;
      }
    }

    if (window.renderMathInElement) {
      renderMathInElement(resDiv, {
        delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
        throwOnError: false
      });
    }
  } catch (err) {
    resDiv.innerHTML = `<div style="color:var(--red); padding:1rem; border:1px solid #fecaca; border-radius:var(--r); background:#fef2f2; font-weight:600; font-size:0.9rem;">Analysis failed: ${err.message}</div>`;
  } finally {
    btn.textContent = 'Deep Dive';
    btn.disabled = false;
  }
}

function clearSelectedFormula() {
  const chip = document.getElementById('formula-selected-chip');
  if (chip) {
    chip.classList.add('hidden');
    chip.style.display = 'none';
    chip.dataset.formula = '';
    chip.dataset.topic = '';
    document.getElementById('formula-selected-name').textContent = '';
    document.getElementById('formula-selected-render').textContent = '';
  }
  document.getElementById('formula-deep-input').value = '';
  const resDiv = document.getElementById('formula-deep-results');
  if (resDiv) resDiv.classList.add('hidden');
}

// ── Offline Progress Sync Queue Integration ──────────────────────────
async function flushSyncQueue() {
  if (!navigator.onLine) return;
  let queue;
  try {
    queue = JSON.parse(localStorage.getItem('infinitySyncQueue') || '[]');
  } catch (e) {
    console.warn('[SYNC] Failed to read queue from localStorage:', e);
    return;
  }
  if (!queue || queue.length === 0) return;

  console.log(`[SYNC] Attempting to flush ${queue.length} offline progress tracking items from dashboard...`);
  const remaining = [];

  for (const item of queue) {
    try {
      const res = await fetch('/api/track-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        remaining.push(item);
      }
    } catch (err) {
      remaining.push(item);
    }
  }

  try {
    if (remaining.length > 0) {
      localStorage.setItem('infinitySyncQueue', JSON.stringify(remaining));
      console.log(`[SYNC] ${remaining.length} items failed to sync and remain in queue.`);
    } else {
      localStorage.removeItem('infinitySyncQueue');
      console.log('[SYNC] All offline items synced successfully.');
    }
  } catch (e) {
    console.warn('[SYNC] Failed to update localStorage queue:', e);
  }
}

window.addEventListener('online', flushSyncQueue);
window.addEventListener('load', flushSyncQueue);

function initFormulaEngineEnterKeys() {
  const topicInput = document.getElementById('formula-topic-input');
  if (topicInput) {
    topicInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        fetchFormulas();
      }
    });
  }

  const deepInput = document.getElementById('formula-deep-input');
  if (deepInput) {
    deepInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        explainFormula();
      }
    });
  }
}

// Initialize listeners on load
initFormulaEngineEnterKeys();

// Global config bridge for History retakes
window.applyRetakeConfig = function(rc) {
  if (!rc) return;
  
  if (rc.classLevel) {
    const btn = document.querySelector(`.class-btn[data-class="${rc.classLevel}"]`);
    if (btn) selectClass(btn);
  }
  if (rc.examType) {
    const btn = document.querySelector(`#exam-group .pill-btn[data-value="${rc.examType}"]`);
    if (btn) selectPill(btn, 'exam-group');
  }
  if (rc.subject) {
    const btn = document.querySelector(`.subj-btn[data-subject="${rc.subject}"]`);
    if (btn) selectSubject(btn);
  }
  if (rc.topic) {
    const topicInp = document.getElementById('topic-input');
    if (topicInp) topicInp.value = rc.topic;
  }
  if (rc.questionTypes) {
    document.querySelectorAll('.fmt-btn.active').forEach(b => b.classList.remove('active'));
    selectedQTypes = [];
    rc.questionTypes.forEach(t => {
      const btn = document.querySelector(`.fmt-btn[data-value="${t}"]`);
      if (btn) {
        btn.classList.add('active');
        selectedQTypes.push(t);
      }
    });
  }
  if (rc.difficulty) {
    const btn = document.querySelector(`#diff-group .pill-btn[data-value="${rc.difficulty}"]`);
    if (btn) selectPill(btn, 'diff-group');
  }
  if (rc.totalQuestions) {
    const countSlider = document.getElementById('q-count');
    if (countSlider) {
      countSlider.value = rc.totalQuestions;
      updateCount(countSlider);
    }
  }
  if (rc.timerSeconds !== undefined) {
    const tmr = document.getElementById('timer-select');
    if (tmr) tmr.value = String(rc.timerSeconds);
  }
  
  updatePanel();
};

// ── Dashboard Cache Controllers ──────────────────────────────────────
async function fetchCacheStatus() {
  const totalBadge = document.getElementById('cache-total-badge');
  const activeIndicator = document.getElementById('cache-active-indicator');
  const breakdownGrid = document.getElementById('cache-breakdown-grid');

  if (!breakdownGrid) return; // DOM elements not present in this view/page yet

  try {
    const res = await fetch('/api/cache/status');
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // 1. Update total pre-warmed count badge
    if (totalBadge) {
      totalBadge.textContent = `${data.total} Pre-warmed`;
    }

    // 2. Control background caching indicator & polling
    const activeWarmings = data.activeReplenishments || [];
    if (activeWarmings.length > 0) {
      if (activeIndicator) {
        activeIndicator.classList.remove('hidden');
        const details = activeWarmings.map(key => {
          const parts = key.split(':');
          const subject = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
          const type = parts[3] ? parts[3].toUpperCase() : '';
          return `${subject} ${type}`;
        });
        const uniqDetails = [...new Set(details)].join(', ');
        const textEl = activeIndicator.querySelector('div:last-child');
        if (textEl) {
          textEl.textContent = `AI is active in the background warming question pools: ${uniqDetails}...`;
        }
      }

      // Automatically poll cache status every 4 seconds when background caching is active
      if (!window.cachePollInterval) {
        window.cachePollInterval = setInterval(fetchCacheStatus, 4000);
      }
    } else {
      if (activeIndicator) activeIndicator.classList.add('hidden');
      if (window.cachePollInterval) {
        clearInterval(window.cachePollInterval);
        window.cachePollInterval = null;
      }
    }

    // 3. Render grid breakdown dynamically
    breakdownGrid.innerHTML = '';
    const subjects = ['Physics', 'Chemistry', 'Mathematics', 'Biology'];
    const subjectThemes = {
      'Physics': { color: 'var(--cyan)', border: 'rgba(6, 182, 212, 0.4)', glow: 'rgba(6, 182, 212, 0.08)' },
      'Chemistry': { color: 'var(--amber)', border: 'rgba(245, 158, 11, 0.4)', glow: 'rgba(245, 158, 11, 0.08)' },
      'Mathematics': { color: 'var(--primary)', border: 'rgba(99, 102, 241, 0.4)', glow: 'rgba(99, 102, 241, 0.08)' },
      'Biology': { color: 'var(--emerald)', border: 'rgba(16, 185, 129, 0.4)', glow: 'rgba(16, 185, 129, 0.08)' }
    };

    subjects.forEach(subj => {
      const subjRows = data.breakdown.filter(r => r.subject.toLowerCase() === subj.toLowerCase());
      const totalSubjCount = subjRows.reduce((sum, r) => sum + r.count, 0);
      const theme = subjectThemes[subj] || { color: 'var(--text-muted)', border: 'var(--border)', glow: 'transparent' };

      const card = document.createElement('div');
      card.className = 'cache-subj-card';
      card.style.cssText = `
        padding: 0.85rem;
        background: var(--surface-2);
        border: 1px solid ${theme.border};
        border-left: 4px solid ${theme.color};
        border-radius: var(--r-sm);
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
        box-shadow: 0 2px 8px rgba(0,0,0,0.02);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
        overflow: hidden;
      `;
      card.onmouseover = () => {
        card.style.transform = 'translateY(-2px)';
        card.style.boxShadow = '0 6px 16px rgba(0,0,0,0.06)';
        card.style.background = theme.glow;
      };
      card.onmouseout = () => {
        card.style.transform = 'none';
        card.style.boxShadow = '0 2px 8px rgba(0,0,0,0.02)';
        card.style.background = 'var(--surface-2)';
      };

      // Header row
      const header = document.createElement('div');
      header.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
      
      const title = document.createElement('strong');
      title.style.cssText = 'font-size: 0.85rem; color: var(--text); font-weight: 700;';
      title.textContent = subj === 'Mathematics' ? 'Maths' : subj;
      
      const countBadge = document.createElement('span');
      countBadge.style.cssText = `font-size: 0.78rem; font-weight: 800; color: ${theme.color};`;
      countBadge.textContent = `${totalSubjCount} Qs`;

      header.appendChild(title);
      header.appendChild(countBadge);
      card.appendChild(header);

      // Detail rows by question type
      if (subjRows.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'font-size: 0.72rem; color: var(--text-faint); font-style: italic; margin-top: 0.2rem;';
        empty.textContent = '0 pre-warmed';
        card.appendChild(empty);
      } else {
        const detailsContainer = document.createElement('div');
        detailsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.2rem; margin-top: 0.2rem;';
        
        const typeMap = {};
        subjRows.forEach(row => {
          const typeLabel = row.questionType.toUpperCase();
          typeMap[typeLabel] = (typeMap[typeLabel] || 0) + row.count;
        });

        Object.entries(typeMap).forEach(([type, count]) => {
          const rowEl = document.createElement('div');
          rowEl.style.cssText = 'display: flex; justify-content: space-between; font-size: 0.72rem; color: var(--text-muted);';
          
          const label = document.createElement('span');
          label.textContent = type;
          
          const val = document.createElement('span');
          val.style.cssText = 'font-weight: 600; font-family: monospace;';
          val.textContent = count;

          rowEl.appendChild(label);
          rowEl.appendChild(val);
          detailsContainer.appendChild(rowEl);
        });

        card.appendChild(detailsContainer);
      }

      breakdownGrid.appendChild(card);
    });

  } catch (err) {
    console.error('[CACHE FETCH ERROR]', err);
  }
}

async function clearSystemCache() {
  if (!confirm('Are you sure you want to purge all pre-warmed questions from the system database? This will reset system caches.')) return;

  const btn = document.querySelector('button[onclick="clearSystemCache()"]');
  const originalText = btn ? btn.textContent : '🗑️ Clear Cache';
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Clearing...';
  }

  try {
    const res = await fetch('/api/cache/clear', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Server error');
    
    alert('System cache cleared successfully!');
    await fetchCacheStatus();
  } catch (err) {
    alert('Failed to clear cache: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

async function triggerManualPrewarm(subject) {
  // Let the user know the prewarming has been triggered
  const btn = [...document.querySelectorAll('button')].find(b => 
    b.textContent.includes(`Warm ${subject}`) || 
    (b.textContent.includes(`Warm Maths`) && subject === 'Mathematics')
  );
  const originalText = btn ? btn.textContent : `⚡ Warm ${subject}`;
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Triggering...';
  }

  try {
    const res = await fetch('/api/generate-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject,
        examType: 'JEE',
        questionType: 'mcq',
        difficulty: 'Medium',
        topic: 'General',
        classLevel: '12',
        sessionQuestionTypes: ['mcq', 'tf', 'assertion', 'numerical'],
        prewarmOnly: true
      })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Server error');

    // Fetch status instantly to reflect active prewarm indicators
    await fetchCacheStatus();
  } catch (err) {
    alert('Failed to trigger cache warming: ' + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }
}

// Expose functions globally
window.fetchCacheStatus = fetchCacheStatus;
window.clearSystemCache = clearSystemCache;
window.triggerManualPrewarm = triggerManualPrewarm;

// Fetch cache status initially on load
fetchCacheStatus();


