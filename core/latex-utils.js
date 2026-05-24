/**
 * core/latex-utils.js
 * Specialized LaTeX cleaning, normalization, and syntax validation utility functions.
 * Shared across question generation and formula engine pipelines.
 */

// Common LaTeX keywords to check when fixing single-escaped backslashes
const LATEX_KEYWORDS = [
  'beta', 'begin', 'bar', 'box', 'boldsymbol', 'bullet', 'binom', 'breve', 'bot', 'backslash', 'bold',
  'frac', 'forall', 'flat', 'frame', 'foot',
  'nu', 'nabla', 'node', 'nearrow', 'neg', 'neq', 'norm', 'new', 'nwarrow', 'nocorr', 'not', 'newline',
  'rho', 'right', 'real', 'rangle', 'ref', 'root', 'ratio',
  'theta', 'times', 'text', 'tau', 'tan', 'to', 'triangle', 'trace', 'tilde', 'tfrac', 'top', 'therefore', 'tikz', 'tiny', 'tag',
  'under', 'uparrow', 'up', 'use', 'underbrace', 'underline', 'underset', 'uwave'
];

/**
 * Fixes single-escaped LaTeX backslashes before running JSON.parse.
 * Decides whether a backslash is part of a standard JSON escape or a LaTeX command.
 * @param {string} raw - The raw string response from LLM
 * @returns {string} - Correctly double-escaped JSON string
 */
function fixLatexJson(raw) {
  let clean = raw.trim();
  
  // Strip markdown code fences if present
  if (clean.startsWith('```')) {
    const lines = clean.split('\n');
    if (lines[0].startsWith('```')) {
      lines.shift();
    }
    if (lines[lines.length - 1].startsWith('```')) {
      lines.pop();
    }
    clean = lines.join('\n').trim();
  }

  let result = '';
  let inString = false;
  let i = 0;

  while (i < clean.length) {
    const char = clean[i];

    if (char === '"') {
      // Check if this double quote is escaped
      let backslashes = 0;
      let k = i - 1;
      while (k >= 0 && clean[k] === '\\') {
        backslashes++;
        k--;
      }
      if (backslashes % 2 === 0) {
        inString = !inString;
      }
      result += char;
      i++;
    } else if (char === '\\' && inString) {
      const nextChar = clean[i + 1];
      if (nextChar === '\\') {
        result += '\\\\';
        i += 2;
        continue;
      }
      
      // Extract word following the backslash to see if it's a LaTeX command
      let nextWord = '';
      let j = i + 1;
      while (j < clean.length && /[a-zA-Z]/.test(clean[j])) {
        nextWord += clean[j];
        j++;
      }

      const isLatexCommand = LATEX_KEYWORDS.some(kw => nextWord.startsWith(kw));
      
      // Check if this is a standard JSON escape sequence
      const isStandardEscape = ['"', '\\', '/', 'b', 'f', 'n', 'r', 't'].includes(nextChar) && !isLatexCommand;
      const isUnicodeEscape = nextChar === 'u' && /^[0-9a-fA-F]{4}$/.test(clean.slice(i + 2, i + 6));

      if (isStandardEscape || isUnicodeEscape) {
        // Keep as-is (single backslash escape)
        result += char;
      } else {
        // Double escape the backslash to make it safe for JSON.parse
        result += '\\\\';
      }
      i++;
    } else {
      result += char;
      i++;
    }
  }
  return result;
}

/**
 * Fixes matrix row separators inside alignment environments.
 * AI often outputs \\ for row separators but JSON.parse reduces \\ to \.
 * @param {string} str 
 * @returns {string}
 */
function fixMatrixSeparators(str) {
  if (typeof str !== 'string') return str;
  const envs = ['pmatrix', 'bmatrix', 'vmatrix', 'Vmatrix', 'matrix', 'cases', 'align', 'aligned', 'array', 'smallmatrix'];
  for (const env of envs) {
    const re = new RegExp(`\\\\begin\\{${env}\\}([\\s\\S]*?)\\\\end\\{${env}\\}`, 'g');
    str = str.replace(re, (m, body) => {
      // Replace single \ before whitespace/digit with \\ (row separator)
      let fb = body.replace(/(?<!\\)\\(?=\s)/g, '\\\\');
      // Fix AI accidentally generating \\[ instead of \\ for row breaks
      fb = fb.replace(/\\\\\[\s/g, '\\\\ ');
      return `\\begin{${env}}${fb}\\end{${env}}`;
    });
  }
  return str;
}

/**
 * Recursively fix LaTeX in all string values of an object.
 * Also handles KaTeX parse error for multiple underscores (subscript error).
 * @param {*} obj 
 * @returns {*}
 */
function deepFixLatex(obj) {
  if (typeof obj === 'string') {
    let str = fixMatrixSeparators(obj);
    // Fix KaTeX parse error for multiple underscores (subscript error)
    str = str.replace(/_{2,}/g, function (m, offset, fullStr) {
      if (fullStr.slice(Math.max(0, offset - 6), offset) === '\\text{') return m;
      return `\\text{${m}}`;
    });
    
    // Auto-correct double subscripts that cause KaTeX crash, e.g. x_i_j -> {x_i}_j
    str = autoCorrectDoubleSubscripts(str);
    
    return str;
  }
  if (Array.isArray(obj)) return obj.map(deepFixLatex);
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      obj[k] = deepFixLatex(obj[k]);
    }
  }
  return obj;
}

