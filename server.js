require('dotenv').config();
const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const axios = require('axios');
const { getSyllabusContext, getSyllabusTopicsArray, getActiveChapterKeywords } = require('./syllabus');
const {
  fixLatexJson,
  deepFixLatex,
  wrapInDisplayMath,
  extractNumber
} = require('./core/latex-utils');
const FormulaEngine = require('./core/formula-engine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Database Initialization (SQLite) ─────────────────────────────────
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'practice.db');

// Ensure database directory exists (useful for persistent volume mounts like /data)
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    topic TEXT,
    questionType TEXT,
    difficulty TEXT,
    result TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS question_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT,
    topic TEXT,
    questionType TEXT,
    difficulty TEXT,
    questionJson TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_question_cache_lookup ON question_cache (subject, questionType, difficulty, topic)`);
  db.run(`CREATE TABLE IF NOT EXISTS formula_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT,
    formulasJson TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS formula_explain_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    formula TEXT,
    topic TEXT,
    explanationJson TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ── Background Cache Pruning (7-day TTL) ─────────────────────────────
setInterval(() => {
  const cutoff = "datetime('now', '-7 days')";
  db.run(`DELETE FROM question_cache WHERE timestamp <= ${cutoff}`, function(err) {
    if (err) console.error('[CACHE PRUNE ERROR]', err.message);
    else if (this.changes > 0) console.log(`[CACHE PRUNE] Deleted ${this.changes} stale questions.`);
  });
}, 60 * 60 * 1000); // Run every 1 hour

app.post('/api/track-progress', (req, res) => {
  const { subject, topic, questionType, difficulty, result } = req.body;
  if (!subject || !topic || !result) return res.json({ success: false, error: 'Missing fields' });
  db.run(`INSERT INTO history (subject, topic, questionType, difficulty, result) VALUES (?, ?, ?, ?, ?)`,
    [subject, topic, questionType, difficulty, result],
    function (err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, id: this.lastID });
    });
});

// ── Helper: get adaptive difficulty based on history ──────────────────
function getAdaptiveDifficulty(subject, topic) {
  return new Promise((resolve) => {
    let query = `SELECT result FROM history WHERE LOWER(subject) = LOWER(?)`;
    const queryParams = [subject];
    if (topic) {
      query += ` AND LOWER(topic) = LOWER(?)`;
      queryParams.push(topic);
    }
    query += ` ORDER BY timestamp DESC LIMIT 5`;

    db.all(query, queryParams, (err, rows) => {
      if (err) {
        console.error('[ADAPTIVE DB ERROR]', err.message);
        return resolve('Medium');
      }
      if (!rows || rows.length < 2) {
        console.log(`[ADAPTIVE] Too few attempts (${rows ? rows.length : 0}) for subject: ${subject}, topic: ${topic || 'General'}. Defaulting to Medium.`);
        return resolve('Medium');
      }
      const correctCount = rows.filter(r => r.result === 'correct').length;
      const masteryScore = correctCount / rows.length;
      
      let resolved = 'Medium';
      if (masteryScore < 0.4) {
        resolved = 'Easy';
      } else if (masteryScore < 0.8) {
        resolved = 'Medium';
      } else {
        resolved = 'Hard';
      }
      console.log(`[ADAPTIVE] Mastery score for ${subject} | ${topic || 'General'} is ${masteryScore.toFixed(2)} (${correctCount}/${rows.length}). Resolved to: ${resolved}`);
      resolve(resolved);
    });
  });
}

app.get('/api/weaknesses', (req, res) => {
  const subject = req.query.subject;
  db.all(`SELECT topic, COUNT(*) as total, SUM(CASE WHEN result='wrong' THEN 1 ELSE 0 END) as wrongs 
          FROM history WHERE subject = ? GROUP BY topic HAVING total >= 2 ORDER BY (CAST(wrongs AS FLOAT)/total) DESC LIMIT 3`,
    [subject],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, weaknesses: rows });
    });
});

// ── AI Clients ───────────────────────────────────────────────────────
const nimClient = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY,
  baseURL: 'https://integrate.api.nvidia.com/v1',
});
const NIM_FAST_MODEL = process.env.NVIDIA_FAST_MODEL || 'meta/llama-3.1-8b-instruct';
const NIM_HEAVY_MODEL = process.env.NVIDIA_HEAVY_MODEL || 'meta/llama-3.1-70b-instruct';
const NIM_CHAT_MODEL = process.env.NVIDIA_CHAT_MODEL || 'meta/llama-3.1-8b-instruct';

// Parameter tuning maps optimized for specific cognitive tasks
const GENERATION_TUNING = {
  numerical: { temperature: 0.1, top_p: 0.9, max_tokens: 2000 },
  predict:   { temperature: 0.05, top_p: 0.85, max_tokens: 1600 },
  fib:       { temperature: 0.3, top_p: 0.9, max_tokens: 1200 },
  tf:        { temperature: 0.4, top_p: 0.9, max_tokens: 1200 },
  mcq:       { temperature: 0.7, top_p: 0.95, max_tokens: 1600 },
  assertion: { temperature: 0.65, top_p: 0.95, max_tokens: 1600 },
  match:     { temperature: 0.5, top_p: 0.95, max_tokens: 1600 },
  short:     { temperature: 0.7, top_p: 0.95, max_tokens: 1400 }
};

// Global in-flight generation coalescing map and sleep helper
const inFlightGenerations = new Map();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Helper: call NIM (Fallback Generator) ───────────────────────────────
async function askNIM(messages, maxTokens = 1200, jsonMode = true, model = NIM_MODEL, timeoutMs = 12000, temperature = 0.7, top_p = 0.95) {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === 'PASTE_YOUR_KEY_HERE') {
    throw new Error('NVIDIA_API_KEY not set in .env file.');
  }

  const apiCall = nimClient.chat.completions.create({
    model,
    messages,
    temperature: temperature,
    top_p: top_p,
    max_tokens: maxTokens,
    response_format: jsonMode ? { type: "json_object" } : undefined
  }, { timeout: timeoutMs });

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`NIM API timeout after ${Math.round(timeoutMs/1000)}s`)), timeoutMs)
  );

  const completion = await Promise.race([apiCall, timeoutPromise]);
  return completion.choices[0]?.message?.content || '';
}

// Instantiate Formula Engine with core dependencies
const formulaEngine = new FormulaEngine({
  db,
  askNIM,
  fastModel: NIM_FAST_MODEL,
  heavyModel: NIM_HEAVY_MODEL
});

// ── Helper: verify a question using independent LLM solver call ─────
async function verifyQuestion(questionText, questionType) {
  const sysMsg = `You are an elite, independent mathematical verifier. Your job is to solve the given question from scratch.
Be extremely precise.
- For numerical questions: calculate the final numeric answer as a single floating-point number.
- For predict questions: simulate code execution and output the exact console output.
Return ONLY JSON:
{
  "solved_value": 12.5,
  "reasoning": "Step-by-step mathematical reasoning or code execution trace."
}`;

  const userMsg = `QUESTION TO SOLVE:
${questionText}`;

  const messages = [
    { role: 'system', content: sysMsg },
    { role: 'user', content: userMsg }
  ];

  // Always use the Heavy model for verification to ensure mathematical/logical accuracy
  const raw = await askNIM(messages, 500, true, NIM_HEAVY_MODEL, 15000);

  // Strip markdown code fences if the AI wrapped its JSON
  const stripped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let parsed;
  const fixed = fixLatexJson(stripped);
  try {
    parsed = JSON.parse(fixed);
  } catch (e) {
    // Try to extract the first JSON object from the response
    const match = fixed.match(/\{[\s\S]*?\}/);
    if (!match) throw new Error('Verifier returned invalid JSON: ' + raw.slice(0, 200));
    try {
      parsed = JSON.parse(match[0]);
    } catch (e2) {
      throw new Error('Verifier JSON parse failed: ' + e2.message);
    }
  }

  // Normalise alternate field names the AI might use
  if (parsed.solved_value === undefined || parsed.solved_value === null) {
    const alt = parsed.answer ?? parsed.value ?? parsed.result ?? parsed.computed_value ?? parsed.final_answer;
    if (alt !== undefined && alt !== null) {
      parsed.solved_value = alt;
    }
  }

  return parsed;
}

