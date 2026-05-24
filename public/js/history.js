/* history.js — History page logic */

let allHistory = [];

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

function getOptionText(q, letter) {
  if (!q || !q.options || !letter) return '';
  const letters = ['A','B','C','D'];
  const idx = letters.indexOf(String(letter).toUpperCase().trim());
  return idx >= 0 ? (q.options[idx] || '').replace(/^[A-D][\)\.]\s*/i, '') : '';
}

// ── Overall Stats ─────────────────────────────────────────────────────
function buildOverview() {
  if (!allHistory.length) return;

  let totalQ = 0, totalCorrect = 0, totalWrong = 0, totalSkipped = 0, bestStreak = 0;
  allHistory.forEach(s => {
    totalCorrect += s.correct || 0;
    totalWrong += s.wrong || 0;
    totalSkipped += s.skipped || 0;
    totalQ += (s.correct || 0) + (s.wrong || 0) + (s.skipped || 0);
    bestStreak = Math.max(bestStreak, s.bestStreak || 0);
  });

  const overallPct = totalQ > 0 ? Math.round((totalCorrect / totalQ) * 100) : 0;

  document.getElementById('overview-grid').innerHTML = `
    <div class="ov-card"><span class="ov-num">${allHistory.length}</span><span class="ov-label">Sessions</span></div>
    <div class="ov-card"><span class="ov-num">${totalQ}</span><span class="ov-label">Questions</span></div>
    <div class="ov-card correct-card"><span class="ov-num">${totalCorrect}</span><span class="ov-label">Correct</span></div>
    <div class="ov-card wrong-card"><span class="ov-num">${totalWrong}</span><span class="ov-label">Wrong</span></div>
    <div class="ov-card"><span class="ov-num">${overallPct}%</span><span class="ov-label">Accuracy</span></div>
    <div class="ov-card streak-card"><span class="ov-num">🔥 ${bestStreak}</span><span class="ov-label">Best Streak</span></div>
  `;
}

// ── Topic Strength Map ────────────────────────────────────────────────
function buildTopicMap() {
  if (!allHistory.length) return;

  const topicMap = {};
  allHistory.forEach(session => {
    (session.history || []).forEach(h => {
      if (!h.question) return;
      const key = `${session.settings?.subject || 'General'}|${h.question.topic || 'General'}`;
      if (!topicMap[key]) topicMap[key] = { subject: session.settings?.subject, topic: h.question.topic || 'General', correct: 0, total: 0 };
      topicMap[key].total++;
      if (h.result === 'correct') topicMap[key].correct++;
    });
  });

  const container = document.getElementById('topic-map');
  if (container) container.innerHTML = '';
  const entries = Object.values(topicMap).sort((a, b) => (a.correct / a.total) - (b.correct / b.total));

  if (!entries.length) {
    container.innerHTML = '<p style="color:var(--text-faint);">No topic data yet.</p>';
    return;
  }

  entries.forEach(t => {
    const pct = Math.round((t.correct / t.total) * 100);
    const cls = pct >= 70 ? 'strong' : pct >= 40 ? 'medium' : 'weak';

    const el = document.createElement('div');
    el.className = `topic-tile ${cls}`;

    const subjSpan = document.createElement('span');
    subjSpan.className = 'tt-subject';
    subjSpan.textContent = t.subject;

    const topicSpan = document.createElement('span');
    topicSpan.className = 'tt-topic';
    topicSpan.textContent = t.topic;

    const barDiv = document.createElement('div');
    barDiv.className = 'tt-bar';
    const fillDiv = document.createElement('div');
    fillDiv.className = 'tt-fill';
    fillDiv.style.width = pct + '%';
    barDiv.appendChild(fillDiv);

    const pctSpan = document.createElement('span');
    pctSpan.className = 'tt-pct';
    pctSpan.textContent = `${pct}% (${t.correct}/${t.total})`;

    el.append(subjSpan, topicSpan, barDiv, pctSpan);
    container.appendChild(el);
  });
}

// ── Session & Question List ──────────────────────────────────────────────
let currentFilter = 'all';
let currentQuery = '';
let currentView = 'sessions';

function switchView(view) {
  currentView = view;
  const btnS = document.getElementById('view-btn-sessions');
  const btnQ = document.getElementById('view-btn-questions');
  if (view === 'sessions') {
    if(btnS) { btnS.style.background = 'var(--primary)'; btnS.style.color = '#fff'; }
    if(btnQ) { btnQ.style.background = 'transparent'; btnQ.style.color = 'var(--text)'; }
  } else {
    if(btnQ) { btnQ.style.background = 'var(--primary)'; btnQ.style.color = '#fff'; }
    if(btnS) { btnS.style.background = 'transparent'; btnS.style.color = 'var(--text)'; }
  }
  buildSessionList(currentFilter, currentQuery);
}

