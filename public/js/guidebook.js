/* ═══════════════════════════════════════════════
   INFINITY PRACTICE — Guidebook Logic
   Manages tab navigation, accordions, and search highlighting
   ═══════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initGuidebook();
});

function initGuidebook() {
  const navItems = document.querySelectorAll('.guidebook-nav-item');
  const chapters = document.querySelectorAll('.guidebook-chapter');
  const searchInput = document.getElementById('guidebook-search-input');
  const searchClearBtn = document.getElementById('guidebook-search-clear');
  const searchResultsInfo = document.getElementById('guidebook-search-results');

  // Store original HTML of text containers for search highlight resetting
  const textContainers = [];
  document.querySelectorAll('.guide-card-title, .guide-card-desc, .guide-accordion-header, .guide-accordion-content, .guide-step-title, .guide-step-desc').forEach(el => {
    textContainers.push({
      element: el,
      originalHTML: el.innerHTML,
      originalText: el.textContent
    });
  });

  // ── Tab Switching ──
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetChapterId = item.dataset.chapter;
      
      // Update sidebar nav active classes
      navItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      // If we are searching, clear search first so tab switching feels natural
      if (searchInput && searchInput.value.trim() !== '') {
        searchInput.value = '';
        clearSearch();
      }

      // Show target chapter, hide others
      chapters.forEach(chap => {
        if (chap.id === `chap-${targetChapterId}`) {
          chap.classList.add('active');
        } else {
          chap.classList.remove('active');
        }
      });

      // Scroll guidebook content pane to top
      const contentPane = document.querySelector('.guidebook-content');
      if (contentPane) contentPane.scrollTop = 0;
    });
  });

  // ── Accordion Collapsibles ──
  document.querySelectorAll('.guide-accordion-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on interactive elements inside header if any
      const accordion = header.closest('.guide-accordion');
      if (accordion) {
        accordion.classList.toggle('open');
      }
    });
  });

  // ── Search & Filter Logic ──
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (query.length > 1) {
        if (searchClearBtn) searchClearBtn.style.display = 'block';
        performSearch(query);
      } else {
        if (searchClearBtn) searchClearBtn.style.display = 'none';
        clearSearch();
      }
    });
  }

  if (searchClearBtn) {
    searchClearBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      searchClearBtn.style.display = 'none';
      clearSearch();
    });
  }

  // Perform Search across all cards
  function performSearch(query) {
    const cleanQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); // escape regex
    const regex = new RegExp(`(${cleanQuery})`, 'gi');
    let matchCount = 0;

    // Show all chapters during search to find matches everywhere
    chapters.forEach(chap => {
      chap.style.display = 'block';
    });

    // Reset previous highlights before applying new ones
    resetHighlights();

    // Check each card and accordion
    const cards = document.querySelectorAll('.guide-card, .guide-accordion');
    cards.forEach(card => {
      const textToSearch = card.textContent || '';
      const hasMatch = regex.test(textToSearch);

      if (hasMatch) {
        card.style.display = 'block';
        matchCount++;
        
        // If it's an accordion and has a match inside, open it so users can see the highlighted search result
        if (card.classList.contains('guide-accordion')) {
          card.classList.add('open');
        }

        // Highlight matching terms within this card's text containers
        highlightInCard(card, regex);
      } else {
        card.style.display = 'none';
        if (card.classList.contains('guide-accordion')) {
          card.classList.remove('open');
        }
      }
    });

    // Update status badge
    if (searchResultsInfo) {
      searchResultsInfo.textContent = `Found ${matchCount} match${matchCount === 1 ? '' : 'es'}`;
      searchResultsInfo.classList.add('active');
    }
  }

  // Clear Search and restore tab view
  function clearSearch() {
    resetHighlights();
    
    // Hide all chapters first
    chapters.forEach(chap => {
      chap.style.display = ''; // Restore stylesheet display behavior
    });

    // Restore cards display
    const cards = document.querySelectorAll('.guide-card, .guide-accordion');
    cards.forEach(card => {
      card.style.display = '';
      if (card.classList.contains('guide-accordion')) {
        card.classList.remove('open');
      }
    });

    // Hide search count
    if (searchResultsInfo) {
      searchResultsInfo.classList.remove('active');
    }

    // Reactivate the currently selected tab chapter
    const activeNavItem = document.querySelector('.guidebook-nav-item.active');
    if (activeNavItem) {
      const activeChapterId = activeNavItem.dataset.chapter;
      chapters.forEach(chap => {
        if (chap.id === `chap-${activeChapterId}`) {
          chap.classList.add('active');
        } else {
          chap.classList.remove('active');
        }
      });
    }
  }

  // Helper: Highlight matching query terms
  function highlightInCard(card, regex) {
    textContainers.forEach(item => {
      if (card.contains(item.element)) {
        const text = item.originalHTML;
        // Run regex replacement on text content (excluding HTML tag structures)
        // A simple text replacement is safe here because we operate on inner text contents
        // We use a temp element to parse and replace only text nodes to prevent destroying HTML tags.
        highlightTextNodes(item.element, regex);
      }
    });
  }

  // Recursively highlight only text nodes to avoid breaking nested tags
  function highlightTextNodes(node, regex) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue;
      if (regex.test(text)) {
        const span = document.createElement('span');
        span.innerHTML = text.replace(regex, '<mark class="guide-highlight-match">$1</mark>');
        node.parentNode.replaceChild(span, node);
      }
    } else if (node.nodeType === Node.ELEMENT_NODE && node.nodeName !== 'MARK') {
      // Don't highlight inside already highlighted nodes
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        highlightTextNodes(node.childNodes[i], regex);
      }
    }
  }

  // Helper: Reset highlights back to original HTML
  function resetHighlights() {
    textContainers.forEach(item => {
      item.element.innerHTML = item.originalHTML;
    });
  }
}
