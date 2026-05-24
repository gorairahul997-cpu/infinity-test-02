/* practice.js — Full Practice Session Logic (v2: multi-format + history save + adaptation) */

// ── Load Settings ─────────────────────────────────────────────────────
const raw = sessionStorage.getItem('practiceSettings');
if (!raw) { window.location.href = 'index.html'; }
const S = JSON.parse(raw);

// ── Multi-format support ──────────────────────────────────────────────
const questionTypes = S.questionTypes || [S.questionType || 'mcq'];
let typeIndex = 0;
function getNextQuestionType() {
  const t = questionTypes[typeIndex % questionTypes.length];
  typeIndex++;
  return t;
}

// ── Difficulty mixing ─────────────────────────────────────────────────
function getCurrentDifficulty() {
  if (S.difficulty !== 'Mixed') return S.difficulty;
  const levels = ['Easy', 'Medium', 'Hard'];
  return levels[Math.floor(Math.random() * levels.length)];
}

// ── Global State & Config ──────────────────────────────────────────────
const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');

// ── Session State ──────────────────────────────────────────────────────
let state = {
  current: 0,
  total: S.count,
  score: 0,
  correct: 0,
  wrong: 0,
  skipped: 0,
  streak: 0,
  bestStreak: 0,
  history: [],
  timerSeconds: S.timer,
  timerInterval: null,
  currentQuestion: null,
  currentQType: null,
  answered: false,
  sessionEnded: false,
};

// ── Prefetch Cache ─────────────────────────────────────────────────────
let prefetchPromise = null;

function buildFetchBody(qType) {
  const excludeList = state.history.map(h => {
    const q = h.question;
    return q ? (q.question || q.assertion || '') : '';
  }).filter(Boolean);

  const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
  return JSON.stringify({
    classLevel: S.classLevel || '11',
    subject: S.subject,
    examType: S.examType,
    questionType: qType || getNextQuestionType(),
    difficulty: getCurrentDifficulty(),
    topic: S.topic || '',
    excludeList: excludeList,
    sessionQuestionTypes: questionTypes,
    useCache: S.useCache !== false,
    academicProfile: prefs.academicProfile
  });
}

function prefetchNext() {
  if (state.current + 1 >= state.total) return;
  if (S.exactQuestions) return; // Do not prefetch if retaking exact questions
  const nextType = questionTypes[(typeIndex) % questionTypes.length];
  prefetchPromise = fetch('/api/generate-question', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildFetchBody(nextType),
  })
    .then(r => r.json())
    .catch(() => null);
}

// ── DOM Refs ───────────────────────────────────────────────────────────
const $loading = document.getElementById('loading-card');
const $errorCard = document.getElementById('error-card');
const $questionPane = document.getElementById('question-pane');
const $answerPane = document.getElementById('answer-pane');
const $progress = document.getElementById('progress-fill');
const $progressTxt = document.getElementById('progress-text');
const $score = document.getElementById('hdr-score');
const $streak = document.getElementById('streak-count');
const $timerVal = document.getElementById('timer-val');
const $timerWrap = document.getElementById('timer-wrap');
const $feedback = document.getElementById('feedback-panel');
const $nextBtn = document.getElementById('next-btn');
const $skipBtn = document.getElementById('skip-btn');
const $optGrid = document.getElementById('options-grid');
const $numWrap = document.getElementById('numerical-input-wrap');
const $shortWrap = document.getElementById('short-input-wrap');
const $doneOverlay = document.getElementById('session-done-overlay');

// ── Header Init ────────────────────────────────────────────────────────
document.getElementById('hdr-subject').textContent = S.subject;
document.getElementById('hdr-exam').textContent = S.examType;
if (S.timer === 0) $timerWrap.classList.add('hidden');

// ── Utility ────────────────────────────────────────────────────────────
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function updateProgress() {
  const pct = (state.current / state.total) * 100;
  $progress.style.width = pct + '%';
  $progressTxt.textContent = `${state.current} / ${state.total}`;
  $score.textContent = state.score;
  $streak.textContent = state.streak;
}

// ── Safe math text setter ──────────────────────────────────────────────
function setMathText(el, text) { el.textContent = String(text || ''); }

function makeMathLi(text) {
  const li = document.createElement('li');
  li.textContent = preprocessLatex(String(text || ''));
  return li;
}

// ── Preprocess LaTeX: wrap bare \commands in $...$ so KaTeX finds them ─
// Works for ALL math chapters — no hardcoded command list.
function preprocessLatex(text) {
  if (!text) return '';
  let s = String(text);

  // Step 1: Fix malformed patterns like \frac{$F$}{$m$} → \frac{F}{m}
  s = s.replace(/(\\[a-zA-Z]+\{[^}]*\}(?:\{[^}]*\})?)/g, function(match) {
    return match.replace(/\$/g, '');
  });

  // Step 1.5: Break concatenated operator+word like \cdotdet → \cdot det
  // AI often omits spaces after short LaTeX operators
  s = s.replace(/\\(cdot|times|div|pm|mp|to|in|cap|cup|circ|le|ge|ne|ll|gg|sim|approx|equiv|propto|perp|parallel|quad|qquad)(?=[a-zA-Z\\])/g, '\\$1 ');

  // Step 2: Split by existing $...$ and $$...$$ delimiters
  // Even-indexed parts are OUTSIDE math mode, odd-indexed are INSIDE
  const parts = s.split(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // Outside math mode — wrap any bare \command sequences in $...$
      parts[i] = parts[i].replace(
        /(\\[a-zA-Z]+(?:\{[^}]*\})*(?:[\^_](?:\{[^}]*\}|[0-9a-zA-Z]))*)/g,
        function(m) {
          if (/^\\[nrt]$/.test(m)) return m; // skip \n \r \t
          return ' $' + m + '$ ';
        }
      );
    }
  }
  return parts.join('');
}

