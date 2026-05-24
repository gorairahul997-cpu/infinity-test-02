/* results.js — Results Page Logic */

// ── Load Results ──────────────────────────────────────────────────────
const raw = sessionStorage.getItem('practiceResults');
if (!raw) { window.location.href = 'index.html'; }
const R = JSON.parse(raw);

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ── Preprocess LaTeX: wrap bare \commands in $...$ so KaTeX finds them ─
function preprocessLatex(text) {
  if (!text) return '';
  let s = String(text);

  // Step 1: Fix malformed patterns like \frac{$F$}{$m$} → \frac{F}{m}
  s = s.replace(/(\\[a-zA-Z]+\{[^}]*\}(?:\{[^}]*\})?)/g, function(match) {
    return match.replace(/\$/g, '');
  });

  // Step 1.5: Break concatenated operator+word like \cdotdet → \cdot det
  s = s.replace(/\\(cdot|times|div|pm|mp|to|in|cap|cup|circ|le|ge|ne|ll|gg|sim|approx|equiv|propto|perp|parallel|quad|qquad)(?=[a-zA-Z\\])/g, '\\$1 ');

  // Step 2: Split by existing $...$ and $$...$$ delimiters
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

// ── Render Meta ────────────────────────────────────────────────────────
const metaDiv = document.getElementById('results-meta');
if (metaDiv) {
  metaDiv.innerHTML = '';
  const subSpan = document.createElement('span');
  subSpan.textContent = R.settings.subject;
  const dotSpan1 = document.createElement('span');
  dotSpan1.textContent = ' · ';
  const examSpan = document.createElement('span');
  examSpan.textContent = R.settings.examType;
  const dotSpan2 = document.createElement('span');
  dotSpan2.textContent = ' · ';
  const dateSpan = document.createElement('span');
  dateSpan.textContent = new Date(R.date).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  
  metaDiv.appendChild(subSpan);
  metaDiv.appendChild(dotSpan1);
  metaDiv.appendChild(examSpan);
  metaDiv.appendChild(dotSpan2);
  metaDiv.appendChild(dateSpan);
}

function triggerKaTeX() {
  const container = document.getElementById('review-list');
  if (window.renderMathInElement && container) {
    window.renderMathInElement(container, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      throwOnError: false
    });
  }
}

// ── Score Ring & Grade ─────────────────────────────────────────────────
function getGrade(pct) {
  if (pct >= 80) return { cls: 'grade-a', label: '🏆 Excellent!', msg: 'Outstanding performance! You\'re exam-ready.' };
  if (pct >= 60) return { cls: 'grade-b', label: '👍 Good Job!',  msg: 'Great work! A bit more practice and you\'ll ace it.' };
  if (pct >= 40) return { cls: 'grade-c', label: '📚 Keep Going', msg: 'You\'re on the right track. Review the wrong answers.' };
  return                 { cls: 'grade-d', label: '💪 Keep Trying', msg: 'Don\'t give up! Every expert was once a beginner.' };
}

const grade = getGrade(R.pct);
const circumference = 427; // 2π×68

// Animate score ring
document.getElementById('sr-pct').textContent   = R.pct + '%';
document.getElementById('sr-pct').className     = 'sr-pct ' + grade.cls;
document.getElementById('score-grade').textContent = grade.label;
document.getElementById('score-grade').className   = 'score-grade ' + grade.cls;
document.getElementById('score-msg').textContent   = grade.msg;

document.getElementById('r-correct').textContent = R.correct;
document.getElementById('r-wrong').textContent   = R.wrong;
document.getElementById('r-skipped').textContent = R.skipped;
document.getElementById('r-streak').textContent  = R.bestStreak;

setTimeout(() => {
  const fill = document.getElementById('sr-fill');
  if (fill) {
    fill.className = 'sr-fill ' + grade.cls;
    fill.style.strokeDashoffset = circumference - (R.pct / 100) * circumference;
  }
}, 200);