function buildSessionList(filter, query = '') {
  const container = document.getElementById('session-list');
  container.innerHTML = '';

  let filtered = filter === 'all'
    ? allHistory
    : allHistory.filter(s => s.settings?.subject === filter);

  if (query) {
    filtered = filtered.filter(s => {
      const topicMatch = (s.settings?.topic || '').toLowerCase().includes(query);
      const subjectMatch = (s.settings?.subject || '').toLowerCase().includes(query);
      const qMatch = (s.history || []).some(h => {
        const text = (h.question?.question || h.question?.assertion || '').toLowerCase();
        return text.includes(query);
      });
      return topicMatch || subjectMatch || qMatch;
    });
  }

  if (!filtered.length) {
    container.innerHTML = '<p style="color:var(--text-faint);text-align:center;padding:2rem;">No items found matching your criteria.</p>';
    return;
  }

  if (currentView === 'questions') {
    let allQs = [];
    filtered.forEach(s => {
      (s.history || []).forEach(h => {
        const text = (h.question?.question || h.question?.assertion || '').toLowerCase();
        const topicMatch = (s.settings?.topic || '').toLowerCase().includes(query);
        const subjectMatch = (s.settings?.subject || '').toLowerCase().includes(query);
        const qMatch = text.includes(query);
        if (!query || topicMatch || subjectMatch || qMatch) {
          allQs.push({ session: s, historyItem: h });
        }
      });
    });

    if (!allQs.length) {
      container.innerHTML = '<p style="color:var(--text-faint);text-align:center;padding:2rem;">No questions found matching your criteria.</p>';
      return;
    }

    allQs.reverse().forEach(item => {
      const { session: s, historyItem: h } = item;
      const date = new Date(s.date);
      const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
      
      const el = document.createElement('div');
      el.className = 'session-card';
      el.style.padding = '1.25rem 1.5rem';

      // ── Header (Question Meta) ──
      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem; flex-wrap:wrap; gap:0.5rem;';
      
      const meta = document.createElement('div');
      meta.style.cssText = 'display:flex; gap:0.75rem; align-items:center; font-size:0.8rem; flex-wrap:wrap;';
      const subjSpan = document.createElement('span'); subjSpan.className = 'sc-subject'; subjSpan.style.fontSize = '0.95rem'; subjSpan.textContent = s.settings?.subject || 'Unknown';
      const topicSpan = document.createElement('span'); topicSpan.style.color = 'var(--primary)'; topicSpan.style.fontWeight = '600'; topicSpan.textContent = h.question?.topic || s.settings?.topic || '';
      const dateSpan = document.createElement('span'); dateSpan.className = 'sc-date'; dateSpan.textContent = `${dateStr} ${timeStr}`;
      meta.append(subjSpan, topicSpan, dateSpan);
      
      const resSpan = document.createElement('span');
      resSpan.style.cssText = 'font-weight:700; padding:0.25rem 0.75rem; border-radius:6px; font-size:0.8rem;';
      if (h.result === 'correct') { resSpan.textContent = '✅ Correct'; resSpan.style.background = '#dcfce7'; resSpan.style.color = 'var(--emerald)'; }
      else if (h.result === 'wrong') { resSpan.textContent = '❌ Wrong'; resSpan.style.background = '#fee2e2'; resSpan.style.color = 'var(--red)'; }
      else { resSpan.textContent = '⏭ Skipped'; resSpan.style.background = '#f1f5f9'; resSpan.style.color = 'var(--text-muted)'; }
      
      headerRow.append(meta, resSpan);
      el.appendChild(headerRow);

      // ── Question Text ──
      const qTextContainer = document.createElement('div');
      qTextContainer.style.cssText = 'color:var(--text); font-size:0.95rem; line-height:1.6;';
      
      let qText = h.question?.question;
      if (!qText) {
        if (h.question?.assertion) {
          qText = `<strong>Assertion (A):</strong> ${h.question.assertion} <br><strong>Reason (R):</strong> ${h.question.reason || ''}`;
        } else {
          qText = 'Unknown Question';
        }
      }
      qText = preprocessLatex(qText).replace(/\\n/g, '<br>').replace(/\n/g, '<br>');

      if (h.question?.type === 'match') {
          qText += '<div style="display:flex; gap:1rem; margin-top:0.5rem; font-size:0.85rem; padding:0.5rem; background:var(--surface-2); border-radius:8px;">';
          qText += '<div style="flex:1;"><strong>List I</strong><ul style="padding-left:1rem;margin:0.25rem 0 0 0;">' + (h.question.list1||[]).map(x=>`<li>${preprocessLatex(x)}</li>`).join('') + '</ul></div>';
          qText += '<div style="flex:1;"><strong>List II</strong><ul style="padding-left:1rem;margin:0.25rem 0 0 0;">' + (h.question.list2||[]).map(x=>`<li>${preprocessLatex(x)}</li>`).join('') + '</ul></div>';
          qText += '</div>';
      }
      qTextContainer.innerHTML = qText;
      el.appendChild(qTextContainer);

      // ── Answer Details ──
      if (h.result === 'wrong' || h.result === 'correct') {
         const ansRow = document.createElement('div');
         ansRow.style.cssText = 'margin-top: 1rem; padding-top:1rem; border-top:1px dashed var(--border); font-size:0.85rem; color:var(--text-muted); display:flex; gap:2rem; flex-wrap:wrap;';
         
         let correctAnsText = h.question?.correct || h.question?.answer || '';
         if (['mcq', 'assertion', 'match', 'tf'].includes(h.question?.type) && h.question?.options) {
           correctAnsText = `${correctAnsText}) ${getOptionText(h.question, correctAnsText)}`;
         }
         let userAnsText = h.userAnswer || '';
         if (['mcq', 'assertion', 'match', 'tf'].includes(h.question?.type) && h.question?.options && h.userAnswer) {
           userAnsText = `${userAnsText}) ${getOptionText(h.question, userAnsText)}`;
         }
         
         ansRow.innerHTML = `<div><strong style="color:var(--text);">Your Answer:</strong> ${preprocessLatex(userAnsText)}</div><div><strong style="color:var(--emerald);">Correct Answer:</strong> ${preprocessLatex(correctAnsText)}</div>`;
         el.appendChild(ansRow);
      } else if (h.result === 'skipped') {
         const ansRow = document.createElement('div');
         ansRow.style.cssText = 'margin-top: 1rem; padding-top:1rem; border-top:1px dashed var(--border); font-size:0.85rem; color:var(--text-faint); display:flex; gap:2rem; flex-wrap:wrap;';
         
         let correctAnsText = h.question?.correct || h.question?.answer || '';
         if (['mcq', 'assertion', 'match', 'tf'].includes(h.question?.type) && h.question?.options) {
           correctAnsText = `${correctAnsText}) ${getOptionText(h.question, correctAnsText)}`;
         }
         
         ansRow.innerHTML = `<div><span style="color:var(--text-faint);">⏭ Skipped</span></div><div><strong style="color:var(--emerald);">Correct Answer:</strong> ${preprocessLatex(correctAnsText)}</div>`;
         el.appendChild(ansRow);
      }

      // ── Solution steps or Explanation ──
      if (h.question?.explanation) {
         const expDiv = document.createElement('div');
         expDiv.style.cssText = 'margin-top: 0.75rem; padding: 0.75rem; background: var(--surface-3); border-radius: 8px; font-size: 0.85rem; border-left: 3px solid var(--primary);';
         expDiv.innerHTML = `💡 <strong>Explanation:</strong> ${preprocessLatex(h.question.explanation).replace(/\\n/g, '<br>').replace(/\n/g, '<br>')}`;
         el.appendChild(expDiv);
      } else if (h.question?.steps && h.question.steps.length) {
         const stepsWrap = document.createElement('div');
         stepsWrap.style.cssText = 'margin-top: 0.75rem; padding: 0.75rem; background: var(--surface-3); border-radius: 8px; font-size: 0.85rem; border-left: 3px solid var(--primary);';
         stepsWrap.innerHTML = `💡 <strong>Solution Steps:</strong><ol style="padding-left:1.2rem;margin-top:0.3rem">` + h.question.steps.map(s => `<li style="margin-bottom:0.2rem">${preprocessLatex(s)}</li>`).join('') + `</ol>`;
         el.appendChild(stepsWrap);
      }

      container.appendChild(el);
    });

    if (window.renderMathInElement) {
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
    return;
  }

  // Show newest first (Sessions View)
  [...filtered].reverse().forEach((s, idx) => {
    const date = new Date(s.date);
    const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const totalQ = (s.correct || 0) + (s.wrong || 0) + (s.skipped || 0);

    const el = document.createElement('div');
    el.className = 'session-card';

    // ── Header ──
    const header = document.createElement('div');
    header.className = 'sc-header';
    const meta = document.createElement('div');
    meta.className = 'sc-meta';
    
    const subjSpan = document.createElement('span'); subjSpan.className = 'sc-subject'; subjSpan.textContent = s.settings?.subject || 'Unknown';
    const examSpan = document.createElement('span'); examSpan.className = 'sc-exam'; examSpan.textContent = s.settings?.examType || '';
    const dateSpan = document.createElement('span'); dateSpan.className = 'sc-date'; dateSpan.textContent = `${dateStr} ${timeStr}`;
    meta.append(subjSpan, examSpan, dateSpan);
    
    const scoreSpan = document.createElement('div');
    scoreSpan.className = `sc-score ${s.pct >= 70 ? 'good' : s.pct >= 40 ? 'ok' : 'low'}`;
    scoreSpan.textContent = `${s.pct || 0}%`;
    header.append(meta, scoreSpan);
    el.appendChild(header);

    // ── Stats ──
    const statsDiv = document.createElement('div');
    statsDiv.className = 'sc-stats';
    statsDiv.style.marginBottom = '0.75rem';
    
    const cSpan = document.createElement('span'); cSpan.className = 'sc-stat correct'; cSpan.textContent = `✅ ${s.correct || 0}`;
    const wSpan = document.createElement('span'); wSpan.className = 'sc-stat wrong'; wSpan.textContent = `❌ ${s.wrong || 0}`;
    const skSpan = document.createElement('span'); skSpan.className = 'sc-stat skip'; skSpan.textContent = `⏭ ${s.skipped || 0}`;
    const stSpan = document.createElement('span'); stSpan.className = 'sc-stat'; stSpan.textContent = `🔥 ${s.bestStreak || 0}`;
    const totSpan = document.createElement('span'); totSpan.className = 'sc-stat'; totSpan.textContent = `${totalQ} Q`;
    statsDiv.append(cSpan, wSpan, skSpan, stSpan, totSpan);
    el.appendChild(statsDiv);

    // ── Actions & Topic ──
    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;';
    
    if (s.settings?.topic) {
      const tDiv = document.createElement('div');
      tDiv.className = 'sc-topic';
      tDiv.style.margin = '0';
      tDiv.textContent = `📌 ${s.settings.topic}`;
      actionRow.appendChild(tDiv);
    } else {
      actionRow.appendChild(document.createElement('div'));
    }

    const btnGroup = document.createElement('div');
    btnGroup.style.display = 'flex';
    btnGroup.style.gap = '0.5rem';

    // ✨ NEW FEATURE: Generate Similar (previously Retake)
    const similarBtn = document.createElement('button');
    similarBtn.className = 'action-btn';
    similarBtn.style.cssText = 'padding:0.3rem 0.8rem; font-size:0.8rem; border-radius:6px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); cursor:pointer; font-weight:600; transition:all 0.2s;';
    similarBtn.textContent = '🔄 Similar';
    similarBtn.title = 'Generate a new session with the same settings';
    similarBtn.onclick = () => {
      if (typeof window.applyRetakeConfig === 'function') {
        window.applyRetakeConfig(s.settings);
        const navBtn = document.getElementById('nav-practice');
        if (navBtn && typeof window.switchTab === 'function') {
          window.switchTab('practice', navBtn);
          return;
        }
      }
      // Save config and bridge back to index.html
      localStorage.setItem('infinityRetakeConfig', JSON.stringify(s.settings));
      window.location.href = 'index.html';
    };
    btnGroup.appendChild(similarBtn);

    // ✨ NEW FEATURE: Retake EXACT Session
    const retakeBtn = document.createElement('button');
    retakeBtn.className = 'action-btn';
    retakeBtn.style.cssText = 'padding:0.3rem 0.8rem; font-size:0.8rem; border-radius:6px; background:var(--primary-glow); border:1px solid var(--primary); color:var(--primary); cursor:pointer; font-weight:600; transition:all 0.2s;';
    retakeBtn.textContent = '🎯 Retake Exact';
    retakeBtn.title = 'Retake the exact same questions from this session';
    retakeBtn.onclick = () => {
      const exactQuestions = s.history.map(h => h.question);
      const newSettings = { ...s.settings, exactQuestions: exactQuestions };
      sessionStorage.setItem('practiceSettings', JSON.stringify(newSettings));
      window.location.href = 'practice.html';
    };
    btnGroup.appendChild(retakeBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'action-btn';
    toggleBtn.style.cssText = 'padding:0.3rem 0.8rem; font-size:0.8rem; border-radius:6px; background:var(--surface-2); border:1px solid var(--border); color:var(--text); cursor:pointer;';
    toggleBtn.textContent = 'Show Questions ⬇';
    btnGroup.appendChild(toggleBtn);
    
    actionRow.appendChild(btnGroup);
    el.appendChild(actionRow);

    // ── Question List (Safe DOM) ──
    const qList = document.createElement('div');
    qList.className = 'sc-qs hidden';
    qList.style.cssText = 'margin-top:1rem; border-top:1px dashed var(--border); padding-top:1rem; display:flex; flex-direction:column; gap:0.5rem;';
    
    toggleBtn.onclick = () => {
      qList.classList.toggle('hidden');
      toggleBtn.textContent = qList.classList.contains('hidden') ? 'Show Questions ⬇' : 'Hide Questions ⬆';
      if (!qList.classList.contains('hidden') && window.renderMathInElement) {
        window.renderMathInElement(qList, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', right: '$', display: false },
            { left: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true }
          ],
          throwOnError: false
        });
      }
    };

    if (s.history && s.history.length) {
      s.history.forEach(h => {
        const qRow = document.createElement('div');
        qRow.style.cssText = 'display:flex; gap:0.5rem; font-size:0.85rem; align-items:flex-start;';
        
        const iSpan = document.createElement('span');
        iSpan.style.flexShrink = '0';
        iSpan.textContent = h.result === 'correct' ? '✅' : h.result === 'wrong' ? '❌' : '⏭';
        
        const nSpan = document.createElement('span');
        nSpan.style.cssText = 'font-weight:600; width:30px; flex-shrink:0; color:var(--text);';
        nSpan.textContent = `Q${h.qNumber}.`;
        
        const tSpan = document.createElement('span');
        tSpan.style.cssText = 'color:var(--text-muted); flex:1; line-height:1.4;';
        
        let qText = String(h.question?.question || h.question?.assertion || 'Unknown question').replace(/\\n/g, '<br>');
        qText = preprocessLatex(qText);
        
        tSpan.innerHTML = qText;
        qRow.append(iSpan, nSpan, tSpan);
        qList.appendChild(qRow);
      });
    } else {
      const p = document.createElement('p');
      p.style.cssText = 'color:var(--text-faint); font-size:0.85rem;';
      p.textContent = 'No question details recorded.';
      qList.appendChild(p);
    }
    
    el.appendChild(qList);
    container.appendChild(el);
  });
}