// ── KaTeX render — scoped to target element, debounced ──────────────────
let _katexTimer = null;
function triggerMathJax(customTarget) {
  if (!window.renderMathInElement) return;
  const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
  if (prefs.useKatex === false) return;
  // Debounce: collapse rapid calls within 50ms into one
  clearTimeout(_katexTimer);
  _katexTimer = setTimeout(() => {
    // Target custom container or card — NOT the entire body unless necessary
    const target = customTarget || document.querySelector('.p-card') || document.body;
    try {
      renderMathInElement(target, {
        delimiters: [
          {left: '$$', right: '$$', display: true},
          {left: '$',  right: '$',  display: false},
          {left: '\\(', right: '\\)', display: false},
          {left: '\\[', right: '\\]', display: true}
        ],
        throwOnError: false,
        errorColor: '#ef4444'
      });
    } catch (err) {
      console.warn('KaTeX error:', err.message);
    }
  }, typeof IS_LOWEND !== 'undefined' && IS_LOWEND ? 120 : 50); // longer debounce on low-end to keep UI responsive
}


// ── Timer ──────────────────────────────────────────────────────────────
function startTimer() {
  if (S.timer === 0) return;
  clearInterval(state.timerInterval);
  state.timerSeconds = S.timer;
  $timerVal.className = 'timer-val';
  $timerVal.textContent = formatTime(state.timerSeconds);

  state.timerInterval = setInterval(() => {
    state.timerSeconds--;
    $timerVal.textContent = formatTime(state.timerSeconds);
    if (state.timerSeconds <= 10) $timerVal.className = 'timer-val critical';
    else if (state.timerSeconds <= 20) $timerVal.className = 'timer-val warning';
    if (state.timerSeconds <= 0) {
      clearInterval(state.timerInterval);
      if (!state.answered) timeUp();
    }
  }, 1000);
}