// ── Topic Performance Bars ─────────────────────────────────────────────
function buildTopicBars() {
  const topicMap = {};
  R.history.forEach(h => {
    if (!h.question) return;
    const t = h.question.topic || 'General';
    if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 };
    topicMap[t].total++;
    if (h.result === 'correct') topicMap[t].correct++;
  });

  const container = document.getElementById('topic-bars');
  if (!container) return;
  container.innerHTML = '';
  
  const entries   = Object.entries(topicMap).sort((a, b) => {
    const pctA = a[1].correct / a[1].total;
    const pctB = b[1].correct / b[1].total;
    if (pctA !== pctB) return pctA - pctB; // Lowest accuracy first
    return b[1].total - a[1].total; // Then most questions
  });

  if (entries.length === 0) {
    container.innerHTML = '<p style="color:var(--text-faint);font-size:0.88rem;">No topic data available.</p>';
    return;
  }

  entries.forEach(([topic, data]) => {
    const pct = Math.round((data.correct / data.total) * 100);
    const cls  = pct >= 70 ? 'high' : pct >= 40 ? 'med' : 'low';

    const item = document.createElement('div');
    item.className = 'topic-bar-item';

    const header = document.createElement('div');
    header.className = 'topic-bar-header';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'topic-bar-name';
    nameSpan.textContent = topic;

    const statSpan = document.createElement('span');
    statSpan.className = 'topic-bar-stat';
    statSpan.textContent = `${data.correct}/${data.total} · ${pct}%`;

    header.appendChild(nameSpan);
    header.appendChild(statSpan);

    const track = document.createElement('div');
    track.className = 'topic-bar-track';

    const fill = document.createElement('div');
    fill.className = `topic-bar-fill ${cls}`;
    fill.dataset.pct = pct;

    track.appendChild(fill);
    item.appendChild(header);
    item.appendChild(track);

    container.appendChild(item);
  });

  // Animate bars
  setTimeout(() => {
    document.querySelectorAll('.topic-bar-fill').forEach(el => {
      el.style.width = el.dataset.pct + '%';
    });
  }, 300);
}

buildTopicBars();

// ── Question Review ────────────────────────────────────────────────────
let currentFilter = 'all';

function buildReviewList(filter = 'all') {
  const container = document.getElementById('review-list');
  if (!container) return;
  container.innerHTML = '';

  const filtered = R.history.filter(h => filter === 'all' || h.result === filter);

  if (filtered.length === 0) {
    container.innerHTML = `<p style="color:var(--text-faint);font-size:0.88rem;text-align:center;padding:1rem;">No questions in this category.</p>`;
    return;
  }

  filtered.forEach((h, idx) => {
    if (!h.question) return;
    const q    = h.question;
    const icon = h.result === 'correct' ? '✅' : h.result === 'wrong' ? '❌' : '⏭';
    
    let qText = q.question;
    if (!qText) {
      if (q.assertion) {
        qText = `Assertion (A): ${q.assertion} \nReason (R): ${q.reason}`;
      } else {
        qText = 'Question';
      }
    }

    const item = document.createElement('div');
    item.className = `review-item ${h.result}`;

    // Header
    const header = document.createElement('div');
    header.className = 'ri-header';
    header.onclick = () => toggleReview(header);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'ri-icon';
    iconSpan.textContent = icon;

    const textSpan = document.createElement('span');
    textSpan.className = 'ri-q-text';
    textSpan.innerHTML = `Q${h.qNumber}. ${preprocessLatex(qText).replace(/\n/g, '<br>')}`;

    const topicSpan = document.createElement('span');
    topicSpan.className = 'ri-topic';
    topicSpan.textContent = q.topic || '';

    const expandSpan = document.createElement('span');
    expandSpan.className = 'ri-expand';
    expandSpan.textContent = '▼';

    header.appendChild(iconSpan);
    header.appendChild(textSpan);
    header.appendChild(topicSpan);
    header.appendChild(expandSpan);

    // Body
    const body = document.createElement('div');
    body.className = 'ri-body';

    appendAnswerElements(body, h, q);

    if (q.explanation) {
      const explanationDiv = document.createElement('div');
      explanationDiv.className = 'ri-explanation';
      explanationDiv.textContent = `💡 ${preprocessLatex(q.explanation)}`;
      body.appendChild(explanationDiv);
    }

    item.appendChild(header);
    item.appendChild(body);
    container.appendChild(item);
  });

  triggerKaTeX();
}