// ── Helper: safely extract + normalize JSON ──────────────────────────
function extractAndNormalize(text, questionType) {
  let q;
  const fixed = fixLatexJson(text);
  try {
    q = JSON.parse(fixed);
  } catch (e) {
    // Fallback if AI adds markdown fences despite JSON mode
    const match = fixed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Invalid JSON from AI: ' + text.slice(0, 200));
    try {
      q = JSON.parse(match[0]);
    } catch (e2) {
      throw new Error('Failed to parse AI JSON: ' + e2.message);
    }
  }

  // Fix matrix row separators in all string values
  q = deepFixLatex(q);

  if (questionType) q.type = questionType; // Force the requested type
  if (!q.type) q.type = 'mcq';
  q.type = String(q.type).toLowerCase();

  // ── 1. Format-Specific Validation & Normalization ───────────────────

  if (q.type === 'tf') {
    q.options = ["A) True", "B) False"];

    const tfQ = String(q.question || '').trim();
    const tfForbiddenStart = /^(what|why|how|calculate|find|explain|describe|determine|state|derive|show|prove|discuss|compare|differentiate|analyse|analyze|is\b|are\b|does\b|do\b|can\b|could\b|will\b|would\b|should\b|has\b|have\b)/i;
    const tfForbiddenBody = /\b(explain|describe|calculate|find|determine|solve|derive|show that|prove that|what is|why is|how does|how do|how is|how are|compute|evaluate|is it true|is it possible|can we|can you|true or false|state whether|is this true)\b/i;
    const endsWithQuestion = tfQ.endsWith('?');

    if (!tfQ || endsWithQuestion || tfForbiddenStart.test(tfQ) || tfForbiddenBody.test(tfQ)) {
      throw new Error(`TF question is not a valid declarative statement: "${tfQ.slice(0, 120)}"`);
    }
  }

  if (q.type === 'assertion') {
    if (!q.assertion || !q.reason) throw new Error('Assertion question missing assertion or reason field.');
    const assertTrim = String(q.assertion).trim();
    const reasonTrim = String(q.reason).trim();
    if (assertTrim.endsWith('?') || reasonTrim.endsWith('?')) {
      throw new Error('Assertion/Reason statements cannot be interrogative questions.');
    }
    if (!q.options || q.options.length === 0) {
      q.options = [
        "A) Both A and R are true, and R is the correct explanation of A",
        "B) Both A and R are true, but R is NOT the correct explanation of A",
        "C) A is true, but R is false",
        "D) A is false, but R is true"
      ];
    }
  }

  if (q.type === 'mcq') {
    if (!q.question) throw new Error('MCQ missing question text.');
    if (!q.options) throw new Error('MCQ missing options array.');
  }

  if (q.type === 'match') {
    if (!q.list1 || !Array.isArray(q.list1) || q.list1.length !== 4) throw new Error('Match question must have exactly 4 items in list1.');
    if (!q.list2 || !Array.isArray(q.list2) || q.list2.length !== 4) throw new Error('Match question must have exactly 4 items in list2.');
    if (!q.options) throw new Error('Match question missing mapping options.');
  }

  if (q.type === 'fib') {
    const fibQ = String(q.question || '').trim();
    if (!fibQ.includes('___')) throw new Error('FIB question is missing the blank "___" marker.');
    if (!q.answer && !q.correct) throw new Error('FIB question missing answer.');
    const fibForbiddenStart = /^(what|why|how|calculate|find|explain|describe|determine|state|derive|show|prove|is\b|are\b|does\b|do\b|can\b)/i;
    if (fibForbiddenStart.test(fibQ) || fibQ.endsWith('?')) {
      throw new Error('FIB question should be a declarative statement with a blank, not an interrogative question.');
    }
  }

  if (q.type === 'predict') {
    if (!q.question) throw new Error('Predict question missing code block.');
    if (!String(q.question).includes('\n')) throw new Error('Predict question does not appear to contain a multi-line code block.');
    if (!q.answer && !q.correct) throw new Error('Predict question missing expected output answer.');
  }

  if (q.type === 'numerical') {
    if (!q.question) throw new Error('Numerical question missing question text.');
    if (q.plain_answer !== undefined && q.plain_answer !== null) {
      if (isNaN(parseFloat(q.plain_answer))) throw new Error(`Numerical plain_answer "${q.plain_answer}" is not a valid number.`);
    } else if (!q.correct) {
      throw new Error('Numerical question missing plain_answer or correct value.');
    }
  }

  if (q.type === 'short') {
    if (!q.question) throw new Error('Short question missing question text.');
    if (!q.answer && !q.correct) throw new Error('Short question missing model answer.');
  }

  // ── 2. Normalize Options Array ────────────────────────────────────────
  if (q.options) {
    if (typeof q.options === 'string') {
      q.options = q.options.split(/\s*[,;]\s*(?=[A-Da-d]\))/).map(o => o.trim()).filter(Boolean);
    } else if (!Array.isArray(q.options)) {
      q.options = Object.entries(q.options).map(([k, v]) => `${k}) ${v}`);
    }
    if (q.type === 'mcq' && q.options.length !== 4) throw new Error(`MCQ must have exactly 4 options, found ${q.options.length}.`);
    if (q.type === 'match' && q.options.length !== 4) throw new Error(`Match must have exactly 4 options, found ${q.options.length}.`);
    if (q.options.length < 2) throw new Error('AI returned too few options after parsing.');
  }

  // ── 3. Normalize Correct Answer ───────────────────────────────────────
  if (q.correct) {
    if (['mcq', 'assertion', 'match', 'tf'].includes(q.type)) {
      let c = String(q.correct).trim().toUpperCase().charAt(0);
      if (q.type === 'tf') {
        if (c === 'T') c = 'A';
        else if (c === 'F') c = 'B';
      }
      if (!['A', 'B', 'C', 'D'].includes(c)) {
        throw new Error(`Invalid correct option "${q.correct}". Must be A, B, C, or D.`);
      }
      q.correct = c;
    } else {
      q.correct = String(q.correct).trim();
    }
  }

  // ── 4. Ensure Arrays ──────────────────────────────────────────────────
  if (q.steps && !Array.isArray(q.steps)) q.steps = [q.steps];
  if (q.key_points && !Array.isArray(q.key_points)) q.key_points = [q.key_points];
  if (q.given && !Array.isArray(q.given)) q.given = [q.given];
  if (!q.topic) q.topic = 'General';

  return q;
}

