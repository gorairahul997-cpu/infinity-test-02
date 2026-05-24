/* paper.js — Direct PDF download with html2pdf.js */

const raw = sessionStorage.getItem('pdfQuestions');
if (!raw) { window.location.href = 'index.html'; }
const P = JSON.parse(raw);
const questions = P.questions;
const settings = P.settings;

function triggerMathJax() {
  return new Promise(resolve => {
    if (window.renderMathInElement) {
      const prefs = JSON.parse(localStorage.getItem('infinityPrefs') || '{}');
      if (prefs.useKatex === false) {
        resolve();
        return;
      }
      try {
        const target = document.querySelector('.paper-main-content') || document.body;
        renderMathInElement(target, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\(', right: '\\)', display: false},
            {left: '\\[', right: '\\]', display: true}
          ],
          throwOnError: false,
          errorColor: '#ef4444'
        });
      } catch (err) {
        console.error('KaTeX error:', err.message);
      }
    }
    resolve();
  });
}

// ── Preprocess LaTeX: wrap bare \commands in $...$ so KaTeX finds them ─
function preprocessLatex(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/(\\[a-zA-Z]+\{[^}]*\}(?:\{[^}]*\})?)/g, function(match) {
    return match.replace(/\$/g, '');
  });
  s = s.replace(/\\(cdot|times|div|pm|mp|to|in|cap|cup|circ|le|ge|ne|ll|gg|sim|approx|equiv|propto|perp|parallel|quad|qquad)(?=[a-zA-Z\\])/g, '\\$1 ');
  const parts = s.split(/(\$\$[\s\S]*?\$\$|\$[^$]*?\$)/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
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

// ── Clean question text: strip embedded options AI sometimes puts inside ──
function cleanQuestionText(text) {
  if (!text) return '';
  return text
    .replace(/\\n[A-D][\)\.].*/g, '')
    .replace(/\n[A-D][\)\.].*/g, '')
    .trim();
}

// ── Format explanation text ──
function formatExplanation(exp) {
  if (!exp) return '';
  return exp
    .replace(/\\n/g, '<br>')
    .replace(/\n/g, '<br>')
    .replace(/\s?([A-D]\sWRONG:)/g, '<br><br>$1')
    .replace(/^\s*(CORRECT:)/g, '$1');
}

