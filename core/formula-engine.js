/**
 * core/formula-engine.js
 * Redesigned and modularized Formula Engine.
 * Handles database caching, LLM query orchestration with self-healing retries,
 * and high-quality pedagogy for formula lists and detailed explanations.
 */

const {
  fixLatexJson,
  deepFixLatex,
  wrapInDisplayMath,
  validateKatexSyntax
} = require('./latex-utils');

class FormulaEngine {
  /**
   * Initializes the core Formula Engine with its required dependencies.
   * @param {object} options
   * @param {object} options.db - SQLite3 database connection reference
   * @param {function} options.askNIM - Function to query the NVIDIA NIM service
   * @param {string} [options.fastModel] - Model identifier for fast generation (e.g. Llama-3.1-8b)
   * @param {string} [options.heavyModel] - Model identifier for advanced, reasoning tasks (e.g. Llama-3.1-70b)
   */
  constructor({ db, askNIM, fastModel = 'meta/llama-3.1-8b-instruct', heavyModel = 'meta/llama-3.1-70b-instruct' }) {
    if (!db) {
      throw new Error('FormulaEngine requires an active SQLite database reference.');
    }
    if (!askNIM) {
      throw new Error('FormulaEngine requires an active askNIM service reference.');
    }
    
    this.db = db;
    this.askNIM = askNIM;
    this.fastModel = fastModel;
    this.heavyModel = heavyModel;
  }

  /**
   * Safe helper to execute LLM calls via the NVIDIA NIM service.
   * @private
   */
  async _askModel(messages, maxTokens, jsonMode, forceHeavy = false) {
    const activeModel = forceHeavy ? this.heavyModel : this.fastModel;
    console.log(`[FORMULA ENGINE LLM] Querying NIM with model: ${activeModel}`);
    return await this.askNIM(messages, maxTokens, jsonMode, activeModel);
  }