// ── Build Prompt (used by both single-AI and 2-AI pipeline) ──────────
function buildPrompt({ subject, examType, questionType, difficulty, topic, classLevel, academicProfile }) {
  const cls = classLevel || 'Class 12';

  let cognitiveLevel = '';
  if (difficulty === 'Easy') cognitiveLevel = "Bloom's Level: Remember & Understand. Focus ONLY on basic recall, definitions, and single-step straightforward calculations.";
  else if (difficulty === 'Medium') cognitiveLevel = "Bloom's Level: Analyze. Focus on multi-step reasoning, connecting two concepts, or identifying missing variables.";
  else cognitiveLevel = "Bloom's Level: Evaluate & Synthesize. Focus on complex scenarios, edge cases, analyzing incorrect assumptions, or abstract reasoning.";

  let subjectRules = '';
  switch (subject.toLowerCase()) {
    case 'physics':
      subjectRules = `PHYSICS RULES: Focus heavily on conceptual physics, free-body diagrams (mental models), vector notation, and SI units. If numerical, require explicit dimensional analysis. Test laws (e.g., Newton's laws, Thermodynamics) applied to physical systems. CRITICAL: Ensure all necessary parameters (mass, radius, time, etc.) are explicitly provided.`;
      break;
    case 'chemistry':
      subjectRules = `CHEMISTRY RULES: Focus on balanced chemical equations, stoichiometry, oxidation states, and electron pushing mechanisms. For physical chemistry, emphasize standard states and units. For inorganic, focus on periodic trends and orbital logic.`;
      break;
    case 'mathematics': case 'maths':
      subjectRules = `MATHEMATICS RULES: Focus on rigorous logical deduction, standard identities, and domain/range restrictions. Use LaTeX for EVERYTHING. For MATRICES: Use \\\\begin{pmatrix} ... \\\\end{pmatrix}. For CALCULUS: Use proper $\\\\int$, $\\\\frac{dy}{dx}$, $\\\\lim$ notation.`;
      break;
    case 'biology':
      subjectRules = `BIOLOGY RULES: Focus on exact scientific terminology, physiological pathways, and cellular mechanisms. Test understanding of "cause and effect" in biological systems.`;
      break;
    case 'computer science': case 'cs':
      subjectRules = `COMPUTER SCIENCE RULES: Focus on algorithmic logic, syntax constraints, data structures, and edge cases. Test concepts like time/space complexity, recursion, or OOP principles.`;
      break;
    default:
      subjectRules = `GENERAL RULES: Ensure absolute academic precision, clarity, and factual accuracy.`;
  }

  const examStyle = examType.toUpperCase().includes('JEE')
    ? 'JEE-style: calculation-heavy, multi-concept, trap-laden options differing by sign/factor/formula.'
    : examType.toUpperCase().includes('NEET')
      ? 'NEET-STYLE: Strictly NCERT-aligned. 1-2 step calculations ONLY. Highly factual. Solvable in under 1 minute.'
      : 'CBSE-style: application-based, clearly worded, tests understanding of standard concepts.';

  // Generic seeds — used for MCQ, numerical, assertion, short, fib, match
  const easySeeds = [
    'a straightforward application of the core formula',
    'identifying the correct definition of the concept',
    'a fundamental characteristic of the phenomenon',
    'a very basic real-world scenario directly mapped to a definition'
  ];
  const hardSeeds = [
    'a concept students commonly confuse with a similar one',
    'a real-world physical scenario requiring formula application',
    'a multi-step derivation with an unexpected intermediate result',
    'a tricky edge case or exception to a standard rule',
    'a comparison between two related concepts or phenomena',
    'a question that tests the WHY behind a formula, not just its use',
    'a problem where unit analysis or dimensional reasoning is key',
    'a question testing the boundary conditions of a law or theorem',
  ];
  const seeds = difficulty === 'Easy' ? easySeeds : hardSeeds;
  const seed = seeds[Math.floor(Math.random() * seeds.length)];

  // TF-specific seeds — all produce declarative statements, not calculations
  const easyTfSeeds = [
    'a fundamental definition that is universally true',
    'a very basic property of the concept',
    'a direct statement of a core scientific law',
    'a straightforward fact about units or dimensions'
  ];
  const hardTfSeeds = [
    'a common misconception students believe is true',
    'a surprising exception to a standard rule',
    'a frequently confused definition or property',
    'a boundary condition of a law that students misapply',
    'a cause-effect relationship that is often reversed by students',
    'a property that applies to one concept but NOT a related one',
    'an exam-relevant fact about units, signs, or direction',
    'a statement about the scope or limitation of a scientific law',
  ];
  const tfSeeds = difficulty === 'Easy' ? easyTfSeeds : hardTfSeeds;
  const tfSeed = tfSeeds[Math.floor(Math.random() * tfSeeds.length)];

  const keywords = getActiveChapterKeywords(subject, topic);
  const topicHint = topic
    ? `FOCUS: The question MUST specifically target this chapter/topic: "${topic}".${keywords ? ` Focus on one of these core concepts: ${keywords}.` : ''}`
    : `FOCUS: Choose a HIGH-YIELD chapter from the syllabus above.`;

  const syllabusContext = getSyllabusContext(subject, examType);

  const trivialRule = difficulty === 'Easy'
    ? '- TRIVIAL QUESTIONS ALLOWED: Focus on basic definitions, direct single-step formula application, and fundamental concepts. Do not use tricks or edge cases.'
    : '- NO TRIVIAL QUESTIONS: Require the student to apply, analyze, or connect — not just recall.';

  const system = `You are an elite Indian exam question setter crafting questions for ${examType} (${cls}).
${syllabusContext}

Generate ONE ${difficulty}-difficulty question. Rules:
- EXAM STYLE: ${examStyle}
- COGNITIVE LEVEL: ${cognitiveLevel}${academicProfile ? `\n- STUDENT ACADEMIC PROFILE: "${academicProfile}"\nSTRICT INSTRUCTION: Calibrate the cognitive load, the specific trap in the question, and the distractors to directly target this student's specific weaknesses and help them improve their score. If they mentioned common mistakes, design distractors that catch those exact mistakes.` : ''}
- COMPLETENESS: The question MUST contain ALL necessary variables and values required to solve it.
- MATHEMATICAL ACCURACY: Triple-check your final answer. The correct option must precisely match the mathematical result.
${trivialRule}
- SMART DISTRACTORS: Each wrong option must represent a specific, common student mistake.
- ${subjectRules}
- SYLLABUS LOCK: Chapter must be from the official list above.
- LaTeX CRITICAL: EVERY mathematical expression MUST be wrapped in $...$ delimiters. NEVER use \\( or \\). Do NOT omit backslashes or curly braces for LaTeX macros. You MUST double-escape backslashes in JSON. WRONG: "mathbf a = hati" CORRECT: "$ \\\\mathbf{a} = \\\\hat{i} $". WRONG: "a = \\frac{F}{m}" CORRECT: "$a = \\\\frac{F}{m}$".
- CHAIN OF THOUGHT: You MUST include a "thought_process" key as the VERY FIRST key in your JSON. Use it to outline your logic, mathematical calculations, and distractor planning before writing the final question fields.
- CONCISE EXPLANATIONS: Keep the "explanation" and "thought_process" fields clean, direct, and under 150 words. Absolutely avoid repeating calculations, looping patterns, or writing excessively redundant text.
- OUTPUT: Return ONLY the raw JSON object. No markdown fences, no extra text.

### TUTOR EXPLANATION FORMAT
When explaining a formula, you must use this JSON structure:
{"explanation":{"math_render":"$$...$$","what":"...","variables":["$sym$: meaning (unit)"],"when":"...","trap":"..."}}

TONE: Use plain, simple language for students. No textbook jargon.
- "what": 1-2 plain sentences. Explain what it means physically.
- "variables": Symbol, what it is, SI unit.
- "when": When to use this formula (bullet points ok).
- "trap": Common exam mistake.

### GOLD-STANDARD EXAMPLE FOR MATHEMATICAL/PHYSICS QUESTIONS
If generating an MCQ with math, your output must look EXACTLY like this (note the double-escaped LaTeX):

{
  "thought_process": "Concept: Integration by parts. Topic: Integrals. Difficulty: Hard. Distractors: Option A is the correct answer. Option B swaps the sign. Option C omits the 1/2. Option D integrates instead of differentiates.",
  "type": "mcq",
  "question": "Evaluate the integral $ \\\\int x \\\\cdot e^{2x} \\\\, dx $.",
  "options": [
    "A) $ \\\\frac{1}{2}xe^{2x} - \\\\frac{1}{4}e^{2x} + C $",
    "B) $ \\\\frac{1}{2}xe^{2x} + \\\\frac{1}{4}e^{2x} + C $",
    "C) $ xe^{2x} - e^{2x} + C $",
    "D) $ \\\\frac{1}{4}x^2 e^{2x} + C $"
  ],
  "correct": "A",
  "explanation": "CORRECT (A): Using integration by parts with $ u = x $ and $ dv = e^{2x} dx $. TRAPS: B is a sign error, C forgot the 1/2 multiplier, D integrated x instead of differentiating.",
  "topic": "Integrals",
  "difficulty": "Hard"
}`;

  let userMsg = '';
  let maxTok = 1200;

  // Pick a random correct answer letter so the AI doesn't anchor on A
  const letters = ['A', 'B', 'C', 'D'];
  const randLetter = () => letters[Math.floor(Math.random() * letters.length)];

  if (questionType === 'mcq') {
    maxTok = 1600;
    const mcqCorrect = randLetter();
    // Determine which distractor description goes with the correct slot
    const distractorMap = {
      A: 'B=wrong formula, C=sign/factor error, D=conceptual confusion',
      B: 'A=wrong formula, C=sign/factor error, D=conceptual confusion',
      C: 'A=wrong formula, B=sign/factor error, D=conceptual confusion',
      D: 'A=wrong formula, B=sign/factor error, C=conceptual confusion'
    };
    userMsg = `${difficulty} MCQ. Angle: "${seed}". ${topicHint}

QUALITY INSTRUCTIONS:
- The question must require application or analysis. No simple definition recall.
- Distractors MUST NOT be random numbers/words. They must be generated using the specific errors listed here: ${distractorMap[mcqCorrect]}.
- The CORRECT answer MUST be placed in option ${mcqCorrect}. Triple-check its accuracy.
- In the explanation, explicitly identify the trap that leads to each wrong option.

Return ONLY this JSON:
{"type":"mcq","question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"${mcqCorrect}","explanation":"CORRECT (${mcqCorrect}): [full working]. TRAPS: [Explain exactly what mistake leads to each wrong option].","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;

  } else if (questionType === 'numerical') {
    maxTok = 2000;
    userMsg = `${difficulty} numerical problem. Angle: "${seed}". ${topicHint}

QUALITY INSTRUCTIONS:
- Use realistic, non-trivial values. However, the final math should be solvable without a heavy calculator (values should cancel out elegantly if the right formula is used).
- If the answer is extremely small/large, format "correct" with LaTeX scientific notation but format "plain_answer" strictly as e-notation (e.g. 2.26e-3).
- "plain_answer" must be ONLY the bare number, no units, no LaTeX — used for auto-grading.

Return ONLY this JSON:
{"type":"numerical","question":"Problem statement with all given values in $LaTeX$.","given":["$v_0 = 5\\\\text{ m/s}$","$m = 2\\\\text{ kg}$"],"correct":"$12.5\\\\text{ J}$","plain_answer":12.5,"steps":["Step 1: Identify formula","Step 2: Substitute","Step 3: Calculate"],"explanation":"Concept and why this formula applies.","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;

  } else if (questionType === 'assertion') {
    maxTok = 1600;
    const assertCorrect = randLetter();
    const assertMeanings = {
      A: 'Both A and R are true, R IS the correct explanation of A',
      B: 'Both A and R are true, but R is NOT the correct explanation of A',
      C: 'A is true, R is false',
      D: 'A is false, R is true (or both false)'
    };
    userMsg = `${difficulty} Assertion-Reason question. Angle: "${seed}". ${topicHint}

QUALITY INSTRUCTIONS:
- Write the assertion and reason such that the correct answer is explicitly option ${assertCorrect} (Meaning: ${assertMeanings[assertCorrect]}).
- A must be a non-trivial fact. R must be a mechanistic explanation.
- CRITICAL: Even if the correct answer is B, C, or D, statement R MUST be topically related to statement A. Do not make R a completely random fact, otherwise the question becomes too easy to guess by elimination.

Return ONLY this JSON:
{"type":"assertion","assertion":"Statement A.","reason":"Statement R.","options":["A) Both true, R explains A","B) Both true, R does NOT explain A","C) A true, R false","D) A false, R true"],"correct":"${assertCorrect}","explanation":"A TRUTH: [explain]. R TRUTH: [explain]. CAUSAL LINK: [explain why ${assertCorrect} is correct].","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;

  } else if (questionType === 'predict') {
    maxTok = 1600;
    userMsg = `${difficulty} Predict-the-Output question for a Computer Science student. ${topicHint}
RULES:
- Write code that is 100% syntactically and logically correct. Double-check the output yourself step by step before writing "answer".
- Include exactly ONE non-obvious trap (e.g. integer division, short-circuit, operator precedence, scope, mutation).
- State the programming language at the top of the code as a comment (e.g. # Python or // Java).
- "answer" must be the exact console output string, including newlines if any.
Return ONLY this JSON:
{"type":"predict","question":"What is the output of the following code?\\n\\n[full code here with language comment]","answer":"exact output line by line","key_points":["the specific trap","why it produces this output"],"explanation":"Step-by-step execution trace.","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;

  } else if (questionType === 'fib') {
    maxTok = 1200;
    userMsg = `${difficulty} Fill in the Blanks question. Angle: "${seed}". ${topicHint}

QUALITY INSTRUCTIONS:
- The question MUST contain exactly one blank written as _____ (5 underscores).
- The blank MUST test a highly specific and unambiguous concept, law name, or numerical value. Do not create open-ended blanks (e.g., "Physics is _____"). 
- Good Example: "According to Faraday's Law, the induced emf is proportional to the rate of change of _____."
- The statement MUST be a declarative sentence. It CANNOT be a question.
- "answer" is the exact word/value/formula for the blank. Keep it as concise as possible (1-3 words).
- "key_points" should give 1-2 hints that help a student understand why, without giving away the answer.

Return ONLY this JSON:
{"type":"fib","question":"[Clear, unambiguous declarative statement with exactly one _____].","answer":"[exact concise word or value]","key_points":["hint 1","hint 2"],"explanation":"[Why the answer is correct with context.]","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;

  } else if (questionType === 'match') {
    maxTok = 1600;
    const matchCorrect = randLetter();
    userMsg = `${difficulty} Match the Following question. Angle: "${seed}". ${topicHint}

QUALITY INSTRUCTIONS:
- The items in List I and List II must be highly related but easy to confuse. Examples: [Quantities vs Formulas], [Theories vs Limitations], [Exceptions vs Rules].
- Create exactly 4 original items in List I (labelled A, B, C, D) and exactly 4 items in List II (labelled P, Q, R, S).
- The correct mapping MUST be placed in option ${matchCorrect}. 
- Distractor options MUST be challenging. Do not just randomize mappings. Instead, deliberately swap 1 or 2 pairs from the correct mapping to create plausible "partial knowledge" traps for students who only know half the answers.
- DO NOT use placeholder text. Create real, subject-specific, highly accurate content.

Return ONLY this JSON:
{"type":"match","question":"Match the items in List I with List II.","list1":["A. [concept 1]","B. [concept 2]","C. [concept 3]","D. [concept 4]"],"list2":["P. [match 1]","Q. [match 2]","R. [match 3]","S. [match 4]"],"options":["A) A-P, B-Q, C-R, D-S","B) A-R, B-P, C-S, D-Q","C) A-Q, B-S, C-P, D-R","D) A-S, B-R, C-Q, D-P"],"correct":"${matchCorrect}","explanation":"[Explain the full mapping logic and why certain pairs are easy to confuse.]","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;

  } else if (questionType === 'tf') {
    maxTok = 1200;
    const tfCorrectExample = Math.random() > 0.5 ? 'A' : 'B';
    const tfTruthState = tfCorrectExample === 'A' ? 'TRUE' : 'FALSE';

    userMsg = `${difficulty} True/False question. Angle: "${tfSeed}". ${topicHint}

CRITICAL — READ CAREFULLY:
- The "question" field MUST be a short DECLARATIVE STATEMENT only. It must NOT be a question.
- FORBIDDEN PHRASES (do NOT use any of these): "explain", "describe", "what is", "why is", "how does", "calculate", "find", "determine", "show that", "derive", "is", "does", "true or false".
- The statement MUST NOT end with a question mark "?".
- CORRECT FORMAT: "The net electric flux through a closed surface depends on charges outside the surface."
- WRONG FORMAT 1: "A point charge is placed inside a sphere. Explain the flux distribution." ← WRONG (asks to explain)
- WRONG FORMAT 2: "Is it true that the net electric flux depends on outside charges?" ← WRONG (interrogative question)

QUALITY INSTRUCTIONS:
- You MUST generate a statement that is explicitly ${tfTruthState}.
- If generating a FALSE statement (correct answer B), it MUST sound highly plausible and represent a common student misconception. It should not be trivially false.
- If generating a TRUE statement (correct answer A), it should test a subtle edge case, an obscure corollary, or a counter-intuitive fact. It should not be a basic definition.
- Set "correct" to "${tfCorrectExample}".

Return ONLY this JSON:
{"type":"tf","question":"[ONE declarative sentence — no question mark]","options":["A) True","B) False"],"correct":"${tfCorrectExample}","explanation":"This statement is [true/false] because [concise factual reason].","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;
  } else {
    maxTok = 1400;
    userMsg = `${difficulty} short-answer question. Angle: "${seed}". ${topicHint}

QUALITY INSTRUCTIONS:
- The question MUST test deep understanding, application, or critical reasoning.
- FORBIDDEN: Do NOT ask simple recall questions like "Define [Term]" or "What is [Term]?". 
- Good Question Starters: "Why does...", "How can you justify...", "Compare the effects of...", "Explain the underlying mechanism of...".
- "answer" must be the absolute gold-standard model answer (exactly 2-3 concise, high-impact sentences). It must directly answer the question without fluff.
- "key_points" must act as a strict grading rubric. List the 2-3 essential scientific keywords or core logic steps a student MUST mention to get full marks.

Return ONLY this JSON:
{"type":"short","question":"[Deep conceptual question requiring reasoning.]","answer":"[2-3 sentence gold-standard model answer.]","key_points":["Mandatory Keyword/Concept 1","Mandatory Logic Step 2"],"explanation":"[Full tutor-quality explanation breaking down the core concepts.]","topic":"${topic || 'chapter name'}","difficulty":"${difficulty}"}`;
  }

  return { system, userMsg, maxTok };
}

// Cache removed as it caused identical questions to be served

// ── Unified Pipeline: NIM Only ───────────────────────────────────────
async function generateQuestionPipeline(params) {
  const coalescingKey = `${String(params.subject).trim()}:${String(params.questionType).trim()}:${String(params.difficulty).trim()}:${String(params.topic || 'General').trim()}:${String(params.classLevel || '11').trim()}`.toLowerCase();

  if (inFlightGenerations.has(coalescingKey)) {
    console.log(`[PIPELINE] Coalescing concurrent request for key: ${coalescingKey}`);
    return inFlightGenerations.get(coalescingKey);
  }

  const promise = (async () => {
    const { system, userMsg, maxTok } = buildPrompt(params);
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ];

    let attempts = 0;
    let lastErr = null;

    while (attempts < 3) {
      attempts++;
      let rawResponse = '';
      try {
        const isHeavy = (params.questionType === 'numerical' || params.questionType === 'predict');
        const fallbackModel = isHeavy ? NIM_HEAVY_MODEL : NIM_FAST_MODEL;
        const tuning = GENERATION_TUNING[params.questionType] || { temperature: 0.6, top_p: 0.95, max_tokens: maxTok };
        rawResponse = await askNIM(messages, tuning.max_tokens, true, fallbackModel, 25000, tuning.temperature, tuning.top_p);

        const q = extractAndNormalize(rawResponse, params.questionType);

        // --- NEW PEDAGOGICAL CRITIC LOOP ---
        if (params.questionType !== 'numerical' && params.questionType !== 'predict') {
          console.log(`[PIPELINE] Running Pedagogical Critic Loop on ${q.type} question...`);
          const CRITIC_SYSTEM_PROMPT = `You are a Senior Question Reviewer for Indian Competitive Exams.
Analyze the draft question JSON. Evaluate it against these criteria:
1. Plausibility: Are distractors realistic mistakes, or obviously wrong?
2. Ambiguity: Is the question phrasing perfectly clear?
3. Formatting: Are mathematical symbols wrapped perfectly in LaTeX $...$?
Return JSON ONLY:
{
  "passed": true,
  "critique": "If passed is false, list exactly what to fix."
}`;
          const reviewRaw = await askNIM([
            { role: 'system', content: CRITIC_SYSTEM_PROMPT },
            { role: 'user', content: JSON.stringify(q) }
          ], 300, true, NIM_FAST_MODEL, 15000, 0.1, 0.9);
          
          let review;
          try { review = JSON.parse(reviewRaw); } catch (e) { review = { passed: true }; }
          
          if (review.passed === false) {
             throw new Error(`Pedagogical Review Failed: ${review.critique}`);
          }
          console.log(`[PIPELINE] Pedagogical Critic passed.`);
        }
        // -----------------------------------

        // Two-stage Math/Science Verification Check
        if (q.type === 'numerical' || q.type === 'predict') {
          console.log(`[PIPELINE] Verifying generated draft question of type: ${q.type}...`);
          let verification = null;
          try {
            verification = await verifyQuestion(q.question, q.type);
          } catch (verifyErr) {
            // If the verifier itself fails (network, parse error), skip verification with a warning
            console.warn(`[PIPELINE] Verifier call failed — skipping math check (fail-open): ${verifyErr.message}`);
          }

          if (verification && (verification.solved_value !== undefined && verification.solved_value !== null)) {
            if (q.type === 'numerical') {
              const draftVal = q.plain_answer !== undefined ? q.plain_answer : q.correct;
              const draftNum = extractNumber(draftVal);
              const solvedNum = extractNumber(verification.solved_value);
              
              if (draftNum === null || solvedNum === null) {
                // Can't extract numbers — skip strict check, log a warning
                console.warn(`[PIPELINE] Could not extract numerical values for comparison. Draft: "${draftVal}", Solver: "${verification.solved_value}". Skipping math gate.`);
              } else {
                const discrepancy = Math.abs(draftNum - solvedNum) / Math.max(Math.abs(draftNum), 1.0);
                if (discrepancy > 0.05) {
                  throw new Error(`Our math solver verified the question and calculated the value as ${solvedNum} (Reasoning: ${verification.reasoning}), but your draft had ${draftNum}. Please re-evaluate the physics/math, resolve this error, and generate a correct question.`);
                }
                console.log(`[PIPELINE] Math verification passed. Draft: ${draftNum}, Solver: ${solvedNum}, Discrepancy: ${(discrepancy * 100).toFixed(2)}%`);
              }
            } else if (q.type === 'predict') {
              const draftStr = String(q.answer !== undefined ? q.answer : q.correct).trim();
              const solvedStr = String(verification.solved_value).trim();
              
              if (draftStr.toLowerCase() !== solvedStr.toLowerCase()) {
                throw new Error(`Our code execution engine simulated the code and outputted:\n${solvedStr}\n(Reasoning: ${verification.reasoning}), but your draft had:\n${draftStr}\nPlease check for logical bugs, trace the code execution step-by-step, and generate a corrected question.`);
              }
              console.log(`[PIPELINE] Code prediction verification passed. Output matches: "${draftStr}"`);
            }
          } else {
            // Verifier returned a response but without solved_value — skip the gate, warn in logs
            console.warn(`[PIPELINE] Verifier did not return "solved_value" — skipping math gate for this question (fail-open).`);
          }
        }

        return q;
      } catch (err) {
        lastErr = err;
        const hasResponse = rawResponse && rawResponse.length > 0;

        console.warn(`[PIPELINE] Attempt ${attempts} failed: ${err.message}.`);

        // AGENTIC SELF-HEALING LOOP: Feed specific validation errors back to the AI
        if (hasResponse) {
          console.log(`[PIPELINE] Feeding parsing/validation error back to AI for self-correction...`);
          messages.push({ role: 'assistant', content: rawResponse });
          
          if (err.message.includes('math solver verified') || err.message.includes('code execution engine')) {
            messages.push({ role: 'user', content: `MATH/LOGIC VERIFICATION FAILED: ${err.message}\nPlease re-evaluate your step-by-step reasoning and generate a mathematically correct question. Do not just rewrite the same question.` });
          } else {
            messages.push({ role: 'user', content: `CRITICAL VALIDATION ERROR: ${err.message}\nFix your JSON output to strictly comply with the format rules.` });
          }
        } else {
          // If it's a network/API error (no response), do not modify messages, just retry.
          console.log(`[PIPELINE] Network/API error detected (no response). Retrying without modifying prompt...`);
        }

        // Exponential backoff sleep before retrying
        if (attempts < 3) {
          const isRateLimit = err.message.includes('429') || err.message.includes('Limit') || err.message.includes('rate');
          const baseDelay = isRateLimit ? 3000 : 1500;
          const delay = attempts * baseDelay + Math.floor(Math.random() * 1000);
          console.log(`[PIPELINE] Sleeping for ${delay}ms before attempt ${attempts + 1}...`);
          await sleep(delay);
        }
      }
    }

    throw new Error(`Failed to generate valid question after 3 attempts. Last error: ${lastErr.message}`);
  })();

  inFlightGenerations.set(coalescingKey, promise);

  try {
    return await promise;
  } finally {
    inFlightGenerations.delete(coalescingKey);
  }
}

// ── Route: Generate Question ─────────────────────────────────────────
const activeReplenishments = new Set();

// Background JIT Cache Replenishment Concurrency Semaphore
const MAX_BACKGROUND_CONCURRENT = 8;
let activeBackgroundCount = 0;
const backgroundQueue = [];

function bgSemAcquire() {
  return new Promise(resolve => {
    if (activeBackgroundCount < MAX_BACKGROUND_CONCURRENT) {
      activeBackgroundCount++;
      resolve();
    } else {
      backgroundQueue.push(resolve);
    }
  });
}

function bgSemRelease() {
  activeBackgroundCount--;
  if (backgroundQueue.length > 0) {
    activeBackgroundCount++;
    const nextResolve = backgroundQueue.shift();
    nextResolve();
  }
}

let globalRateLimitCooldown = 0;

function replenishCacheBackground(params) {
  const { subject, examType, sessionQuestionTypes, questionType, difficulty, topic, classLevel } = params;
  const activeDifficulty = difficulty || 'Medium';
  const typesToWarm = Array.isArray(sessionQuestionTypes) ? sessionQuestionTypes : [questionType];

  (async () => {
    for (const qType of typesToWarm) {
      if (!qType) continue;
      const key = `${subject}:${topic || 'General'}:${activeDifficulty}:${qType}`.toLowerCase();
      if (activeReplenishments.has(key)) continue;

      activeReplenishments.add(key);

      try {
        await new Promise((resolve) => {
          const countQuery = `SELECT COUNT(*) as count FROM question_cache WHERE LOWER(subject) = LOWER(?) AND LOWER(questionType) = LOWER(?) AND LOWER(difficulty) = LOWER(?) AND LOWER(topic) = LOWER(?)`;
          const queryParams = [subject, qType, activeDifficulty, topic || 'General'];

          db.get(countQuery, queryParams, async (err, row) => {
            if (err) {
              console.error('[REPLENISH ERROR]', err.message);
              activeReplenishments.delete(key);
              return resolve();
            }

            const count = row ? row.count : 0;
            const target = 15;
            if (count >= target) {
              activeReplenishments.delete(key);
              return resolve();
            }

            const needed = Math.min(5, target - count);
            console.log(`[CACHE REPLENISH] Topic "${topic || 'General'}" has ${count}/${target} cached for ${qType}. Warming up ${needed} questions...`);

            const promises = [];

            for (let i = 0; i < needed; i++) {
              promises.push((async () => {
                await bgSemAcquire();
                try {
                  // If a global rate limit is active, abort this task cleanly
                  if (Date.now() < globalRateLimitCooldown) {
                    return;
                  }

                  // Stagger slightly (0 to 800ms) to avoid absolute visual or rate-limiting synchronization
                  await new Promise(r => setTimeout(r, Math.random() * 800));

                  const question = await generateQuestionPipeline({
                    subject,
                    examType,
                    questionType: qType,
                    difficulty: activeDifficulty,
                    topic,
                    classLevel
                  });

                  await new Promise((resWrite, rejWrite) => {
                    db.run(
                      `INSERT INTO question_cache (subject, topic, questionType, difficulty, questionJson) VALUES (?, ?, ?, ?, ?)`,
                      [subject, topic || question.topic || 'General', qType, activeDifficulty, JSON.stringify(question)],
                      (insertErr) => {
                        if (insertErr) {
                          console.warn('[CACHE REPLENISH WRITE ERROR]', insertErr.message);
                          rejWrite(insertErr);
                        } else {
                          console.log(`[CACHE REPLENISH WRITE] Cached background question for ${qType}`);
                          resWrite();
                        }
                      }
                    );
                  });
                } catch (genErr) {
                  console.error(`[CACHE REPLENISH ERROR] Type ${qType} failed:`, genErr.message);
                  if (genErr.message.includes('429') || genErr.message.includes('Limit') || genErr.message.includes('rate')) {
                    console.warn('[CACHE REPLENISH] Rate limit encountered! Pausing ALL background cache warming for 30 seconds.');
                    globalRateLimitCooldown = Date.now() + 30000; // 30 seconds global cooldown
                  }
                } finally {
                  bgSemRelease();
                }
              })());
            }

            await Promise.allSettled(promises);
            activeReplenishments.delete(key);
            resolve();
          });
        });
      } catch (err) {
        console.error('[REPLENISH LOOP ERROR]', err.message);
        activeReplenishments.delete(key);
      }
    }
  })();
}

app.post('/api/generate-question', async (req, res) => {
  const { subject, examType, questionType, difficulty, topic, classLevel, excludeList, sessionQuestionTypes, prewarmOnly, useCache, academicProfile } = req.body;
  const shouldCache = useCache !== false; // default true
  
  let activeDifficulty = difficulty;
  if (difficulty === 'Adaptive') {
    activeDifficulty = await getAdaptiveDifficulty(subject, topic);
    console.log(`[ADAPTIVE] Resolved mastery difficulty to: ${activeDifficulty} for topic: ${topic || 'General'}`);
  }

  if (shouldCache) {
    // Trigger background JIT cache replenishment
  replenishCacheBackground({
    subject,
    examType,
    sessionQuestionTypes,
    questionType,
    difficulty: activeDifficulty,
    topic,
    classLevel
  });
  }

  if (prewarmOnly) {
    return res.json({ success: true, message: 'Prewarming triggered in the background' });
  }

  const params = { subject, examType, questionType, difficulty: activeDifficulty, topic, classLevel, academicProfile };

  if (!shouldCache) {
    try {
      const question = await generateQuestionPipeline(params);
      console.log(`[Q LIVE] ${subject} | ${questionType} | ${activeDifficulty} | topic: ${question.topic}`);
      return res.json({ success: true, question });
    } catch (err) {
      console.error('[generate-question ERROR]', err.message);
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  let query = `SELECT * FROM question_cache WHERE LOWER(subject) = LOWER(?) AND LOWER(questionType) = LOWER(?) AND LOWER(difficulty) = LOWER(?) AND timestamp > datetime('now', '-7 days')`;
  const queryParams = [subject, questionType, activeDifficulty];
  if (topic) {
    query += ` AND LOWER(topic) = LOWER(?)`;
    queryParams.push(topic);
  }

  db.all(query, queryParams, async (err, rows) => {
    if (err) {
      console.error('[CACHE ERROR]', err.message);
    } else if (rows && rows.length > 0) {
      const candidates = rows.map(r => {
        try {
          return JSON.parse(r.questionJson);
        } catch {
          return null;
        }
      }).filter(q => {
        if (!q) return false;
        const qText = String(q.question || q.assertion || '').trim().toLowerCase();
        if (excludeList && Array.isArray(excludeList)) {
          return !excludeList.some(ex => String(ex).trim().toLowerCase() === qText);
        }
        return true;
      });

      if (candidates.length > 0) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        console.log(`[CACHE HIT] Loaded question: ${chosen.topic} | ${chosen.type} | ${chosen.difficulty}`);
        return res.json({ success: true, question: chosen, cached: true });
      }
    }

    // Cache miss or all cached questions excluded
    try {
      const question = await generateQuestionPipeline(params);
      console.log(`[Q] ${subject} | ${questionType} | ${activeDifficulty} | topic: ${question.topic}`);

      db.run(`INSERT INTO question_cache (subject, topic, questionType, difficulty, questionJson) VALUES (?, ?, ?, ?, ?)`,
        [subject, topic || question.topic || 'General', questionType, activeDifficulty, JSON.stringify(question)],
        (cacheErr) => {
          if (cacheErr) console.warn('[CACHE WRITE ERROR]', cacheErr.message);
          else console.log('[CACHE WRITE] Cached new question');
        }
      );

      res.json({ success: true, question });
    } catch (err) {
      console.error('[generate-question ERROR]', err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });
});

app.post('/api/cache/clear', (req, res) => {
  db.serialize(() => {
    db.run(`DELETE FROM question_cache`);
    db.run(`DELETE FROM formula_cache`);
    db.run(`DELETE FROM formula_explain_cache`, function(err) {
      if (err) return res.status(500).json({ success: false, error: err.message });
      res.json({ success: true, message: 'All caches cleared successfully.' });
    });
  });
});

app.get('/api/cache/status', (req, res) => {
  db.all(
    `SELECT subject, questionType, difficulty, COUNT(*) as count 
     FROM question_cache 
     GROUP BY subject, questionType, difficulty`,
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, error: err.message });

      db.get(`SELECT COUNT(*) as total FROM question_cache`, (err2, row2) => {
        if (err2) return res.status(500).json({ success: false, error: err2.message });

        res.json({
          success: true,
          total: row2 ? row2.total : 0,
          breakdown: rows || [],
          activeReplenishments: Array.from(activeReplenishments)
        });
      });
    }
  );
});

// Helper to look up a single matching question from the cache that has not been selected yet
function getCachedQuestion(subject, qType, activeDifficulty, forcedTopic, chosenQuestionTexts) {
  return new Promise((resolve) => {
    let query = `SELECT * FROM question_cache WHERE LOWER(subject) = LOWER(?) AND LOWER(questionType) = LOWER(?) AND LOWER(difficulty) = LOWER(?) AND timestamp > datetime('now', '-7 days')`;
    const queryParams = [subject, qType, activeDifficulty];
    if (forcedTopic) {
      query += ` AND LOWER(topic) = LOWER(?)`;
      queryParams.push(forcedTopic);
    }
    db.all(query, queryParams, (err, rows) => {
      if (err || !rows || rows.length === 0) {
        return resolve(null);
      }
      const candidates = rows.map(r => {
        try {
          return JSON.parse(r.questionJson);
        } catch {
          return null;
        }
      }).filter(q => {
        if (!q) return false;
        const qText = String(q.question || q.assertion || '').trim().toLowerCase();
        return !chosenQuestionTexts.has(qText);
      });
      if (candidates.length > 0) {
        const chosen = candidates[Math.floor(Math.random() * candidates.length)];
        resolve(chosen);
      } else {
        resolve(null);
      }
    });
  });
}

// ── Route: Batch Generate (for PDF papers) ───────────────────────────
app.post('/api/generate-batch', async (req, res) => {
  const { subject, examType, questionTypes, difficulty, topic, classLevel, count, useCache, academicProfile } = req.body;
  const shouldCache = useCache !== false;
  const total = Math.min(count || 5, 30);
  const types = questionTypes || ['mcq'];

  const syllabusTopics = getSyllabusTopicsArray(subject);
  // Shuffle syllabus
  for (let i = syllabusTopics.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [syllabusTopics[i], syllabusTopics[j]] = [syllabusTopics[j], syllabusTopics[i]];
  }

  // Semaphore: max 20 parallel requests to utilize NVIDIA NIM concurrency
  const MAX_CONCURRENT = 20;
  let active = 0;
  const queue = [];
  function semAcquire() {
    return new Promise(resolve => {
      if (active < MAX_CONCURRENT) { active++; resolve(); }
      else queue.push(resolve);
    });
  }
  function semRelease() {
    active--;
    if (queue.length) { active++; queue.shift()(); }
  }

  const questions = [];
  const chosenQuestionTexts = new Set();
  const slotsToGenerate = [];

  // Parallelize Adaptive Difficulty lookups
  const activeDifficulties = await Promise.all(
    Array.from({ length: total }).map(async (_, i) => {
      const forcedTopic = (syllabusTopics.length > 0 && !topic) ? syllabusTopics[i % syllabusTopics.length] : topic;
      return difficulty === 'Adaptive' ? await getAdaptiveDifficulty(subject, forcedTopic) : difficulty;
    })
  );

  // Fetch all cache candidates in parallel
  const cacheLookups = await Promise.all(
    Array.from({ length: total }).map(async (_, i) => {
      if (!shouldCache) return [];
      const qType = types[i % types.length];
      const forcedTopic = (syllabusTopics.length > 0 && !topic) ? syllabusTopics[i % syllabusTopics.length] : topic;
      return new Promise((resolve) => {
        let query = `SELECT * FROM question_cache WHERE LOWER(subject) = LOWER(?) AND LOWER(questionType) = LOWER(?) AND LOWER(difficulty) = LOWER(?) AND timestamp > datetime('now', '-7 days')`;
        const queryParams = [subject, qType, activeDifficulties[i]];
        if (forcedTopic) {
          query += ` AND LOWER(topic) = LOWER(?)`;
          queryParams.push(forcedTopic);
        }
        db.all(query, queryParams, (err, rows) => resolve(rows || []));
      });
    })
  );

  // Sequentially deduplicate from the fetched candidates
  for (let i = 0; i < total; i++) {
    const qType = types[i % types.length];
    const forcedTopic = (syllabusTopics.length > 0 && !topic) ? syllabusTopics[i % syllabusTopics.length] : topic;
    const activeDifficulty = activeDifficulties[i];
    
    let cachedQ = null;
    if (shouldCache) {
      const rows = cacheLookups[i];
      const candidates = rows.map(r => {
        try { return JSON.parse(r.questionJson); } catch { return null; }
      }).filter(q => {
        if (!q) return false;
        const qText = String(q.question || q.assertion || '').trim().toLowerCase();
        return !chosenQuestionTexts.has(qText);
      });
      if (candidates.length > 0) {
        cachedQ = candidates[Math.floor(Math.random() * candidates.length)];
      }
    }
    
    if (cachedQ) {
      const qText = String(cachedQ.question || cachedQ.assertion || '').trim().toLowerCase();
      chosenQuestionTexts.add(qText);
      questions.push({ index: i, q: cachedQ });
      console.log(`[BATCH CACHE HIT ${i + 1}/${total}] ${qType} | ${cachedQ.topic}`);
    } else {
      slotsToGenerate.push({
        index: i,
        params: { subject, examType, questionType: qType, difficulty: activeDifficulty, topic: forcedTopic, classLevel, academicProfile }
      });
    }
  }

  const tasks = slotsToGenerate.map(slot => async () => {
    await semAcquire();
    try {
      const q = await generateQuestionPipeline(slot.params);
      console.log(`[BATCH GEN ${slot.index + 1}/${total}] ${slot.params.questionType} | ${q.topic}`);
      
      if (shouldCache) {
        // Save newly generated question to cache under the requested topic
        db.run(`INSERT INTO question_cache (subject, topic, questionType, difficulty, questionJson) VALUES (?, ?, ?, ?, ?)`,
          [slot.params.subject, slot.params.topic || q.topic || 'General', slot.params.questionType, slot.params.difficulty, JSON.stringify(q)],
          (cacheErr) => {
            if (cacheErr) console.warn('[BATCH CACHE WRITE ERROR]', cacheErr.message);
          }
        );
      }
      
      return { ok: true, index: slot.index, q };
    } catch (err) {
      console.error(`[BATCH GEN ${slot.index + 1} ERROR]`, err.message);
      return { ok: false, index: slot.index, error: err.message };
    } finally {
      semRelease();
    }
  });

  // Fire remaining generations in parallel (respecting semaphore)
  const results = await Promise.allSettled(tasks.map(t => t()));

  const errors = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value.ok) {
      questions.push({ index: r.value.index, q: r.value.q });
    } else {
      errors.push({ index: r.value?.index, error: r.value?.error || r.reason?.message });
    }
  });

  // Sort back to preserve layout ordering
  questions.sort((a, b) => a.index - b.index);
  const finalQuestions = questions.map(x => x.q);

  res.json({ success: true, questions: finalQuestions, errors, total: finalQuestions.length });
});