// ── Build Question Paper ──────────────────────────────────────────────
function buildQuestionPaper() {
  const dateStr = new Date(P.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

  document.getElementById('sheet-title').textContent =
    `${settings.subject} — ${settings.examType} Practice Paper`;

  const meta = document.getElementById('sheet-meta');
  meta.innerHTML = ''; // Clear safe container
  const metaParts = [
    `Class: ${settings.classLevel || '12'}`,
    `Difficulty: ${settings.difficulty}`,
    `Date: ${dateStr}`,
    `Total Questions: ${questions.length}`
  ];
  if (settings.topic) metaParts.push(`Topic: ${settings.topic}`);
  
  metaParts.forEach((part, i) => {
    const span = document.createElement('span');
    span.textContent = part;
    meta.appendChild(span);
    if (i < metaParts.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = ' | ';
      meta.appendChild(sep);
    }
  });

  const body = document.getElementById('sheet-body');
  body.innerHTML = '';

  questions.forEach((q, idx) => {
    const qDiv = document.createElement('div');
    qDiv.className = 'paper-question';

    const typeLabels = { mcq: 'MCQ', numerical: 'Numerical', assertion: 'Assertion-Reason', short: 'Short Answer', predict: 'Predict Output', fib: 'Fill in Blanks', match: 'Match Following', tf: 'True / False' };

    const header = document.createElement('div');
    header.className = 'pq-header';
    const numSpan = document.createElement('span'); numSpan.className = 'pq-num'; numSpan.textContent = `Q${idx + 1}.`;
    const typeSpan = document.createElement('span'); typeSpan.className = 'pq-type'; typeSpan.textContent = `[${typeLabels[q.type] || q.type}]`;
    const topicSpan = document.createElement('span'); topicSpan.className = 'pq-topic'; topicSpan.textContent = q.topic || '';
    header.append(numSpan, typeSpan, topicSpan);
    qDiv.appendChild(header);

    if (q.type === 'assertion') {
      const bdy = document.createElement('div'); bdy.className = 'pq-body';
      const pA = document.createElement('p'); pA.className = 'pq-assertion';
      const sA = document.createElement('strong'); sA.textContent = 'Assertion (A): ';
      pA.append(sA, document.createTextNode(preprocessLatex(q.assertion)));
      const pR = document.createElement('p'); pR.className = 'pq-reason';
      const sR = document.createElement('strong'); sR.textContent = 'Reason (R): ';
      pR.append(sR, document.createTextNode(preprocessLatex(q.reason)));
      bdy.append(pA, pR);
      qDiv.appendChild(bdy);
    } else if (q.type === 'match') {
      const pText = document.createElement('p'); pText.className = 'pq-text';
      pText.textContent = preprocessLatex(cleanQuestionText(q.question));
      qDiv.appendChild(pText);
      const matchLists = document.createElement('div');
      matchLists.style.cssText = 'display:flex; justify-content:space-around; margin: 1rem 0; font-size: 0.95rem;';
      const l1 = document.createElement('div');
      const l2 = document.createElement('div');

      const strong1 = document.createElement('strong'); strong1.textContent = 'List I';
      const ul1 = document.createElement('ul'); ul1.style.cssText = 'list-style:none; padding:0; margin-top:0.5rem;';
      (q.list1 || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = preprocessLatex(item);
        ul1.appendChild(li);
      });
      l1.innerHTML = '';
      l1.append(strong1, ul1);

      const strong2 = document.createElement('strong'); strong2.textContent = 'List II';
      const ul2 = document.createElement('ul'); ul2.style.cssText = 'list-style:none; padding:0; margin-top:0.5rem;';
      (q.list2 || []).forEach(item => {
        const li = document.createElement('li');
        li.textContent = preprocessLatex(item);
        ul2.appendChild(li);
      });
      l2.innerHTML = '';
      l2.append(strong2, ul2);

      matchLists.append(l1, l2);
      qDiv.appendChild(matchLists);
    } else {
      const pText = document.createElement('p'); pText.className = 'pq-text';
      pText.textContent = preprocessLatex(cleanQuestionText(q.question));
      qDiv.appendChild(pText);
    }

    if (q.given && q.given.length) {
      const divGiven = document.createElement('div'); divGiven.className = 'pq-given';
      const sGiven = document.createElement('strong'); sGiven.textContent = 'Given: ';
      divGiven.append(sGiven, document.createTextNode(preprocessLatex(q.given.join(', '))));
      qDiv.appendChild(divGiven);
    }

    if (q.options && q.options.length) {
      const divOpts = document.createElement('div'); divOpts.className = 'pq-options';
      q.options.forEach(opt => {
        const divOpt = document.createElement('div'); divOpt.className = 'pq-opt';
        divOpt.textContent = preprocessLatex(opt);
        divOpts.appendChild(divOpt);
      });
      qDiv.appendChild(divOpts);
    }

    if (q.type === 'numerical') {
      const ansSpace = document.createElement('div'); ansSpace.className = 'pq-answer-space';
      const em = document.createElement('em'); em.textContent = 'Answer: _________________';
      ansSpace.appendChild(em);
      qDiv.appendChild(ansSpace);
    } else if (q.type === 'short' || q.type === 'fib' || q.type === 'predict') {
      const ansSpace = document.createElement('div'); ansSpace.className = 'pq-answer-space lines';
      ansSpace.innerHTML = '<div class="line"></div>' + (q.type !== 'fib' ? '<div class="line"></div><div class="line"></div>' : ''); 
      qDiv.appendChild(ansSpace);
    }

    body.appendChild(qDiv);
  });
}