function appendAnswerElements(body, h, q) {
  if (q.type === 'match') {
    const listsBox = document.createElement('div');
    listsBox.style.cssText = 'display:flex; gap:1rem; margin:0.5rem 0 1rem 0; font-size:0.85rem; background:var(--surface-2); padding:0.75rem; border-radius:8px; border:1px solid var(--border);';
    const l1 = document.createElement('div'); l1.style.flex = '1';
    const l2 = document.createElement('div'); l2.style.flex = '1';
    l1.innerHTML = '<strong>List I</strong><ul style="padding-left:0;margin-top:0.3rem;list-style-type:none;gap:0.25rem;display:flex;flex-direction:column;">' + (q.list1||[]).map(x=>`<li>${preprocessLatex(x)}</li>`).join('') + '</ul>';
    l2.innerHTML = '<strong>List II</strong><ul style="padding-left:0;margin-top:0.3rem;list-style-type:none;gap:0.25rem;display:flex;flex-direction:column;">' + (q.list2||[]).map(x=>`<li>${preprocessLatex(x)}</li>`).join('') + '</ul>';
    listsBox.appendChild(l1);
    listsBox.appendChild(l2);
    body.appendChild(listsBox);
  }

  if (q.type === 'mcq' || q.type === 'assertion' || q.type === 'match' || q.type === 'tf') {
    const correctDiv = document.createElement('div');
    correctDiv.className = 'ri-answer';
    correctDiv.innerHTML = '✅ <strong>Correct:</strong> ';
    const correctText = document.createElement('span');
    correctText.textContent = `${q.correct || ''}) ${preprocessLatex(getOptionText(q, q.correct))}`;
    correctDiv.appendChild(correctText);
    body.appendChild(correctDiv);

    if (h.result === 'wrong') {
      const wrongDiv = document.createElement('div');
      wrongDiv.className = 'ri-your-ans wrong-ans';
      wrongDiv.innerHTML = 'Your answer: ';
      const wrongText = document.createElement('strong');
      wrongText.textContent = `${h.userAnswer || ''}) ${preprocessLatex(getOptionText(q, h.userAnswer))}`;
      wrongDiv.appendChild(wrongText);
      body.appendChild(wrongDiv);
    }
  } else if (q.type === 'numerical') {
    const answerDiv = document.createElement('div');
    answerDiv.className = 'ri-answer';
    answerDiv.innerHTML = '✅ <strong>Answer:</strong> ';
    const ansText = document.createElement('span');
    ansText.textContent = preprocessLatex(String(q.correct || ''));
    answerDiv.appendChild(ansText);
    body.appendChild(answerDiv);

    if (h.result === 'wrong') {
      const wrongDiv = document.createElement('div');
      wrongDiv.className = 'ri-your-ans wrong-ans';
      wrongDiv.innerHTML = 'Your answer: ';
      const wrongText = document.createElement('strong');
      wrongText.textContent = preprocessLatex(String(h.userAnswer || ''));
      wrongDiv.appendChild(wrongText);
      body.appendChild(wrongDiv);
    }

    if (q.steps && q.steps.length) {
      const stepsWrap = document.createElement('div');
      stepsWrap.style.marginTop = '0.5rem';
      
      const smallLabel = document.createElement('small');
      smallLabel.style.cssText = 'color:var(--text-faint);text-transform:uppercase;font-size:0.7rem;letter-spacing:.05em';
      smallLabel.textContent = 'Solution steps';
      stepsWrap.appendChild(smallLabel);

      const ol = document.createElement('ol');
      ol.style.cssText = 'padding-left:1.2rem;margin-top:0.3rem';
      q.steps.forEach(s => {
        const li = document.createElement('li');
        li.style.cssText = 'font-size:0.83rem;color:var(--text-muted);margin-bottom:0.2rem';
        li.textContent = preprocessLatex(s);
        ol.appendChild(li);
      });
      stepsWrap.appendChild(ol);
      body.appendChild(stepsWrap);
    }
  } else if (q.type === 'short' || q.type === 'fib' || q.type === 'predict') {
    const answerDiv = document.createElement('div');
    answerDiv.className = 'ri-answer';
    answerDiv.innerHTML = '✅ <strong>Model Answer:</strong> ';
    const ansText = document.createElement('span');
    ansText.textContent = preprocessLatex(String(q.answer || q.correct || ''));
    answerDiv.appendChild(ansText);
    body.appendChild(answerDiv);

    if (h.result === 'wrong') {
      const wrongDiv = document.createElement('div');
      wrongDiv.className = 'ri-your-ans wrong-ans';
      wrongDiv.innerHTML = 'Your answer: ';
      const wrongText = document.createElement('strong');
      wrongText.textContent = preprocessLatex(String(h.userAnswer || ''));
      wrongDiv.appendChild(wrongText);
      body.appendChild(wrongDiv);
    }

    if (q.key_points && q.key_points.length) {
      const kpWrap = document.createElement('div');
      kpWrap.style.marginTop = '0.4rem';
      
      const smallLabel = document.createElement('small');
      smallLabel.style.color = 'var(--text-faint)';
      smallLabel.textContent = 'Key points: ';
      kpWrap.appendChild(smallLabel);

      q.key_points.forEach(p => {
        const span = document.createElement('span');
        span.style.cssText = 'font-size:0.8rem;color:var(--text-muted)';
        span.textContent = ` · ${preprocessLatex(p)}`;
        kpWrap.appendChild(span);
      });
      body.appendChild(kpWrap);
    }
  }

  if (h.result === 'skipped') {
    const skippedDiv = document.createElement('div');
    skippedDiv.className = 'ri-your-ans';
    skippedDiv.style.color = 'var(--text-faint)';
    skippedDiv.textContent = '⏭ Skipped / Time Up';
    body.appendChild(skippedDiv);
  }
}

function getOptionText(q, letter) {
  if (!q.options || !letter) return '';
  const letters = ['A','B','C','D'];
  const idx = letters.indexOf(String(letter).toUpperCase().trim());
  return idx >= 0 ? (q.options[idx] || '').replace(/^[A-D][\)\.]\s*/i, '') : '';
}

function toggleReview(header) {
  const item = header.closest('.review-item');
  if (item) item.classList.toggle('open');
}

function filterReview(btn) {
  document.querySelectorAll('.rf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  buildReviewList(currentFilter);
}

// ── Practice Again (Generate Similar) ──────────────────────────────────
function practiceAgain() {
  sessionStorage.setItem('practiceSettings', JSON.stringify(R.settings));
  window.location.href = 'practice.html'; // Generates new questions based on settings
}

// ── Retake Exact Paper ────────────────────────────────────────────────
function retakeExactPaper() {
  const exactQuestions = R.history.map(h => h.question).filter(q => q);
  const newSettings = { ...R.settings, exactQuestions: exactQuestions };
  sessionStorage.setItem('practiceSettings', JSON.stringify(newSettings));
  window.location.href = 'practice.html';
}

// ── Init ──────────────────────────────────────────────────────────────
buildReviewList('all');
