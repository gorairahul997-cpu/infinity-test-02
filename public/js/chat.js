// ── AI STUDY COMPANION LOGIC ─────────────────────────────────────────────

let isChatOpen = false;
let chatHistory = [];
let isWaitingForResponse = false;

document.addEventListener('DOMContentLoaded', () => {
  const fab = document.getElementById('chatbot-fab');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close-btn');
  const sendBtn = document.getElementById('chat-send-btn');
  const inputField = document.getElementById('chat-input-field');
  const chatBody = document.getElementById('chat-body');
  const clearBtn = document.getElementById('chat-clear-btn');
  const suggestionChips = document.querySelectorAll('.chat-suggestion-chip');
  const tutorToggle = document.getElementById('chat-tutor-mode');

  // Load chat history on init
  loadChatHistory();

  // Load tutor mode state
  if (tutorToggle) {
    const savedTutorMode = localStorage.getItem('infinity_chat_tutor_mode');
    if (savedTutorMode === 'true') tutorToggle.checked = true;
    tutorToggle.addEventListener('change', (e) => {
      localStorage.setItem('infinity_chat_tutor_mode', e.target.checked);
    });
  }

  // Proactive Toast Logic
  let toastTimeout;
  window.showChatHintToast = function(message, customPrompt) {
    const toast = document.getElementById('chat-toast');
    if (!toast) return;
    
    const textEl = toast.querySelector('.toast-text');
    if (textEl) textEl.textContent = message;
    
    toast.classList.add('visible');
    
    toast.onclick = () => {
      toast.classList.remove('visible');
      if (customPrompt) {
        inputField.value = customPrompt;
        inputField.style.height = 'auto';
        inputField.style.height = inputField.scrollHeight + 'px';
        sendBtn.disabled = false;
        if (!isChatOpen) toggleChat();
        sendChatMessage();
      }
    };
    
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
    }, 8000);
  };

  if (!fab || !panel) return;

  // Auto-resize textarea
  inputField.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
    if (this.value.trim() !== '') {
      sendBtn.disabled = false;
    } else {
      sendBtn.disabled = true;
    }
  });

  // Handle Enter key (Shift+Enter for new line)
  inputField.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendChatMessage();
    }
  });

  // Toggle Chat
  fab.addEventListener('click', toggleChat);
  closeBtn.addEventListener('click', toggleChat);
  sendBtn.addEventListener('click', sendChatMessage);

  // Clear Chat
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('Clear the conversation?')) {
        chatHistory = [];
        saveChatHistory();
        chatBody.innerHTML = '';
        const suggestions = document.getElementById('chat-suggestions');
        if (suggestions) suggestions.style.display = 'flex';
        appendMessage('ai', "Chat cleared! What's next on our study list?");
      }
    });
  }

  // Suggestion Chips
  suggestionChips.forEach(chip => {
    chip.addEventListener('click', () => {
      inputField.value = chip.textContent;
      sendBtn.disabled = false;
      inputField.style.height = 'auto';
      inputField.style.height = inputField.scrollHeight + 'px';
      inputField.focus();
      // Optionally auto-send:
      // sendChatMessage();
    });
  });

  function toggleChat() {
    isChatOpen = !isChatOpen;
    if (isChatOpen) {
      panel.classList.add('open');
      inputField.focus();
      
      // Send a welcome message if empty
      if (chatHistory.length === 0) {
        appendMessage('ai', "Hi there! 👋 I'm your AI study buddy. Do you need a hint on this topic or want to review your recent scores?");
      }
    } else {
      panel.classList.remove('open');
    }
  }

  async function sendChatMessage() {
    if (isWaitingForResponse) return;
    
    const text = inputField.value.trim();
    if (!text) return;

    // Hide suggestions once the user starts chatting
    const suggestions = document.getElementById('chat-suggestions');
    if (suggestions) suggestions.style.display = 'none';

    // Reset input
    inputField.value = '';
    inputField.style.height = 'auto';
    sendBtn.disabled = true;

    // Append User Message
    appendMessage('user', text);
    chatHistory.push({ role: 'user', content: text });
    saveChatHistory();

    // Show typing indicator
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.id = 'chat-typing';
    typingIndicator.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    chatBody.appendChild(typingIndicator);
    scrollToBottom();

    isWaitingForResponse = true;

    try {
      // Build context
      const tutorModeToggle = document.getElementById('chat-tutor-mode');
      const isTutorActive = tutorModeToggle ? tutorModeToggle.checked : false;
      const context = {
        topic: window.state ? window.state.topic : (document.getElementById('topic-select')?.value || 'General'),
        profile: window.academicProfile || null,
        isTutorMode: isTutorActive
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory, context })
      });

      // Remove typing indicator
      const ti = document.getElementById('chat-typing');
      if (ti) ti.remove();

      if (!response.ok) throw new Error('Network response was not ok');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let aiFullResponse = '';

      // Create AI message container
      const msgDiv = document.createElement('div');
      msgDiv.className = 'message ai message-markdown';
      
      const copyBtn = document.createElement('button');
      copyBtn.className = 'chat-copy-btn';
      copyBtn.title = 'Copy response';
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(aiFullResponse);
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        }, 2000);
      };
      
      const contentDiv = document.createElement('div');
      contentDiv.className = 'message-content';
      
      msgDiv.appendChild(copyBtn);
      msgDiv.appendChild(contentDiv);
      chatBody.appendChild(msgDiv);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.replace('data: ', '').trim();
            if (dataStr === '[DONE]') continue;
            
            try {
              const dataObj = JSON.parse(dataStr);
              if (dataObj.error) {
                aiFullResponse = "Sorry, I encountered an error. Please try again.";
                break;
              }
              const content = dataObj.choices[0]?.delta?.content || '';
              aiFullResponse += content;
              
              // Simple markdown parsing for the live stream
              if (window.marked) {
                contentDiv.innerHTML = marked.parse(aiFullResponse);
              } else {
                contentDiv.innerHTML = aiFullResponse.replace(/\n/g, '<br>');
              }
              
              if (window.renderMathInElement) {
                renderMathInElement(contentDiv, {
                  delimiters: [
                    {left: '$$', right: '$$', display: true},
                    {left: '$', right: '$', display: false},
                    {left: '\\(', right: '\\)', display: false},
                    {left: '\\[', right: '\\]', display: true}
                  ],
                  throwOnError: false
                });
              }
              scrollToBottom();
            } catch (e) {
              // Ignore partial JSON chunks
            }
          }
        }
      }

      chatHistory.push({ role: 'assistant', content: aiFullResponse });
      saveChatHistory();

    } catch (error) {
      console.error('Chat API Error:', error);
      const ti = document.getElementById('chat-typing');
      if (ti) ti.remove();
      appendMessage('ai', "Oops, I'm having trouble connecting to my brain right now. 🧠⚡ Please try again later!");
    } finally {
      isWaitingForResponse = false;
      inputField.focus();
    }
  }

  function appendMessage(role, text, animate = true) {
    const msgDiv = document.createElement('div');
    msgDiv.className = `message ${role} message-markdown`;
    if (!animate) msgDiv.style.animation = 'none';
    
    // Create copy button for AI messages
    if (role === 'ai') {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'chat-copy-btn';
      copyBtn.title = 'Copy response';
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(text);
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
        setTimeout(() => {
          copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
        }, 2000);
      };
      msgDiv.appendChild(copyBtn);
    }
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    msgDiv.appendChild(contentDiv);
    
    if (window.marked && role === 'ai') {
      contentDiv.innerHTML = marked.parse(text);
      if (window.renderMathInElement) {
        renderMathInElement(contentDiv, {
          delimiters: [
            {left: '$$', right: '$$', display: true},
            {left: '$', right: '$', display: false},
            {left: '\\(', right: '\\)', display: false},
            {left: '\\[', right: '\\]', display: true}
          ],
          throwOnError: false
        });
      }
    } else {
      contentDiv.textContent = text;
    }
    
    chatBody.appendChild(msgDiv);
    scrollToBottom();
  }

  function scrollToBottom() {
    chatBody.scrollTop = chatBody.scrollHeight;
  }

  function saveChatHistory() {
    try {
      localStorage.setItem('infinity_chat_history', JSON.stringify(chatHistory));
    } catch (e) {
      console.error('Failed to save chat history', e);
    }
  }

  function loadChatHistory() {
    try {
      const saved = localStorage.getItem('infinity_chat_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          chatHistory = parsed;
          chatHistory.forEach(msg => {
            // Re-render previous messages
            const displayRole = msg.role === 'assistant' || msg.role === 'ai' ? 'ai' : 'user';
            appendMessage(displayRole, msg.content, false);
          });
          // Hide suggestions if we have history
          const suggestions = document.getElementById('chat-suggestions');
          if (suggestions) suggestions.style.display = 'none';
          
          scrollToBottom();
        }
      }
    } catch (e) {
      console.error('Failed to load chat history', e);
    }
  }
});