// ── Build Answer Key ──────────────────────────────────────────────────
function buildAnswerKey() {
  const dateStr = new Date(P.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const ansBody = document.getElementById('answer-body');
  ansBody.innerHTML = '';

  document.getElementById('answer-title').textContent =
    `Answer Key — ${settings.subject} ${settings.examType}`;

  const meta = document.getElementById('answer-meta');
  meta.innerHTML = ''; // Clear safe container
  const metaParts = [
    `Class: ${settings.classLevel || '12'}`,
    `Date: ${dateStr}`,
    `Total Questions: ${questions.length}`
  ];
  metaParts.forEach((part, i) => {
    const span = document.createElement('span');
    span.textContent = part;
    meta.appendChild(span);
    if (i < metaParts.length - 1) {
      const sep = document.createElement('span');
      sep.textContent = ' | ';
      meta.appendChild(sep);
    }
  });

  questions.forEach((q, idx) => {
    const aDiv = document.createElement('div');
    aDiv.className = 'answer-item';

    const header = document.createElement('div');
    header.className = 'ai-header';
    const numSpan = document.createElement('span'); numSpan.className = 'ai-num'; numSpan.textContent = `Q${idx + 1}.`;
    const ansSpan = document.createElement('span'); ansSpan.className = 'ai-answer';
    const sAns = document.createElement('strong');
    
    if (q.type === 'mcq' || q.type === 'assertion' || q.type === 'match' || q.type === 'tf') {
      const ci = ['A','B','C','D'].indexOf(q.correct);
      const optText = q.options ? (q.options[ci] || '') : '';
      sAns.textContent = `${q.correct}) `;
      ansSpan.append(sAns, document.createTextNode(preprocessLatex(optText.replace(/^[A-D]\)\s*/, ''))));
    } else if (q.type === 'numerical') {
      sAns.textContent = q.correct;
      ansSpan.appendChild(sAns);
    } else {
      sAns.textContent = preprocessLatex(q.answer || q.correct);
      ansSpan.appendChild(sAns);
    }
    header.append(numSpan, ansSpan);
    aDiv.appendChild(header);

    if (q.explanation) {
      const pExp = document.createElement('p'); pExp.className = 'ai-explanation';
      // explanation has <br> from formatExplanation
      const parts = formatExplanation(q.explanation).split('<br>');
      pExp.appendChild(document.createTextNode('💡 '));
      parts.forEach((p, i) => {
        pExp.appendChild(document.createTextNode(preprocessLatex(p)));
        if (i < parts.length - 1) pExp.appendChild(document.createElement('br'));
      });
      aDiv.appendChild(pExp);
    }

    if (q.steps && q.steps.length) {
      const divSteps = document.createElement('div'); divSteps.className = 'ai-steps';
      const sSteps = document.createElement('strong'); sSteps.textContent = 'Steps:';
      const ol = document.createElement('ol');
      q.steps.forEach(s => {
        const li = document.createElement('li');
        li.textContent = preprocessLatex(s);
        ol.appendChild(li);
      });
      divSteps.append(sSteps, ol);
      aDiv.appendChild(divSteps);
    }

    if (q.key_points && q.key_points.length) {
      const divKp = document.createElement('div'); divKp.className = 'ai-keypoints';
      const sKp = document.createElement('strong'); sKp.textContent = 'Key Points: ';
      divKp.append(sKp, document.createTextNode(preprocessLatex(q.key_points.join(' · '))));
      aDiv.appendChild(divKp);
    }

    ansBody.appendChild(aDiv);
  });
}

// ── Toggle Views ──────────────────────────────────────────────────────
function showView(view) {
  document.getElementById('paper-preview').style.display = view === 'questions' ? 'block' : 'none';
  document.getElementById('answer-preview').style.display = view === 'answers' ? 'block' : 'none';
  document.getElementById('toggle-q').classList.toggle('active', view === 'questions');
  document.getElementById('toggle-a').classList.toggle('active', view === 'answers');
}

// ── Direct PDF Download (Native Print) ────────────────────────────────
async function downloadPDF(type) {
  const status = document.getElementById('download-status');
  const statusText = document.getElementById('ds-text');
  const btn = type === 'questions'
    ? document.getElementById('dl-questions-btn')
    : document.getElementById('dl-answers-btn');

  status.classList.remove('hidden');
  statusText.textContent = 'Preparing perfectly formatted PDF...';
  btn.disabled = true;

  const qPreview = document.getElementById('paper-preview');
  const aPreview = document.getElementById('answer-preview');

  // Show correct view and set document title for the PDF filename
  if (type === 'questions') {
    qPreview.style.display = 'block';
    aPreview.style.display = 'none';
    document.title = `${settings.subject}_${settings.examType}_Questions`;
  } else {
    aPreview.style.display = 'block';
    qPreview.style.display = 'none';
    document.title = `${settings.subject}_${settings.examType}_AnswerKey`;
  }

  await triggerMathJax();

  // Allow layout to settle, then trigger native print
  setTimeout(() => {
    window.print();
    
    // Restore UI state after print dialog closes
    status.classList.add('hidden');
    btn.disabled = false;
    document.title = 'PDF Paper | Infinity Practice';
    showView(document.getElementById('toggle-q').classList.contains('active') ? 'questions' : 'answers');
  }, 500);
}

// ── Init ──────────────────────────────────────────────────────────────
async function initPaper() {
  buildQuestionPaper();
  buildAnswerKey();
  await triggerMathJax();
  const overlay = document.getElementById('paper-build-overlay');
  if (overlay) overlay.style.display = 'none';
}

initPaper();