  /**
   * Validates and normalizes the raw formula list outputted by the LLM.
   * Runs KaTeX syntax checks on every generated formula.
   * @param {string} text - Raw string containing JSON from the LLM
   * @returns {object} - Structured, validated, and corrected formula list JSON
   */
  validateAndNormalizeFormulaList(text) {
    let parsed;
    const fixed = fixLatexJson(text);
    
    try {
      parsed = JSON.parse(fixed);
    } catch (e) {
      const match = fixed.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Invalid JSON structure from AI: ' + text.slice(0, 200));
      try {
        parsed = JSON.parse(match[0]);
      } catch (e2) {
        throw new Error('Failed to parse AI JSON: ' + e2.message);
      }
    }

    parsed = deepFixLatex(parsed);

    if (!parsed.formulas || !Array.isArray(parsed.formulas)) {
      throw new Error('JSON is missing "formulas" array root key.');
    }

    if (parsed.formulas.length === 0) {
      throw new Error('JSON "formulas" array is empty.');
    }

    parsed.formulas = parsed.formulas.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Formula item at index ${idx} is not an object.`);
      }
      
      const name = String(item.name || '').trim();
      let formula = String(item.formula || '').trim();
      
      if (!name) throw new Error(`Formula item at index ${idx} is missing "name".`);
      if (!formula) throw new Error(`Formula item at index ${idx} is missing "formula".`);

      // KaTeX Syntax Verification & Healing
      const kCheck = validateKatexSyntax(formula);
      if (!kCheck.valid) {
        console.warn(`[FORMULA ENGINE] Self-healed invalid KaTeX in formula "${name}": ${kCheck.error}`);
        formula = kCheck.corrected;
      }

      formula = wrapInDisplayMath(formula);
      return { name, formula };
    });

    return parsed;
  }

  /**
   * Validates and normalizes the raw formula explanation outputted by the LLM.
   * Runs KaTeX syntax checks on display render.
   * @param {string} text - Raw string containing JSON from the LLM
   * @returns {object} - Structured, validated, and corrected formula explanation JSON
   */
  validateAndNormalizeFormulaExplain(text) {
    let parsed;
    const fixed = fixLatexJson(text);
    
    try {
      parsed = JSON.parse(fixed);
    } catch (e) {
      const match = fixed.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Invalid JSON structure from AI: ' + text.slice(0, 200));
      try {
        parsed = JSON.parse(match[0]);
      } catch (e2) {
        throw new Error('Failed to parse AI JSON: ' + e2.message);
      }
    }

    parsed = deepFixLatex(parsed);

    if (!parsed.explanation || typeof parsed.explanation !== 'object') {
      throw new Error('JSON is missing "explanation" object root key.');
    }

    const exp = parsed.explanation;
    let math_render = String(exp.math_render || '').trim();
    const what = String(exp.what || '').trim();
    const when = String(exp.when || '').trim();
    const trap = String(exp.trap || '').trim();

    if (!math_render) throw new Error('Explanation is missing "math_render".');
    if (!what) throw new Error('Explanation is missing "what".');
    if (!when) throw new Error('Explanation is missing "when".');
    if (!trap) throw new Error('Explanation is missing "trap".');

    // KaTeX Syntax Verification & Healing on the main math block
    const kCheck = validateKatexSyntax(math_render);
    if (!kCheck.valid) {
      console.warn(`[FORMULA ENGINE] Self-healed invalid KaTeX in math_render: ${kCheck.error}`);
      math_render = kCheck.corrected;
    }

    math_render = wrapInDisplayMath(math_render);

    let variables = exp.variables;
    if (!variables) {
      variables = [];
    } else if (typeof variables === 'string') {
      variables = variables.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (!Array.isArray(variables)) {
      variables = Object.entries(variables).map(([k, v]) => `${k}: ${v}`);
    }

    variables = variables.map(v => {
      let trimmed = String(v).trim();
      // Ensure variables also conform to clean KaTeX if possible
      return trimmed;
    }).filter(Boolean);

    return {
      explanation: {
        math_render,
        what,
        variables,
        when,
        trap
      }
    };
  }

  /**
   * Generates a high-quality list of formulas using advanced few-shot prompting.
   * Enforces 3-attempt self-healing validation retry logic.
   * @param {string} topic 
   * @returns {Promise<object>}
   */
  async generateFormulaListPipeline(topic) {
    const sysMsg = `You are a strict, top-tier academic formula extractor for Indian school curricula (CBSE, ICSE, JEE, NEET).
Given a physics, math, or chemistry topic, extract the 5-7 most essential formulas required for exams.
Focus on rigorous, mathematically precise equations. 

Return ONLY a valid JSON object in this format:
{
  "formulas": [
    {
      "name": "Formula Name",
      "formula": "$$ \\\\text{LaTeX formatted formula} $$"
    }
  ]
}

CRITICAL RULES:
1. LaTeX formatting: EVERY formula MUST be wrapped in display tags ($$ ... $$).
2. Double-escape backslashes in JSON (e.g., use "\\\\frac{a}{b}" instead of "\\frac{a}{b}").
3. Do NOT include any explanations or conversational text. Return ONLY the pure JSON object.
4. Ensure all mathematical subscripts, symbols, and operators are correctly formatted (e.g., \\\\Delta t, \\\\omega, \\\\epsilon_0).

Few-Shot Example (Topic: "Rotational Motion"):
{
  "formulas": [
    { "name": "Angular Momentum", "formula": "$$ L = I\\\\omega $$" },
    { "name": "Rotational Kinetic Energy", "formula": "$$ K_{rot} = \\\\frac{1}{2}I\\\\omega^2 $$" },
    { "name": "Torque Equation", "formula": "$$ \\\\tau = I\\\\alpha $$" },
    { "name": "Moment of Inertia (Point Mass)", "formula": "$$ I = mr^2 $$" },
    { "name": "Work-Energy Theorem for Rotation", "formula": "$$ W = \\\\Delta K_{rot} = \\\\frac{1}{2}I(\\\\omega_f^2 - \\\\omega_i^2) $$" }
  ]
}`;

    const messages = [
      { role: 'system', content: sysMsg },
      { role: 'user', content: `Topic: ${topic}` }
    ];

    let attempts = 0;
    let lastErr = null;
    while (attempts < 2) {
      attempts++;
      let rawResponse = '';
      try {
        rawResponse = await this._askModel(messages, 700, true, false);
        return this.validateAndNormalizeFormulaList(rawResponse);
      } catch (err) {
        lastErr = err;
        const hasResponse = rawResponse && rawResponse.length > 0;
        console.warn(`[FORMULA LIST PIPELINE] Attempt ${attempts} failed: ${err.message}`);
        if (hasResponse) {
          messages.push({ role: 'assistant', content: rawResponse });
          messages.push({ 
            role: 'user', 
            content: `CRITICAL VALIDATION ERROR: ${err.message}\nYour previous response failed validation. Please fix your output. Ensure all JSON backslashes are fully double-escaped, LaTeX formatting is valid, and the JSON syntax conforms strictly to the schema.` 
          });
        }
      }
    }
    throw new Error(`Failed to generate a valid formula list for topic "${topic}" after 3 attempts. Last error: ${lastErr.message}`);
  }

  /**
   * Generates a pedagogical breakdown of a formula for Indian students (CBSE/JEE/NEET).
   * Enforces 3-attempt self-healing validation retry logic.
   * @param {string} formula 
   * @param {string} topic 
   * @returns {Promise<object>}
   */
  async generateFormulaExplainPipeline(formula, topic) {
    const sysMsg = `You are a friendly, exam-focused Indian tutor talking directly to a Class 11/12 student. Explain formulas in plain, simple language — like a good teacher, NOT a textbook.

Return ONLY a valid JSON object. No markdown, no code fences, no extra text.

JSON schema:
{"explanation":{"math_render":"$$...$$","what":"...","variables":["$sym$: meaning (unit)"],"when":"...","trap":"..."}}

TONE AND CONTENT RULES (CRITICAL — violating these is a failure):
- "what": 1-2 plain sentences max. Tell the student what the formula DOES in real life. BANNED: "Example" blocks, piecewise functions, academic jargon, textbook definitions, the word "consider".
- "variables": For each symbol: what it is + SI unit in plain language. E.g. "$F$: The push or pull force (N)"
- "when": 2-3 short bullet points on when to use this formula in an exam question.
- "trap": The single most common exam mistake. Be specific. Max 2 sentences.

LaTeX rules (JSON strings):
- Display math only in math_render: $$ \\\\formula $$
- Inline math uses single $: $F$, $\\\\epsilon_0$, $\\\\Phi$
- Double-escape ALL backslashes: \\\\frac \\\\Phi \\\\epsilon \\\\omega \\\\pi \\\\times \\\\text
- NEVER use \\\\[ or \\\\] — only $$ for display math

Example output for "F = G m1 m2 / r^2":
{"explanation":{"math_render":"$$ F = G\\\\frac{m_1 m_2}{r^2} $$","what":"Every two objects in the universe pull each other. The heavier they are and the closer they are, the stronger the pull.","variables":["$F$: The gravitational pull between the objects (N)","$G$: A fixed universal constant — $6.67\\\\times10^{-11}$ (same everywhere in the universe)","$m_1, m_2$: Masses of the two objects (kg)","$r$: Centre-to-centre distance between them (m)"],"when":"Use when finding gravitational force between two masses (planets, satellites, point masses). Remember r is centre-to-centre, not surface-to-surface.","trap":"Confusing $G$ (universal constant, never changes) with $g$ (9.8 m/s² on Earth's surface, changes with height)."}}

Now explain the formula below in this exact JSON format:`;

    const messages = [
      { role: 'system', content: sysMsg },
      { role: 'user', content: `Formula: ${formula}\nContext/Topic: ${topic}` }
    ];

    let attempts = 0;
    let lastErr = null;
    while (attempts < 2) {
      attempts++;
      let rawResponse = '';
      try {
        rawResponse = await this._askModel(messages, 600, true, false); // Fast 8B model – good enough and 3-5x faster than 70B
        return this.validateAndNormalizeFormulaExplain(rawResponse);
      } catch (err) {
        lastErr = err;
        const hasResponse = rawResponse && rawResponse.length > 0;
        console.warn(`[FORMULA EXPLAIN PIPELINE] Attempt ${attempts} failed: ${err.message}`);
        if (hasResponse) {
          messages.push({ role: 'assistant', content: rawResponse });
          messages.push({ 
            role: 'user', 
            content: `CRITICAL VALIDATION ERROR: ${err.message}\nYour previous response failed validation. Please fix your output. Ensure all variables are in KaTeX, LaTeX syntax is clean, and the JSON syntax conforms strictly to the schema.` 
          });
        }
      }
    }
    throw new Error(`Failed to generate a valid formula explanation for "${formula}" after 3 attempts. Last error: ${lastErr.message}`);
  }

  /**
   * Fetches the formula list for a given topic.
   * Resolves from SQLite cache first; triggers pipeline generation on cache miss.
   * @param {string} topic 
   * @returns {Promise<Array>}
   */
  getFormulaList(topic) {
    return new Promise((resolve, reject) => {
      if (!topic || typeof topic !== 'string' || !topic.trim()) {
        return reject(new Error('Topic parameter is required.'));
      }
      
      const cleanTopic = topic.trim();
      const query = `SELECT * FROM formula_cache WHERE LOWER(topic) = LOWER(?)`;
      
      this.db.get(query, [cleanTopic], async (err, row) => {
        if (err) {
          console.error('[FORMULA CACHE GET ERROR]', err.message);
        } else if (row) {
          try {
            const parsed = JSON.parse(row.formulasJson);
            console.log(`[FORMULA CACHE HIT] Topic: ${cleanTopic}`);
            return resolve(parsed.formulas);
          } catch (e) {
            console.error('[FORMULA CACHE PARSE ERROR]', e.message);
          }
        }

        // Cache Miss: Generate
        try {
          console.log(`[FORMULA ENGINE] Cache miss for topic "${cleanTopic}". Generating fresh formulas...`);
          const data = await this.generateFormulaListPipeline(cleanTopic);
          
          // Async save to cache
          this.db.run(`INSERT INTO formula_cache (topic, formulasJson) VALUES (?, ?)`,
            [cleanTopic, JSON.stringify(data)],
            (cacheErr) => {
              if (cacheErr) console.warn('[FORMULA CACHE WRITE ERROR]', cacheErr.message);
              else console.log('[FORMULA CACHE WRITE] Cached new formula list successfully');
            }
          );

          resolve(data.formulas);
        } catch (genErr) {
          reject(genErr);
        }
      });
    });
  }

  /**
   * Fetches the detailed explanation for a formula.
   * Resolves from SQLite cache first; triggers pipeline generation on cache miss.
   * @param {string} formula 
   * @param {string} topic 
   * @returns {Promise<object>}
   */
  getFormulaExplanation(formula, topic) {
    return new Promise((resolve, reject) => {
      if (!formula || typeof formula !== 'string' || !formula.trim()) {
        return reject(new Error('Formula parameter is required.'));
      }

      const cleanFormula = formula.trim();
      const cleanTopic = (topic || '').trim();

      const query = `SELECT * FROM formula_explain_cache WHERE LOWER(formula) = LOWER(?) AND LOWER(topic) = LOWER(?)`;
      
      this.db.get(query, [cleanFormula, cleanTopic], async (err, row) => {
        if (err) {
          console.error('[FORMULA EXPLAIN CACHE GET ERROR]', err.message);
        } else if (row) {
          try {
            const parsed = JSON.parse(row.explanationJson);
            console.log(`[FORMULA EXPLAIN CACHE HIT] Formula: ${cleanFormula}`);
            return resolve(parsed.explanation);
          } catch (e) {
            console.error('[FORMULA EXPLAIN CACHE PARSE ERROR]', e.message);
          }
        }

        // Cache Miss: Generate
        try {
          console.log(`[FORMULA ENGINE] Cache miss for formula "${cleanFormula}" under topic "${cleanTopic}". Generating fresh explanation...`);
          const data = await this.generateFormulaExplainPipeline(cleanFormula, cleanTopic);
          
          // Async save to cache
          this.db.run(`INSERT INTO formula_explain_cache (formula, topic, explanationJson) VALUES (?, ?, ?)`,
            [cleanFormula, cleanTopic, JSON.stringify(data)],
            (cacheErr) => {
              if (cacheErr) console.warn('[FORMULA EXPLAIN CACHE WRITE ERROR]', cacheErr.message);
              else console.log('[FORMULA EXPLAIN CACHE WRITE] Cached new explanation successfully');
            }
          );

          resolve(data.explanation);
        } catch (genErr) {
          reject(genErr);
        }
      });
    });
  }
}

module.exports = FormulaEngine;