function filterSessions(btn) {
  document.querySelectorAll('.sf-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentFilter = btn.dataset.filter;
  buildSessionList(currentFilter, currentQuery);
}

function searchHistory() {
  const el = document.getElementById('hist-search');
  if (!el) return;
  currentQuery = el.value.trim().toLowerCase();
  buildSessionList(currentFilter, currentQuery);
}

function clearHistory() {
  if (!confirm('Are you sure you want to clear all history? This cannot be undone.')) return;
  localStorage.removeItem('infinityHistory');
  if (typeof initHistoryTab === 'function') {
    initHistoryTab();
  } else {
    window.location.reload();
  }
  const histBadge = document.getElementById('history-count');
  if (histBadge) histBadge.textContent = '';
}

// ── Init ──────────────────────────────────────────────────────────────
window.initHistoryTab = function() {
  allHistory = JSON.parse(localStorage.getItem('infinityHistory') || '[]');

  const overviewSec = document.getElementById('overview-section');
  const topicsSec = document.getElementById('topics-section');
  const emptyState = document.getElementById('empty-state');

  if (!allHistory.length) {
    if (overviewSec) overviewSec.classList.add('hidden');
    if (topicsSec) topicsSec.classList.add('hidden');
    if (emptyState) emptyState.classList.remove('hidden');
  } else {
    if (overviewSec) overviewSec.classList.remove('hidden');
    if (topicsSec) topicsSec.classList.remove('hidden');
    if (emptyState) emptyState.classList.add('hidden');
    buildOverview();
    buildTopicMap();
    buildSessionList(currentFilter || 'all', currentQuery || '');
  }
};

// Check if running on index.html, if so don't auto-run (index.html's switchTab will call it)
if (window.location.pathname.endsWith('history.html') || window.location.pathname === '/' || !document.getElementById('tab-history')) {
  window.initHistoryTab();
}