/**
 * Auto-corrects double subscripts (e.g. x_i_j -> {x_i}_j or a_b_c -> {a_b}_c) 
 * which are invalid in standard KaTeX/LaTeX.
 * @param {string} str 
 * @returns {string}
 */
function autoCorrectDoubleSubscripts(str) {
  if (typeof str !== 'string') return str;
  // Match patterns like x_i_j where both are simple alphanumeric/letters
  // Replace with {x_i}_j
  let prevStr = '';
  let currentStr = str;
  
  // Run recursively up to 3 times to handle nested occurrences safely
  let limit = 0;
  while (currentStr !== prevStr && limit < 3) {
    prevStr = currentStr;
    currentStr = currentStr.replace(/([a-zA-Z0-9])_([a-zA-Z0-9])_([a-zA-Z0-9])/g, '{$1_$2}_$3');
    limit++;
  }
  return currentStr;
}

/**
 * Ensures LaTeX formulas are correctly wrapped in display tags ($$ ... $$)
 * @param {string} latex 
 * @returns {string}
 */
function wrapInDisplayMath(latex) {
  let clean = String(latex || '').trim();
  if (clean.startsWith('$$') && clean.endsWith('$$')) {
    return clean;
  }
  if (clean.startsWith('$') && clean.endsWith('$')) {
    return `$$ ${clean.slice(1, -1).trim()} $$`;
  }
  return `$$ ${clean} $$`;
}

/**
 * Robust mathematical number extractor matching client/server parsing logic.
 * Standardizes power-of-10 and unicode subscripts to standard scientific e-notation.
 * @param {string} str 
 * @returns {number|null}
 */
function extractNumber(str) {
  let s = String(str || '')
    .replace(/,/g, '')                                            // remove thousand separators
    .replace(/\$[^$]*\$/g, m => m.replace(/[\$\\a-zA-Z{}]/g, '')) // strip LaTeX $...$
    .replace(/[\$\\{} ]/g, '');                                  // strip remaining LaTeX chars

  // Normalise ×10^n and unicode superscripts → e-notation
  s = s.replace(/[×x]\s*10\s*\^\s*([+-]?\d+)/gi, 'e$1');
  s = s.replace(/[×x]\s*10([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)/gi, (_, sup) => {
    const map = {
      '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4',
      '⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
      '⁻':'-','⁺':'+'
    };
    return 'e' + [...sup].map(c => map[c] || c).join('');
  });

  const match = s.match(/[-+]?\d*\.?\d+(?:[eE][+-]?\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Performs syntax validation for common KaTeX error-triggers.
 * Returns an object with { valid: boolean, error: string|null, corrected: string }
 * @param {string} latex 
 * @returns {object}
 */
function validateKatexSyntax(latex) {
  const str = String(latex || '').trim();
  
  // 1. Mismatched brackets check (curly braces)
  let openBraces = 0;
  let closeBraces = 0;
  for (let c of str) {
    if (c === '{') openBraces++;
    else if (c === '}') closeBraces++;
  }
  if (openBraces !== closeBraces) {
    return {
      valid: false,
      error: `Mismatched curly braces: found ${openBraces} open '{' and ${closeBraces} close '}'`,
      corrected: str + '}'.repeat(Math.max(0, openBraces - closeBraces)) // Simple healing attempt
    };
  }

  // 2. Mismatched environment environments check
  const beginMatches = [...str.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)].map(m => m[1]);
  const endMatches = [...str.matchAll(/\\end\{([a-zA-Z*]+)\}/g)].map(m => m[1]);
  if (beginMatches.length !== endMatches.length) {
    return {
      valid: false,
      error: `Mismatched alignment environments: \\begin counts (${beginMatches.length}) do not match \\end counts (${endMatches.length})`,
      corrected: str
    };
  }
  
  for (let idx = 0; idx < beginMatches.length; idx++) {
    const endEnv = endMatches[endMatches.length - 1 - idx]; // LIFO matching
    if (beginMatches[idx] !== endEnv && endEnv !== undefined) {
      return {
        valid: false,
        error: `Environment mismatch: \\begin{${beginMatches[idx]}} does not match corresponding \\end{${endEnv}}`,
        corrected: str
      };
    }
  }

  // 3. Check for multiple underscores/subscripts without grouping, which triggers KaTeX crash
  // e.g. a_b_c is invalid. Must be {a_b}_c or a_{b_c}
  const doubleSubscriptPattern = /[a-zA-Z0-9]+_[a-zA-Z0-9]+_[a-zA-Z0-9]+/;
  if (doubleSubscriptPattern.test(str)) {
    const corrected = autoCorrectDoubleSubscripts(str);
    return {
      valid: false,
      error: `Invalid double subscript found (e.g. a_b_c is forbidden in KaTeX). Must use curly braces for proper nesting.`,
      corrected: corrected
    };
  }

  return {
    valid: true,
    error: null,
    corrected: str
  };
}

module.exports = {
  fixLatexJson,
  fixMatrixSeparators,
  deepFixLatex,
  autoCorrectDoubleSubscripts,
  wrapInDisplayMath,
  extractNumber,
  validateKatexSyntax
};