function stopTimer() { clearInterval(state.timerInterval); }

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${s}s`;
}

function timeUp() {
  state.answered = true;
  state.skipped++;
  addHistory('skipped', 'Time Up');
  showFeedback('skip');
  showNextRow();
}

// ── Load Question (with prefetch support) ─────────────────────────────
async function loadNextQuestion() {
  hide($errorCard);
  hide($questionPane);
  hide($answerPane);
  show($loading);

  const currentType = getNextQuestionType();
  state.currentQType = currentType;

  try {
    let data;

    if (S.exactQuestions && state.current < S.exactQuestions.length) {
      document.getElementById('loading-sub').textContent = `Loading Question ${state.current + 1} of ${state.total} — ${S.subject}`;
      data = { success: true, question: S.exactQuestions[state.current] };
      // Simulate network delay for UX
      await new Promise(r => setTimeout(r, 200));
    } else {
      if (prefetchPromise) {
        document.getElementById('loading-sub').textContent = 'Loading next question...';
        data = await prefetchPromise;
        prefetchPromise = null;
        if (!data || !data.success) {
          console.warn('Prefetch failed, doing a manual retry...');
          data = null;
        }
      }

      if (!data) {
        document.getElementById('loading-sub').textContent = `Question ${state.current + 1} of ${state.total} — ${S.subject}`;
        const res = await fetch('/api/generate-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: buildFetchBody(currentType),
        });
        data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed to generate question');
      }
    }

    state.currentQuestion = data.question;
    renderQuestion(data.question);
    hide($loading);
    show($questionPane);
    show($answerPane);
    updateProgress();
    startTimer();

  } catch (err) {
    hide($loading);
    show($errorCard);
    document.getElementById('error-title').textContent = 'Failed to generate question';
    document.getElementById('error-msg').textContent = err.message;
    prefetchPromise = null;
    console.error(err);
  }
}

// ── Render Question ────────────────────────────────────────────────────
function renderQuestion(q) {
  state.answered = false;
  $optGrid.innerHTML = '';
  hide($numWrap);
  hide($shortWrap);
  hide($feedback);
  hide($nextBtn);
  
  if (prefs.strictMode) {
    hide($skipBtn);
  } else {
    show($skipBtn);
  }
  
  document.getElementById('assertion-block').classList.add('hidden');
  const matchBlock = document.getElementById('match-block');
  if (matchBlock) matchBlock.classList.add('hidden');
  document.getElementById('given-block').classList.add('hidden');
  document.getElementById('deeper-result').classList.add('hidden');
  document.getElementById('steps-block').classList.add('hidden');
  document.getElementById('keypoints-block').classList.add('hidden');
  document.getElementById('correct-ans-block').classList.add('hidden');
  // Reset self-eval
  const selfEval = document.getElementById('self-eval-wrap');
  if (selfEval) selfEval.classList.add('hidden');
  const submitShortBtn = document.getElementById('submit-short-btn');
  if (submitShortBtn) { submitShortBtn.disabled = false; submitShortBtn.classList.remove('hidden'); }

  const typeLabels = { mcq: 'MCQ', numerical: 'Numerical', assertion: 'Assertion-Reason', short: 'Short Answer', predict: 'Predict Output', fib: 'Fill in Blanks', match: 'Match Following', tf: 'True / False' };
  document.getElementById('q-type-badge').textContent = typeLabels[q.type] || q.type.toUpperCase();
  document.getElementById('q-topic').textContent = q.topic || S.subject;
  const diffEl = document.getElementById('q-diff');
  diffEl.textContent = q.difficulty || S.difficulty;
  diffEl.className = 'p-q-diff ' + (q.difficulty || S.difficulty).toLowerCase();

  const qNumDisplay = document.getElementById('q-num-display');
  if (qNumDisplay) qNumDisplay.textContent = `Q${state.current + 1}`;

  // Update Nav Dots
  document.querySelectorAll('.p-dot').forEach(d => d.classList.remove('active'));
  const currentDot = document.getElementById(`nav-dot-${state.current}`);
  if (currentDot) currentDot.classList.add('active');

  if (q.type === 'assertion') {
    document.getElementById('q-text-main').textContent = '';
    const ab = document.getElementById('assertion-block');
    ab.classList.remove('hidden');
    document.getElementById('assertion-stmt').textContent = preprocessLatex(q.assertion);
    document.getElementById('reason-stmt').textContent = preprocessLatex(q.reason);
  } else if (q.type === 'predict') {
    document.getElementById('q-text-main').textContent = '';
    let text = String(q.question).replace(/\\n/g, '\n');
    text = text.replace(/```[a-z]*\n?/g, '').replace(/```/g, ''); // Strip markdown
    const parts = text.split('\n\n');
    if (parts.length > 1) {
       document.getElementById('q-text-main').innerHTML = `<div style="font-weight:500; margin-bottom:1rem;">${preprocessLatex(parts[0])}</div><pre style="background:var(--surface-2); color:var(--text); padding:1.25rem; border-radius:0.5rem; overflow-x:auto; font-family:monospace; font-size:0.95rem; line-height:1.5; border:1px solid var(--border); border-left: 4px solid #8b5cf6;"><code>${preprocessLatex(parts.slice(1).join('\n\n'))}</code></pre>`;
    } else {
       document.getElementById('q-text-main').innerHTML = `<pre style="background:var(--surface-2); color:var(--text); padding:1.25rem; border-radius:0.5rem; overflow-x:auto; font-family:monospace; font-size:0.95rem; line-height:1.5; border:1px solid var(--border); border-left: 4px solid #8b5cf6;"><code>${preprocessLatex(text)}</code></pre>`;
    }
  } else if (q.type === 'match') {
    document.getElementById('q-text-main').textContent = preprocessLatex(q.question);
    const mb = document.getElementById('match-block');
    if (mb) mb.classList.remove('hidden');
    const l1 = document.getElementById('match-list1');
    const l2 = document.getElementById('match-list2');
    if (l1) { l1.innerHTML = ''; (q.list1 || []).forEach(item => l1.appendChild(makeMathLi(item))); }
    if (l2) { l2.innerHTML = ''; (q.list2 || []).forEach(item => l2.appendChild(makeMathLi(item))); }
  } else {
    document.getElementById('q-text-main').textContent = preprocessLatex(q.question);
  }

  if (q.type === 'numerical' && q.given && q.given.length) {
    const gb = document.getElementById('given-block');
    const gl = document.getElementById('given-list');
    gl.innerHTML = '';
    q.given.forEach(g => gl.appendChild(makeMathLi(g)));
    gb.classList.remove('hidden');
  }

  if (q.type === 'mcq' || q.type === 'assertion' || q.type === 'match' || q.type === 'tf') {
    renderOptions(q);
  } else if (q.type === 'numerical') {
    show($numWrap);
    const numInput = document.getElementById('num-answer');
    const numBtn = document.getElementById('submit-num-btn');
    numInput.value = '';
    numInput.disabled = false;
    numBtn.disabled = false;
    numInput.focus();
  } else if (q.type === 'short' || q.type === 'predict' || q.type === 'fib') {
    show($shortWrap);
    const shortArea = document.getElementById('short-answer');
    const shortBtn = document.getElementById('submit-short-btn');
    shortArea.value = '';
    shortArea.disabled = false;
    shortBtn.disabled = false;
    shortArea.placeholder = q.type === 'predict' ? "Write the exact expected output here..." : q.type === 'fib' ? "Type the exact word or value for the blank..." : "Write your answer here...";
    shortArea.focus();
  }

  $questionPane.classList.remove('animate-in');
  $answerPane.classList.remove('animate-in');
  void $questionPane.offsetWidth;
  $questionPane.classList.add('animate-in');
  show($questionPane);
  show($answerPane);

  const rightPanel = document.getElementById('p-right');
  const leftPanel = document.getElementById('p-left');
  if (rightPanel) rightPanel.scrollTop = 0;
  if (leftPanel) leftPanel.scrollTop = 0;

  triggerMathJax();
  if (typeof switchFeedbackTab === 'function') switchFeedbackTab('solution');

  prefetchNext();
}

// ── Render MCQ / Assertion Options ────────────────────────────────────
function renderOptions(q) {
  // Client-side safety: patch TF options if server somehow didn't set them
  if (q.type === 'tf' && (!q.options || !Array.isArray(q.options) || q.options.length < 2)) {
    q.options = ['A) True', 'B) False'];
  }

  if (!q.options || !Array.isArray(q.options) || q.options.length < 2) {
    console.warn('Bad options data — auto-retrying silently...', q.options);
    // Auto-retry: skip this broken question and load the next one
    state.skipped++;
    state.streak = 0;
    $streak.textContent = state.streak;
    prefetchPromise = null; // clear stale prefetch
    setTimeout(() => {
      if (state.current + 1 >= state.total) {
        showSessionDone();
      } else {
        state.current++;
        updateProgress();
        loadNextQuestion();
      }
    }, 800);
    return;
  }

  const isAssertion = q.type === 'assertion';
  const isMatch = q.type === 'match';
  const isTF = q.type === 'tf';
  $optGrid.className = (isAssertion || isMatch || isTF) ? 'options-grid full-width' : 'options-grid';

  q.options.forEach((opt, i) => {
    const letters = ['A', 'B', 'C', 'D'];
    const btn = document.createElement('button');
    btn.className = 'option-btn';
    btn.id = `opt-${i}`;

    const letterSpan = document.createElement('span');
    letterSpan.className = 'p-opt-letter';
    letterSpan.textContent = letters[i];

    const textSpan = document.createElement('span');
    textSpan.className = 'p-opt-text';
    let text = String(opt).replace(/^[A-Da-d][\)\.]\s*/, '').replace(/\\n/g, ' ');
    text = text.replace(/\\v(?![a-zA-Z])/g, 'v');
    textSpan.textContent = preprocessLatex(text);

    btn.appendChild(letterSpan);
    btn.appendChild(textSpan);
    btn.onclick = () => checkMCQ(letters[i], btn, q);
    $optGrid.appendChild(btn);
  });
}

// ── MCQ Answer Check ──────────────────────────────────────────────────
function checkMCQ(chosen, btn, q) {
  if (state.answered) return;
  state.answered = true;
  stopTimer();

  const correct = (chosen.toUpperCase() === String(q.correct).trim().toUpperCase().charAt(0));
  btn.classList.add(correct ? 'correct' : 'wrong');

  if (!correct) {
    const letters = ['A', 'B', 'C', 'D'];
    const ci = letters.indexOf(q.correct.toUpperCase());
    if (ci >= 0) {
      const cb = document.getElementById(`opt-${ci}`);
      if (cb) cb.classList.add('correct');
    }
    const correctOptionRaw = (q.options[ci] || '');
    const correctOptionText = correctOptionRaw.replace(/^[A-Da-d][\)\.]\s*/, '');
    document.getElementById('correct-ans-block').classList.remove('hidden');
    document.getElementById('correct-ans-text').textContent = preprocessLatex(`${q.correct.toUpperCase()}) ${correctOptionText}`);
  }

  $optGrid.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

  if (correct) {
    state.correct++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.score += 10 + (state.streak > 2 ? (state.streak - 2) * 2 : 0);
    addHistory('correct', chosen);
    showFeedback('correct');
  } else {
    state.wrong++;
    state.streak = 0;
    addHistory('wrong', chosen);
    showFeedback('wrong');
  }
  $streak.textContent = state.streak;
  $score.textContent = state.score;
  showNextRow();
}

// ── Robust number extractor: strips LaTeX, handles sci notation ────────
function extractNumber(str) {
  let s = String(str || '')
    .replace(/,/g, '')                        // remove thousand separators
    .replace(/\$[^$]*\$/g, m => m.replace(/[\$\\a-zA-Z{}]/g, '')) // strip LaTeX $...$
    .replace(/[\$\\{} ]/g, '');              // strip remaining LaTeX chars

  // Normalise ×10^n and unicode superscripts → e-notation
  s = s.replace(/[×x]\s*10\s*\^\s*([+-]?\d+)/gi, 'e$1');
  s = s.replace(/[×x]\s*10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/gi, (_, sup) => {
    const map = {'⁰':'0','¹':'1','²':'2','³':'3','⁴':'4','⁵':'5',
                 '⁶':'6','⁷':'7','⁸':'8','⁹':'9','⁻':'-','⁺':'+'};
    return 'e' + [...sup].map(c => map[c] || c).join('');
  });

  const match = s.match(/[-+]?\d*\.?\d+(?:[eE][+-]?\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

// ── Numerical Answer Check ─────────────────────────────────────────────
function submitNumerical() {
  if (state.answered) return;
  const ans = document.getElementById('num-answer').value.trim();
  if (!ans) return;
  state.answered = true;
  stopTimer();

  const q = state.currentQuestion;
  document.getElementById('num-answer').disabled = true;
  document.getElementById('submit-num-btn').disabled = true;

  document.getElementById('correct-ans-block').classList.remove('hidden');
  document.getElementById('correct-ans-text').textContent = preprocessLatex(q.correct);

  if (q.steps && q.steps.length) {
    document.getElementById('steps-block').classList.remove('hidden');
    const sl = document.getElementById('steps-list');
    sl.innerHTML = '';
    q.steps.forEach(s => sl.appendChild(makeMathLi(s)));
  }

  // Use plain_answer (bare number from AI) if available; else parse q.correct
  const correctNum = (q.plain_answer !== undefined && q.plain_answer !== null)
    ? parseFloat(q.plain_answer)
    : extractNumber(q.correct);
  const userNum = extractNumber(ans);

  let isCorrect = false;
  if (userNum !== null && correctNum !== null && !isNaN(correctNum) && correctNum !== 0) {
    isCorrect = Math.abs(userNum - correctNum) / Math.abs(correctNum) <= 0.02; // 2% tolerance
  } else if (userNum !== null && correctNum === 0) {
    isCorrect = Math.abs(userNum) < 0.01;
  } else {
    // Last resort: string compare after stripping whitespace
    const cleanAns = ans.toLowerCase().replace(/[\s,]/g, '');
    const cleanCorrect = String(q.correct).toLowerCase().replace(/[\s,$\\{}a-zA-Z]/g, '');
    isCorrect = cleanAns === cleanCorrect;
  }

  if (isCorrect) {
    state.correct++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    
    let basePoints = 10;
    if (q.type === 'numerical' || q.type === 'predict' || q.type === 'match') basePoints = 20;
    else if (q.type === 'assertion' || q.type === 'short') basePoints = 15;
    else if (q.type === 'tf') basePoints = 5;
    
    const earned = basePoints + (state.streak > 2 ? (state.streak - 2) * 2 : 0);
    state.score += earned;
    
    addHistory('correct', ans);
    showFeedback('correct', earned);
  } else {
    state.wrong++;
    state.streak = 0;
    addHistory('wrong', ans);
    showFeedback('wrong');
  }

  $streak.textContent = state.streak;
  $score.textContent = state.score;
  showNextRow();
}

// ── Short Answer Check ─────────────────────────────────────────────────
// Helper to check key points containment locally
function checkKeywordsLocally(studentAnswer, keyPoints) {
  if (!keyPoints || !keyPoints.length) return false;

  const cleanStudent = studentAnswer.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const studentTokens = new Set(cleanStudent.split(/\s+/).filter(Boolean));

  for (const kp of keyPoints) {
    const cleanKp = kp.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
    const kpTokens = cleanKp.split(/\s+/).filter(w => w.length > 2); // ignore short words

    const tokensToVerify = kpTokens.length > 0 ? kpTokens : cleanKp.split(/\s+/).filter(Boolean);
    if (tokensToVerify.length === 0) continue;

    const matchesAll = tokensToVerify.every(token => {
      if (studentTokens.has(token)) return true;
      if (token.length >= 3) {
        for (const st of studentTokens) {
          if (st.includes(token)) return true;
        }
      }
      return false;
    });

    if (!matchesAll) return false;
  }
  return true;
}

// ── Short Answer Check ─────────────────────────────────────────────────
async function submitShort() {
  if (state.answered) return;
  const ans = document.getElementById('short-answer').value.trim();
  if (!ans) return;
  state.answered = true;
  stopTimer();

  const q = state.currentQuestion;
  document.getElementById('short-answer').disabled = true;
  const btn = document.getElementById('submit-short-btn');

  // Check locally first
  const isLocalMatch = checkKeywordsLocally(ans, q.key_points);
  if (isLocalMatch) {
    console.log('[GRADER] Perfect match identified locally, bypassing remote grading.');
    btn.classList.add('hidden');

    if (q.key_points && q.key_points.length) {
      document.getElementById('keypoints-block').classList.remove('hidden');
      const kpl = document.getElementById('kp-list');
      kpl.innerHTML = '';
      q.key_points.forEach(p => kpl.appendChild(makeMathLi(p)));
    }
    if (q.answer || q.correct) {
      document.getElementById('correct-ans-block').classList.remove('hidden');
      document.getElementById('correct-ans-text').textContent = preprocessLatex(q.answer || q.correct);
    }

    state.correct++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    const earned = 15 + (state.streak > 2 ? (state.streak - 2) * 2 : 0) + 10;
    state.score += earned;
    addHistory('correct', ans);
    showFeedback('correct', earned);

    const expDiv = document.getElementById('exp-text');
    expDiv.innerHTML = `<div style="background:rgba(16,185,129,0.1);padding:1rem;border-radius:8px;margin-bottom:1rem;border-left:4px solid var(--emerald)">
      <strong style="color:var(--text-bright)">Perfect Match! (Local Heuristic Check)</strong><br>
      <span style="color:var(--text-muted);font-size:0.9rem">Your answer contains all the required key points: ${q.key_points.join(', ')}</span>
    </div>` + expDiv.innerHTML;

    $streak.textContent = state.streak;
    $score.textContent = state.score;
    showNextRow();
    return;
  }

  btn.textContent = '🤖 AI is grading...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/grade-short', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: q.question,
        modelAnswer: q.answer || q.correct,
        keyPoints: q.key_points || [],
        studentAnswer: ans
      })
    });
    const data = await res.json();
    btn.classList.add('hidden');

    if (q.key_points && q.key_points.length) {
      document.getElementById('keypoints-block').classList.remove('hidden');
      const kpl = document.getElementById('kp-list');
      kpl.innerHTML = '';
      q.key_points.forEach(p => kpl.appendChild(makeMathLi(p)));
    }
    if (q.answer || q.correct) {
      document.getElementById('correct-ans-block').classList.remove('hidden');
      document.getElementById('correct-ans-text').textContent = preprocessLatex(q.answer || q.correct);
    }

    const isCorrect = data.score >= 5; // Passing grade
    
    if (isCorrect) {
      state.correct++;
      state.streak++;
      state.bestStreak = Math.max(state.bestStreak, state.streak);
      const earned = 15 + (state.streak > 2 ? (state.streak - 2) * 2 : 0) + data.score;
      state.score += earned;
      addHistory('correct', ans);
      showFeedback('correct', earned);
    } else {
      state.wrong++;
      state.streak = 0;
      addHistory('wrong', ans);
      showFeedback('wrong');
    }
    
    const expDiv = document.getElementById('exp-text');
    expDiv.innerHTML = `<div style="background:var(--bg-light);padding:1rem;border-radius:8px;margin-bottom:1rem;border-left:4px solid var(${isCorrect ? '--emerald' : '--red'})">
      <strong style="color:var(--text-bright)">AI Score: ${data.score}/10</strong><br>
      <span style="color:var(--text-muted);font-size:0.9rem">${data.feedback}</span>
    </div>` + expDiv.innerHTML;

    $streak.textContent = state.streak;
    $score.textContent = state.score;
    showNextRow();

  } catch(err) {
    console.error(err);
    alert('Failed to grade answer automatically.');
    btn.textContent = 'Submit';
    btn.disabled = false;
    state.answered = false;
  }
}

// ── Self-Evaluation (called by ✅ / ❌ buttons) ────────────────────────
function selfEvaluate(result) {
  if (state.answered) return;
  state.answered = true;

  const ans = document.getElementById('short-answer').value.trim();
  const selfEval = document.getElementById('self-eval-wrap');
  if (selfEval) selfEval.classList.add('hidden');

  const header = document.getElementById('feedback-header');
  const icon   = document.getElementById('feedback-icon');
  const title  = document.getElementById('feedback-title');
  const points = document.getElementById('feedback-points');

  if (result === 'correct') {
    state.correct++;
    state.streak++;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    state.score += 10 + (state.streak > 2 ? (state.streak - 2) * 2 : 0);
    addHistory('correct', ans);
    header.className = 'p-verdict correct-bg';
    icon.textContent  = '✅';
    title.textContent = 'Self-marked Correct!';
    title.style.color = 'var(--green)';
    points.textContent = `+${10 + (state.streak > 2 ? (state.streak - 2) * 2 : 0)} pts`;
  } else {
    state.wrong++;
    state.streak = 0;
    addHistory('wrong', ans);
    header.className = 'p-verdict wrong-bg';
    icon.textContent  = '❌';
    title.textContent = 'Self-marked Incorrect';
    title.style.color = 'var(--red)';
    points.textContent = '+0 pts';
  }

  $streak.textContent = state.streak;
  $score.textContent  = state.score;
  showNextRow();
}


// ── Skip ──────────────────────────────────────────────────────────────
function skipQuestion() {
  if (state.answered) return;
  state.answered = true;
  stopTimer();
  state.skipped++;
  state.streak = 0;
  $streak.textContent = state.streak;
  addHistory('skipped', '–');
  showFeedback('skip');
  showNextRow();
}

// ── Feedback Panel ─────────────────────────────────────────────────────
function showFeedback(type) {
  const q = state.currentQuestion;
  const header = document.getElementById('feedback-header');
  const icon = document.getElementById('feedback-icon');
  const title = document.getElementById('feedback-title');
  const points = document.getElementById('feedback-points');

  if (type === 'correct') {
    header.className = 'p-verdict correct-bg';
    icon.textContent = '✅';
    title.textContent = state.streak > 2 ? `Correct! 🔥 ${state.streak} streak!` : 'Correct!';
    title.style.color = 'var(--emerald)';
    
    // We pass the earned points as the second argument, if not provided default to old logic
    let earnedPoints = arguments[1];
    if (earnedPoints === undefined) {
      let basePoints = 10;
      if (q.type === 'numerical' || q.type === 'predict' || q.type === 'match') basePoints = 20;
      else if (q.type === 'assertion' || q.type === 'short') basePoints = 15;
      else if (q.type === 'tf') basePoints = 5;
      earnedPoints = basePoints + (state.streak > 2 ? (state.streak - 2) * 2 : 0);
    }
    points.textContent = `+${earnedPoints}`;
  } else if (type === 'wrong') {
    header.className = 'p-verdict wrong-bg';
    icon.textContent = '❌';
    title.textContent = 'Incorrect';
    title.style.color = 'var(--red)';
    points.textContent = '+0';
    
    // Proactive AI Chatbot Toast
    if (window.showChatHintToast) {
      window.showChatHintToast(
        "Stuck on this question? Ask Study Buddy for a hint!",
        `I am stuck on this question: "${q.question}". Can you help me understand what I did wrong or give me a hint?`
      );
    }
  } else if (type === 'short') {
    header.className = 'p-verdict';
    header.style.background = 'rgba(139,92,246,0.1)';
    icon.textContent = '📝';
    title.textContent = 'Self-evaluate your answer:';
    title.style.color = 'var(--purple-light)';
    points.textContent = '';
  } else {
    header.className = 'p-verdict skip-bg';
    icon.textContent = '⏭';
    title.textContent = type === 'skip' && state.answered && state.skipped > 0 ? 'Skipped' : 'Time Up!';
    title.style.color = 'var(--text-muted)';
    points.textContent = '+0';

    // Proactive AI Chatbot Toast
    let consecutiveSkips = 0;
    for (let i = state.history.length - 1; i >= 0; i--) {
      if (state.history[i].result === 'skipped') consecutiveSkips++;
      else break;
    }
    if (window.showChatHintToast && type === 'skip' && consecutiveSkips >= 2) {
      window.showChatHintToast(
        "Need help with the question you skipped?",
        `I skipped this question: "${q.question}". Can you explain how to solve it?`
      );
    }
  }

  let exp = String(q.explanation || '').replace(/\\n/g, '\n');
  exp = exp.replace(/\s?([A-D]\sWRONG:)/g, '\n\n$1');
  exp = exp.replace(/^(CORRECT:)/g, '$1');
  exp = preprocessLatex(exp.trim());
  document.getElementById('exp-text').textContent = exp;

  document.getElementById('deeper-btn').disabled = false;
  document.getElementById('deeper-btn').textContent = '🔍 Explain More Deeply';

  show($feedback);

  const rightPanel = document.getElementById('p-right');
  if (rightPanel) {
    rightPanel.scrollTo({ top: rightPanel.scrollHeight, behavior: 'smooth' });
  }

  triggerMathJax();

  // Handle Auto-Advance Setting
  if (type === 'correct' && prefs.autoAdvance) {
    $nextBtn.textContent = 'Auto-Advancing...';
    $nextBtn.disabled = true;
    setTimeout(() => {
      $nextBtn.disabled = false;
      $nextBtn.textContent = 'Next Question >';
      if (!state.sessionEnded) nextQuestion();
    }, 1800);
  } else {
    $nextBtn.textContent = 'Next Question >';
  }

  // Update Nav Dot Color
  const currentDot = document.getElementById(`nav-dot-${state.current}`);
  if (currentDot) {
    if (type === 'correct') currentDot.classList.add('correct');
    else if (type === 'wrong') currentDot.classList.add('wrong');
    else if (type === 'skip') currentDot.classList.add('skip');
    else currentDot.classList.add('correct'); // short answer
  }
}

function switchFeedbackTab(tab) {
  document.getElementById('tab-btn-solution').classList.toggle('active', tab === 'solution');
  document.getElementById('tab-btn-analysis').classList.toggle('active', tab === 'analysis');
  document.getElementById('tab-solution').classList.toggle('active', tab === 'solution');
  document.getElementById('tab-analysis').classList.toggle('active', tab === 'analysis');
}

function showNextRow() {
  hide($skipBtn);
  show($nextBtn);
}

// ── Next Question ─────────────────────────────────────────────────────
function nextQuestion() {
  state.current++;
  if (state.current >= state.total) {
    showSessionDone();
  } else {
    loadNextQuestion();
  }
}

// ── Deeper Explanation ─────────────────────────────────────────────────
async function getDeeperExplanation() {
  const btn = document.getElementById('deeper-btn');
  const resultEl = document.getElementById('deeper-result');
  const textEl = document.getElementById('deeper-text');

  btn.disabled = true;
  btn.textContent = '⏳ Loading...';
  show(resultEl);
  textEl.textContent = 'Fetching deeper explanation...';

  try {
    const res = await fetch('/api/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: state.currentQuestion, subject: S.subject, examType: S.examType }),
    });
    const data = await res.json();
    if (data.success) {
      textEl.textContent = preprocessLatex(data.explanation);
      btn.textContent = '✓ Explained';
      triggerMathJax();
    } else {
      textEl.textContent = 'Could not fetch deeper explanation. ' + (data.error || '');
      btn.disabled = false;
      btn.textContent = '🔍 Retry';
    }
  } catch (err) {
    textEl.textContent = 'Network error: ' + err.message;
    btn.disabled = false;
    btn.textContent = '🔍 Retry';
  }
}

// ── Offline Progress Sync Queue ──────────────────────────────────────
function queueProgressPayload(payload) {
  try {
    const queue = JSON.parse(localStorage.getItem('infinitySyncQueue') || '[]');
    queue.push(payload);
    localStorage.setItem('infinitySyncQueue', JSON.stringify(queue));
    console.log('[SYNC] Saved event to offline queue. Queue size:', queue.length);
  } catch (e) {
    console.warn('[SYNC] Failed to queue progress offline:', e);
  }
}

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

  console.log(`[SYNC] Attempting to flush ${queue.length} offline progress tracking items...`);
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

function trackProgress(payload) {
  if (!navigator.onLine) {
    queueProgressPayload(payload);
    return;
  }
  fetch('/api/track-progress', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(res => {
    if (!res.ok) {
      queueProgressPayload(payload);
    } else {
      res.json().then(data => {
        if (!data || !data.success) {
          queueProgressPayload(payload);
        }
      }).catch(() => {
        queueProgressPayload(payload);
      });
    }
  })
  .catch(() => {
    queueProgressPayload(payload);
  });
}

// ── History ────────────────────────────────────────────────────────────
function addHistory(result, userAnswer) {
  state.history.push({
    question: state.currentQuestion,
    result,
    userAnswer,
    qNumber: state.current + 1,
  });
  
  // Track to SQLite Database (via offline-aware wrapper)
  trackProgress({
    subject: S.subject,
    topic: state.currentQuestion?.topic || 'General',
    questionType: state.currentQuestion?.type || 'unknown',
    difficulty: S.difficulty,
    result: result // 'correct', 'wrong', or 'skipped'
  });
}

// ── Save to localStorage (persistent history) ─────────────────────────
function saveToLocalHistory(resultsData) {
  try {
    const allHistory = JSON.parse(localStorage.getItem('infinityHistory') || '[]');
    allHistory.push(resultsData);
    // Keep last 100 sessions max
    if (allHistory.length > 100) allHistory.splice(0, allHistory.length - 100);
    localStorage.setItem('infinityHistory', JSON.stringify(allHistory));
    console.log('[HISTORY] Saved session to localStorage. Total sessions:', allHistory.length);
  } catch (e) {
    console.warn('[HISTORY] Failed to save:', e.message);
  }
}

// ── Confetti Celebration ──────────────────────────────────────────────
function triggerConfettiCelebration() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  const resizeCanvas = () => {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  };
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  const colors = [
    '#6366f1', '#3b82f6', '#10b981', '#f59e0b', 
    '#ef4444', '#ec4899', '#8b5cf6', '#06b6d4'
  ];
  
  const particles = [];
  const particleCount = 100;
  
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: canvas.width / 2 + (Math.random() - 0.5) * 80,
      y: canvas.height / 2 + (Math.random() - 0.5) * 40 - 50,
      radius: Math.random() * 4 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      angle: Math.random() * Math.PI * 2,
      speed: Math.random() * 8 + 4,
      friction: 0.95,
      gravity: 0.22,
      opacity: 1,
      fadeSpeed: Math.random() * 0.008 + 0.004,
      rotation: Math.random() * Math.PI,
      rotationSpeed: (Math.random() - 0.5) * 0.15
    });
  }
  
  let animationId;
  const update = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    
    particles.forEach(p => {
      if (p.opacity <= 0) return;
      alive = true;
      
      p.speed *= p.friction;
      p.x += Math.cos(p.angle) * p.speed;
      p.y += Math.sin(p.angle) * p.speed + p.gravity;
      p.opacity -= p.fadeSpeed;
      p.rotation += p.rotationSpeed;
      
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.opacity);
      ctx.fillRect(-p.radius, -p.radius / 2, p.radius * 2, p.radius);
      ctx.restore();
    });
    
    if (alive) {
      animationId = requestAnimationFrame(update);
    } else {
      window.removeEventListener('resize', resizeCanvas);
    }
  };
  
  animationId = requestAnimationFrame(update);
}

// ── Session Done ──────────────────────────────────────────────────────
function showSessionDone() {
  state.sessionEnded = true;
  updateProgress();
  stopTimer();

  const total = state.correct + state.wrong + state.skipped;
  const pct = total > 0 ? Math.round((state.correct / total) * 100) : 0;

  document.getElementById('fs-correct').textContent = state.correct;
  document.getElementById('fs-wrong').textContent = state.wrong;
  document.getElementById('fs-skipped').textContent = state.skipped;
  document.getElementById('fs-streak').textContent = state.bestStreak;
  document.getElementById('ring-pct').textContent = pct + '%';

  const emojis = ['😓', '😐', '🙂', '😊', '🎉', '🏆'];
  const ei = Math.min(Math.floor(pct / 20), 5);
  document.getElementById('done-emoji').textContent = emojis[ei];

  setTimeout(() => {
    const fill = document.getElementById('ring-fill-el');
    const ringSvg = document.querySelector('.ring-svg');
    const circumference = 314;
    fill.style.strokeDashoffset = circumference - (pct / 100) * circumference;

    // Dynamically color based on score with matching glow filters
    let strokeColor = '';
    let glowColor = '';
    if (pct >= 80) {
      strokeColor = 'var(--green)';
      glowColor = 'rgba(16, 185, 129, 0.4)';
    } else if (pct >= 60) {
      strokeColor = 'var(--cyan)';
      glowColor = 'rgba(14, 165, 233, 0.4)';
    } else if (pct >= 40) {
      strokeColor = 'var(--amber)';
      glowColor = 'rgba(245, 158, 11, 0.4)';
    } else {
      strokeColor = 'var(--red)';
      glowColor = 'rgba(239, 68, 68, 0.4)';
    }
    
    fill.style.stroke = strokeColor;
    if (ringSvg) {
      ringSvg.style.filter = `drop-shadow(0 0 10px ${glowColor})`;
    }
  }, 100);

  show($doneOverlay);
  
  // Trigger particle explosion for score >= 50%
  if (pct >= 50) {
    setTimeout(triggerConfettiCelebration, 400); // slight delay for impact!
  }

  const resultsData = {
    settings: S,
    score: state.score,
    correct: state.correct,
    wrong: state.wrong,
    skipped: state.skipped,
    bestStreak: state.bestStreak,
    pct,
    history: state.history,
    date: new Date().toISOString(),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
  };

  sessionStorage.setItem('practiceResults', JSON.stringify(resultsData));
  saveToLocalHistory(resultsData);
}

function goToResults() {
  window.location.href = 'results.html';
}

function restartSession() {
  typeIndex = 0;
  state = {
    current: 0, total: S.count, score: 0, correct: 0,
    wrong: 0, skipped: 0, streak: 0, bestStreak: 0,
    history: [], timerSeconds: S.timer, timerInterval: null,
    currentQuestion: null, currentQType: null, answered: false,
  };
  hide($doneOverlay);
  loadNextQuestion();
}

// ── Enter key for numerical input ────────────────────────────────────
document.getElementById('num-answer').addEventListener('keydown', e => {
  if (e.key === 'Enter') submitNumerical();
});

// ── SVG Gradient for ring ────────────────────────────────────────────
document.querySelector('.ring-svg').insertAdjacentHTML('beforeend', `
  <defs>
    <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#8b5cf6"/>
      <stop offset="100%" stop-color="#22d3ee"/>
    </linearGradient>
  </defs>