// ── Route: Grade Short Answer ──────────────────────────────────────────
app.post('/api/grade-short', async (req, res) => {
  const { question, modelAnswer, keyPoints, studentAnswer } = req.body;

  const sysMsg = `You are a strict, fair examiner. Compare the STUDENT ANSWER to the MODEL ANSWER and KEY POINTS RUBRIC.
Score the student out of 10. They get marks ONLY if they hit the core concepts in the KEY POINTS.
Return ONLY JSON: {"score": <number 0-10>, "feedback": "<1 concise sentence pointing out exactly what they missed or got right>"}`;

  const userMsg = `QUESTION: ${question}
MODEL ANSWER: ${modelAnswer}
KEY POINTS RUBRIC: ${keyPoints.join(', ')}
STUDENT ANSWER: ${studentAnswer}`;

  try {
    const messages = [{ role: 'system', content: sysMsg }, { role: 'user', content: userMsg }];
    const raw = await askNIM(messages, 250, true, NIM_FAST_MODEL);
    const parsed = JSON.parse(raw);
    res.json({ success: true, ...parsed });
  } catch (err) {
    console.error('[GRADE ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Route: Deeper Explanation ────────────────────────────────────────
app.post('/api/explain', async (req, res) => {
  const { question, subject, examType } = req.body;

  const system = `You are a warm, friendly tutor helping an Indian student who just got a question wrong.
Explain WHY the correct answer is right in simple, conversational language — like a teacher sitting next to them.
KEEP IT SHORT: max 4 sentences. No long paragraphs. No academic textbook language.
Use everyday analogies where possible. Highlight the KEY INSIGHT they missed.
Use LaTeX ($...$) only for math expressions, not for plain words.`;


  const q = question;
  const qText = q.question || q.assertion || 'this question';
  const userMsg = `Explain in a student-friendly way why the answer to this question is "${q.correct || q.answer}":
Question: ${qText}
Correct answer: ${q.correct || q.answer}
Standard explanation: ${q.explanation}`;

  try {
    const explanation = await askNIM([{ role: 'system', content: system }, { role: 'user', content: userMsg }], 350, false, NIM_FAST_MODEL);
    res.json({ success: true, explanation });
  } catch (err) {
    console.error('[explain ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Route: Smart Adaptation (analyze weak topics) ────────────────────
app.post('/api/analyze-performance', async (req, res) => {
  const { history } = req.body;
  // history = array of { subject, topic, result: 'correct'|'wrong'|'skipped', difficulty }

  if (!history || !history.length) {
    return res.json({ success: true, analysis: { weakTopics: [], suggestions: [] } });
  }

  const topicMap = {};
  history.forEach(h => {
    const key = `${h.subject}|${h.topic}`;
    if (!topicMap[key]) topicMap[key] = { subject: h.subject, topic: h.topic, correct: 0, wrong: 0, total: 0 };
    topicMap[key].total++;
    if (h.result === 'correct') topicMap[key].correct++;
    else if (h.result === 'wrong') topicMap[key].wrong++;
  });

  const topics = Object.values(topicMap);
  const weakTopics = topics
    .filter(t => t.total >= 2 && (t.correct / t.total) < 0.5)
    .sort((a, b) => (a.correct / a.total) - (b.correct / b.total));

  const strongTopics = topics
    .filter(t => t.total >= 2 && (t.correct / t.total) >= 0.8)
    .sort((a, b) => (b.correct / b.total) - (a.correct / a.total));

  const suggestions = [];
  weakTopics.forEach(t => {
    suggestions.push({
      type: 'weak',
      subject: t.subject,
      topic: t.topic,
      accuracy: Math.round((t.correct / t.total) * 100),
      message: `You're scoring ${Math.round((t.correct / t.total) * 100)}% in ${t.topic}. Try practicing with Easy difficulty first.`,
    });
  });

  // Suggest difficulty adjustment
  const overall = topics.reduce((a, t) => ({ c: a.c + t.correct, t: a.t + t.total }), { c: 0, t: 0 });
  const overallPct = overall.t > 0 ? (overall.c / overall.t) * 100 : 50;
  let suggestedDifficulty = 'Medium';
  if (overallPct >= 80) suggestedDifficulty = 'Hard';
  else if (overallPct < 40) suggestedDifficulty = 'Easy';

  res.json({
    success: true,
    analysis: {
      weakTopics: weakTopics.slice(0, 5),
      strongTopics: strongTopics.slice(0, 5),
      suggestions,
      suggestedDifficulty,
      overallAccuracy: Math.round(overallPct),
    },
  });
});

// ── Route: API Status ────────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  const nimKey = process.env.NVIDIA_API_KEY;
  res.json({
    keySet: !!(nimKey && nimKey !== 'PASTE_YOUR_KEY_HERE'),
    groqSet: false,
    model: NIM_FAST_MODEL,
    groqModel: null,
    pipeline: 'Fast Pipeline (NIM Only)',
  });
});

// ── Formula Explainer Routes ──────────────────────────────────────────

app.post('/api/formulas/list', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ success: false, error: 'Topic is required.' });

  try {
    const formulas = await formulaEngine.getFormulaList(topic);
    res.json({ success: true, formulas });
  } catch (err) {
    console.error('[FORMULA LIST ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/formulas/explain', async (req, res) => {
  const { formula, topic } = req.body;
  if (!formula) return res.status(400).json({ success: false, error: 'Formula is required.' });

  try {
    const explanation = await formulaEngine.getFormulaExplanation(formula, topic);
    res.json({ success: true, explanation });
  } catch (err) {
    console.error('[FORMULA EXPLAIN ERROR]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
// ── AI Study Chatbot ──────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, context } = req.body;
  
  // Create system prompt with context
  let sysPrompt = `You are an elite, highly-paid personal tutor preparing a student for JEE/NEET/CBSE exams.
CRITICAL TONE RULES:
- Talk like a real, friendly human. Use simple, plain English.
- NEVER sound like an academic textbook. BANNED phrases: "Consider a continuous signal", "Let us assume", "Example:".
- Keep answers short and intuitive. Use everyday analogies.
- Format responses with Markdown ($$ for block math, $ for inline math, double-escape backslashes).

SUPER-TUTOR BEHAVIORS:
1. MICRO-QUIZZING: Occasionally end an explanation with a natural, conversational 1-line question to test understanding (e.g., "So if I double the distance, what happens to the force?"). DO NOT prefix this with "Quiz:" or "Prove it:". Just ask it naturally.
2. STEP-BY-STEP MODE: If asked to solve a huge problem, DO NOT give the full solution at once. Ask: "Let's do this step-by-step. What are our given values?" and wait for their reply.
3. FRUSTRATION DETECTION: If the student uses ALL CAPS, says "I don't get it", or is frustrated, STOP doing heavy math. Shift to extreme encouragement and use a simple real-world analogy.
4. VAGUE QUESTIONS: If their question is vague, do not guess or lecture. Ask a friendly clarifying question (e.g., "Are you stuck on a specific formula here?").`;
  
  if (context) {
    sysPrompt += `\n\nStudent Context:\n`;
    if (context.topic) sysPrompt += `- Current Topic: ${context.topic}\n`;
    if (context.isTutorMode) sysPrompt += `- TUTOR MODE ACTIVE: Do NOT give direct answers. Instead, ask guiding questions using the Socratic method to help the student solve it themselves.\n`;
    if (context.profile) {
      sysPrompt += `- Score Profile: ${JSON.stringify(context.profile)}\n`;
      sysPrompt += `(Use this to provide personalized encouragement. If they ask how they are doing, analyze these scores to tell them their strengths and weaknesses.)\n`;
    }
  }

  const payloadMessages = [
    { role: 'system', content: sysPrompt },
    ...(messages || [])
  ];

  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || apiKey === 'PASTE_YOUR_KEY_HERE') {
    return res.status(500).json({ error: 'NVIDIA_API_KEY is not configured on the server.' });
  }

  const invokeUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Accept": "text/event-stream",
    "Content-Type": "application/json"
  };

  const payload = {
    "model": NIM_CHAT_MODEL,
    "messages": payloadMessages,
    "max_tokens": 1024,
    "temperature": 0.70,
    "top_p": 1.00,
    "stream": true
  };

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // Establish SSE connection immediately

    const response = await axios.post(invokeUrl, payload, {
      headers: headers,
      responseType: 'stream'
    });

    response.data.on('data', (chunk) => {
      res.write(chunk);
    });

    response.data.on('end', () => {
      res.end();
    });

    response.data.on('error', (err) => {
      console.error('[CHAT STREAM ERROR]', err.message);
      res.end();
    });

  } catch (error) {
    console.error('[CHAT API ERROR]', error.response?.data || error.message);
    res.write(`data: ${JSON.stringify({ error: "Failed to connect to AI study companion." })}\n\n`);
    res.end();
  }
});

// ── Start ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Infinity Practice is live!`);
  console.log(`   → http://localhost:${PORT}`);
  console.log(`   Fast Model  : ${NIM_FAST_MODEL} (MCQ/Short/Assertion)`);
  console.log(`   Heavy Model : ${NIM_HEAVY_MODEL} (Numerical)`);
  console.log(`   Chat Model  : ${NIM_CHAT_MODEL} (Study Chatbot)`);
  console.log(`   Cache       : 5-min TTL, up to 100 entries`);
  console.log(`   Batch       : Parallel (max 8 concurrent)\n`);
});