`);

// ── Question Navigator & Review ──────────────────────────────────────────
function initNavDots() {
  const container = document.getElementById('p-nav-dots');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 0; i < state.total; i++) {
    const dot = document.createElement('button');
    dot.className = 'p-dot';
    dot.id = `nav-dot-${i}`;
    dot.textContent = i + 1;
    dot.onclick = () => reviewQuestion(i);
    container.appendChild(dot);
  }
}

function reviewQuestion(index) {
  if (index >= state.current && !state.sessionEnded) return;
  const h = state.history.find(x => x.qNumber === index + 1);
  if (!h) return;

  document.getElementById('rm-title').textContent = `Review Q${index + 1}`;

  const container = document.getElementById('rm-content');
  container.innerHTML = ''; // clear safely — no user content here

  // ── Helper: safe text paragraph ──────────────────────────────────────
  function makeRow(label, value) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'margin-bottom:0.5rem; color:var(--text); font-size:0.9rem;';
    const strong = document.createElement('strong');
    strong.textContent = label + ': ';
    const span = document.createElement('span');
    span.textContent = preprocessLatex(String(value || '-'));
    wrap.appendChild(strong);
    wrap.appendChild(span);
    return wrap;
  }

  // ── Outer card ───────────────────────────────────────────────────────
  const card = document.createElement('div');
  card.style.cssText = 'padding:1.5rem; background:var(--panel); border-radius:12px; border:1px solid var(--border); display:flex; flex-direction:column; gap:1rem;';

  // Result badge
  const badge = document.createElement('div');
  badge.style.cssText = `font-weight:800; font-size:1.05rem; color:${
    h.result === 'correct' ? 'var(--green)' : h.result === 'wrong' ? 'var(--red)' : 'var(--muted)'
  };`;
  badge.textContent = h.result === 'correct' ? '✅ Correct' : h.result === 'wrong' ? '❌ Incorrect' : '⏭ Skipped';
  card.appendChild(badge);

  // Question text (safe)
  const qWrap = document.createElement('div');
  qWrap.style.cssText = 'font-size:1rem; line-height:1.6; color:var(--text);';
  if (h.question.type === 'assertion') {
    const aLabel = document.createElement('strong'); aLabel.textContent = 'Assertion (A): ';
    const aText  = document.createElement('span');   aText.textContent = preprocessLatex(h.question.assertion || '');
    const br     = document.createElement('br');
    const rLabel = document.createElement('strong'); rLabel.textContent = 'Reason (R): ';
    const rText  = document.createElement('span');   rText.textContent = preprocessLatex(h.question.reason || '');
    [aLabel, aText, br, rLabel, rText].forEach(el => qWrap.appendChild(el));
  } else if (h.question.type === 'predict') {
    const raw = String(h.question.question).replace(/\\n/g, '\n').replace(/```[a-z]*\n?/g, '').replace(/```/g, '');
    const parts = raw.split('\n\n');
    if (parts.length > 1) {
      const intro = document.createElement('div');
      intro.textContent = preprocessLatex(parts[0]);
      intro.style.marginBottom = '0.5rem';
      const pre = document.createElement('pre');
      pre.style.cssText = 'background:var(--bg); padding:1rem; border-radius:8px; font-family:var(--mono); font-size:0.88rem; overflow-x:auto;';
      const code = document.createElement('code');
      code.textContent = preprocessLatex(parts.slice(1).join('\n\n'));
      pre.appendChild(code);
      qWrap.appendChild(intro);
      qWrap.appendChild(pre);
    } else {
      const pre = document.createElement('pre');
      pre.style.cssText = 'background:var(--bg); padding:1rem; border-radius:8px; font-family:var(--mono); font-size:0.88rem; overflow-x:auto;';
      const code = document.createElement('code');
      code.textContent = preprocessLatex(raw);
      pre.appendChild(code);
      qWrap.appendChild(pre);
    }
  } else if (h.question.type === 'match') {
    const title = document.createElement('div');
    title.textContent = preprocessLatex(h.question.question || '');
    qWrap.appendChild(title);
    
    const listsBox = document.createElement('div');
    listsBox.style.cssText = 'display:flex; gap:1rem; margin:1rem 0; font-size:0.9rem; background:var(--surface-2); padding:1rem; border-radius:8px; border:1px solid var(--border);';
    const l1 = document.createElement('div'); l1.style.flex = '1';
    const l2 = document.createElement('div'); l2.style.flex = '1';
    l1.innerHTML = '<strong>List I</strong><ul style="padding-left:0;margin-top:0.5rem;list-style-type:none;gap:0.25rem;display:flex;flex-direction:column;">' + (h.question.list1||[]).map(x=>`<li>${preprocessLatex(x)}</li>`).join('') + '</ul>';
    l2.innerHTML = '<strong>List II</strong><ul style="padding-left:0;margin-top:0.5rem;list-style-type:none;gap:0.25rem;display:flex;flex-direction:column;">' + (h.question.list2||[]).map(x=>`<li>${preprocessLatex(x)}</li>`).join('') + '</ul>';
    listsBox.appendChild(l1);
    listsBox.appendChild(l2);
    qWrap.appendChild(listsBox);
  } else {
    qWrap.textContent = preprocessLatex(h.question.question || '');
  }
  card.appendChild(qWrap);

  // Helper to extract full option text
  function getOptText(q, letter) {
    if (!q.options || !letter) return letter;
    const idx = ['A','B','C','D'].indexOf(String(letter).trim().toUpperCase());
    if (idx >= 0 && q.options[idx]) return letter + ') ' + q.options[idx].replace(/^[A-Da-d]\)\s*/, '');
    return letter;
  }

  let userA = h.userAnswer;
  let corrA = h.question.correct || h.question.answer;
  if (h.question.type === 'mcq' || h.question.type === 'assertion' || h.question.type === 'match' || h.question.type === 'tf') {
    userA = getOptText(h.question, userA);
    corrA = getOptText(h.question, corrA);
  }

  card.appendChild(makeRow('Your Answer', userA));
  card.appendChild(makeRow('Correct Answer', corrA));

  // Explanation box
  const expBox = document.createElement('div');
  expBox.style.cssText = 'background:rgba(99,102,241,0.08); padding:1.25rem; border-radius:10px; border-left:4px solid var(--primary); color:var(--text); font-size:0.88rem; line-height:1.7;';
  const expLabel = document.createElement('strong');
  expLabel.textContent = '💡 Explanation';
  const expBr = document.createElement('br');
  const expText = document.createElement('span');
  expText.textContent = preprocessLatex(String(h.question.explanation || 'No explanation available.').replace(/\\n/g, '\n'));
  expBox.appendChild(expLabel);
  expBox.appendChild(expBr);
  expBox.appendChild(expText);
  card.appendChild(expBox);

  container.appendChild(card);
  document.getElementById('review-modal-overlay').classList.remove('hidden');
  triggerMathJax(container);
}

// ── Start ─────────────────────────────────────────────────────────────
initNavDots();
loadNextQuestion();

// Event listeners to flush sync queue when browser goes online or page loads
window.addEventListener('online', flushSyncQueue);
window.addEventListener('load', flushSyncQueue);
