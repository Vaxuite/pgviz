// 1. Setup Zoom and Pan
const svg = d3.select("svg");
const inner = d3.select("#svg-group");
const zoom = d3.zoom().on("zoom", () => {
    inner.attr("transform", d3.event.transform);
});
const explain = "EXPLAIN (ANALYZE, COSTS, VERBOSE, BUFFERS, FORMAT JSON) ";
const setup = `\pset pager off
    \pset format unaligned
    \pset expanded off
    \pset columns 0`;
svg.call(zoom);

// Copy to clipboard function
async function copyToClipboard(text, event) {
    const copyBtn = event ? event.target : document.getElementById('copyBtn');
    const originalText = copyBtn.textContent;
    
    try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied');
        }, 2000);
    } catch (err) {
        // Fallback for older browsers
        const textarea = document.getElementById('inputData');
        textarea.select();
        document.execCommand('copy');
        copyBtn.textContent = 'Copied!';
        copyBtn.classList.add('copied');
        
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.classList.remove('copied');
        }, 2000);
    }
}

// Saved Plans Management
const STORAGE_KEY = 'pgviz_saved_plans';
const GEMINI_API_KEY_STORAGE = 'pgviz_gemini_api_key';
const GEMINI_MODEL_STORAGE = 'pgviz_gemini_model';

// Gemini API Integration
function saveApiKey() {
    const apiKey = document.getElementById('gemini-api-key').value.trim();
    if (apiKey) {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, apiKey);
        updateApiKeyUI();
        document.getElementById('gemini-api-key').value = '';
    } else {
        alert('Please enter a valid API key');
    }
}

function resetApiKey() {
    localStorage.removeItem(GEMINI_API_KEY_STORAGE);
    updateApiKeyUI();
}

function getApiKey() {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
}

function updateApiKeyUI() {
    const apiKey = getApiKey();
    const inputSection = document.getElementById('gemini-api-key-input-section');
    const resetSection = document.getElementById('gemini-api-key-reset-section');
    const modelSelector = document.getElementById('gemini-model-selector');
    
    if (apiKey) {
        inputSection.style.display = 'none';
        resetSection.style.display = 'block';
        modelSelector.style.display = 'block';
        // Setup model dropdown when API key is available
        setupGeminiModelDropdown();
    } else {
        inputSection.style.display = 'flex';
        resetSection.style.display = 'none';
        modelSelector.style.display = 'none';
    }
}

function setupGeminiModelDropdown() {
    const dropdown = document.getElementById('gemini-model-dropdown');
    
    // Clear and add the two model options
    dropdown.innerHTML = '';
    
    const flashOption = document.createElement('option');
    flashOption.value = 'models/gemini-3-flash-preview';
    flashOption.textContent = 'Flash';
    dropdown.appendChild(flashOption);
    
    const proOption = document.createElement('option');
    proOption.value = 'models/gemini-3-pro-preview';
    proOption.textContent = 'Pro';
    dropdown.appendChild(proOption);
    
    // Load saved model or use default (Flash)
    const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE);
    if (savedModel && (savedModel === 'models/gemini-3-flash-preview' || savedModel === 'models/gemini-3-pro-preview')) {
        dropdown.value = savedModel;
    } else {
        // Default to Flash
        dropdown.value = 'models/gemini-3-flash-preview';
        localStorage.setItem(GEMINI_MODEL_STORAGE, 'models/gemini-3-flash-preview');
    }
    
    // Add change listener
    dropdown.onchange = function() {
        localStorage.setItem(GEMINI_MODEL_STORAGE, this.value);
    };
}

function getSelectedModel() {
    const savedModel = localStorage.getItem(GEMINI_MODEL_STORAGE);
    if (savedModel && (savedModel === 'models/gemini-3-flash-preview' || savedModel === 'models/gemini-3-pro-preview')) {
        return savedModel;
    }
    // Default fallback to Flash
    return 'models/gemini-3-flash-preview';
}

// Store current plan ID for updating with Gemini response
let currentPlanId = null;

// Store conversation history and plan context
let conversationHistory = [];
let currentPlanData = null;
let currentQuery = '';

function generateAIAnalysis() {
    const input = document.getElementById('inputData').value;
    if (!input.trim()) {
        alert("Please visualize a plan first.");
        return;
    }
    
    let originalData;
    try {
        originalData = JSON.parse(input);
    } catch (e) {
        alert("Invalid JSON format. Please visualize a valid plan first.");
        return;
    }
    
    // Find the current plan ID if it exists in saved plans
    const plans = getSavedPlans();
    const inputString = typeof originalData === 'string' ? originalData : JSON.stringify(originalData);
    const matchingPlan = plans.find(p => {
        const planString = typeof p.data === 'string' ? p.data : JSON.stringify(p.data);
        return planString === inputString;
    });
    currentPlanId = matchingPlan ? matchingPlan.id : null;
    
    const query = document.getElementById('queryInput').value.trim();
    
    // Initialize chat with plan - restore conversation history if plan exists
    const savedHistory = matchingPlan && matchingPlan.conversationHistory ? matchingPlan.conversationHistory : null;
    initializeChat(originalData, query, savedHistory);
    
    // Only send initial analysis if there's no existing conversation
    if (!savedHistory || savedHistory.length === 0) {
        const initialMessage = "Analyze this PostgreSQL query execution plan and provide insights. Include: 1) A brief summary of what this query does, 2) Performance bottlenecks or concerns, 3) Suggestions for optimization, 4) Key metrics to watch. Format your response in a clear, readable way with sections.";
        sendChatMessage(initialMessage);
    }
}

function initializeChat(planData, query = '', savedConversationHistory = null) {
    // Set plan data and query
    currentPlanData = planData;
    currentQuery = query;
    
    // Restore conversation history if provided, otherwise reset
    if (savedConversationHistory && Array.isArray(savedConversationHistory) && savedConversationHistory.length > 0) {
        conversationHistory = savedConversationHistory;
    } else {
        conversationHistory = [];
    }
    
    // Clear chat messages
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.innerHTML = '';
    
    // Restore messages from conversation history
    if (conversationHistory.length > 0) {
        conversationHistory.forEach(msg => {
            const role = msg.role === 'user' ? 'user' : 'assistant';
            const text = msg.parts[0].text;
            addMessageToChat(role, text, false); // false = don't scroll yet
        });
        // Scroll to bottom after all messages are added
        setTimeout(() => {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, 100);
    }
    
    // Hide empty state if we have messages
    const emptyState = document.getElementById('chat-empty-state');
    if (emptyState) {
        emptyState.style.display = conversationHistory.length > 0 ? 'none' : 'block';
    }
}

function sendChatMessage(messageText = null) {
    const chatInput = document.getElementById('chat-input');
    const message = messageText || chatInput.value.trim();
    
    if (!message) {
        return;
    }
    
    // Check if we have a plan loaded
    if (!currentPlanData) {
        const input = document.getElementById('inputData').value;
        if (!input.trim()) {
            alert("Please visualize a plan first.");
            return;
        }
        
        let originalData;
        try {
            originalData = JSON.parse(input);
        } catch (e) {
            alert("Invalid JSON format. Please visualize a valid plan first.");
            return;
        }
        
        const query = document.getElementById('queryInput').value.trim();
        initializeChat(originalData, query);
    }
    
    // Clear input if this was a user message
    if (!messageText) {
        chatInput.value = '';
    }
    
    // Hide empty state
    const emptyState = document.getElementById('chat-empty-state');
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    // Add user message to chat
    addMessageToChat('user', message);
    
    // Add to conversation history
    conversationHistory.push({
        role: 'user',
        parts: [{ text: message }]
    });
    
    // Save conversation history immediately after user message
    if (currentPlanId) {
        updatePlanConversationHistory(currentPlanId);
    }
    
    // Send to Gemini
    sendMessageToGemini();
}

function addMessageToChat(role, text, scroll = true) {
    const chatMessages = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message chat-message-${role}`;
    
    if (role === 'user') {
        messageDiv.innerHTML = `
            <div class="chat-message-content">${escapeHtml(text)}</div>
        `;
    } else {
        // AI response - format it
        messageDiv.innerHTML = `
            <div class="chat-message-content">${formatGeminiResponse(text)}</div>
        `;
    }
    
    chatMessages.appendChild(messageDiv);
    
    // Scroll to bottom if requested
    if (scroll) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function sendMessageToGemini() {
    const apiKey = getApiKey();
    if (!apiKey) {
        addMessageToChat('assistant', 'Please enter and save your Gemini API key to get AI analysis.');
        return;
    }
    
    // Show loading indicator
    const chatMessages = document.getElementById('chat-messages');
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'chat-message chat-message-assistant chat-message-loading';
    loadingDiv.id = 'chat-loading-indicator';
    loadingDiv.innerHTML = '<div class="chat-message-content">Thinking...</div>';
    chatMessages.appendChild(loadingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    try {
        // Build the conversation context
        const planJson = JSON.stringify(currentPlanData, null, 2);
        
        // Build contents array - always include plan context in the first message
        const contents = [];
        
        // First message always includes the full plan context
        if (conversationHistory.length === 1) {
            // This is the first message, include full plan context
            let systemPrompt = `You are analyzing a PostgreSQL query execution plan. Here is the context:\n\n`;
            
            if (currentQuery && currentQuery.trim().length > 0) {
                systemPrompt += `SQL Query:\n\`\`\`sql\n${currentQuery}\n\`\`\`\n\n`;
            }
            
            systemPrompt += `Query Execution Plan (JSON):\n\`\`\`json\n${planJson}\n\`\`\`\n\n`;
            systemPrompt += `Please analyze this plan and respond to the user's questions. Always keep the plan context in mind when answering.`;
            
            // Combine system prompt with user's first message
            const userMessage = conversationHistory[0].parts[0].text;
            contents.push({
                parts: [{ text: systemPrompt + '\n\nUser question: ' + userMessage }]
            });
        } else {
            // For subsequent messages, we need to rebuild the context
            // Include the plan context again to ensure it's available
            let contextPrompt = `Context: We're analyzing a PostgreSQL query execution plan.\n\n`;
            
            if (currentQuery && currentQuery.trim().length > 0) {
                contextPrompt += `SQL Query:\n\`\`\`sql\n${currentQuery}\n\`\`\`\n\n`;
            }
            
            contextPrompt += `Query Execution Plan (JSON):\n\`\`\`json\n${planJson}\n\`\`\`\n\n`;
            contextPrompt += `Previous conversation:\n`;
            
            // Add previous conversation history (last few messages)
            const recentHistory = conversationHistory.slice(-6); // Last 6 messages (3 exchanges)
            for (const msg of recentHistory) {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                contextPrompt += `${role}: ${msg.parts[0].text}\n\n`;
            }
            
            contextPrompt += `\nNow respond to the user's latest question.`;
            
            // Get the latest user message
            const latestUserMessage = conversationHistory[conversationHistory.length - 1].parts[0].text;
            contents.push({
                parts: [{ text: contextPrompt + '\n\nUser: ' + latestUserMessage }]
            });
        }
        
        const selectedModel = getSelectedModel();
        
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${selectedModel}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: contents
                })
            }
        );
        
        // Remove loading indicator
        const loadingIndicator = document.getElementById('chat-loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Failed to get response from Gemini API');
        }
        
        const data = await response.json();
        const geminiText = data.candidates[0].content.parts[0].text;
        
        // Add AI response to chat
        addMessageToChat('assistant', geminiText);
        
        // Add to conversation history
        conversationHistory.push({
            role: 'model',
            parts: [{ text: geminiText }]
        });
        
        // Save the full conversation history to the current plan if it exists
        if (currentPlanId) {
            updatePlanConversationHistory(currentPlanId);
        }
    } catch (error) {
        console.error('Gemini API error:', error);
        
        // Remove loading indicator
        const loadingIndicator = document.getElementById('chat-loading-indicator');
        if (loadingIndicator) {
            loadingIndicator.remove();
        }
        
        addMessageToChat('assistant', `Error: ${error.message}\n\nMake sure your API key is valid and you have access to the Gemini API.`);
    }
}


function extractPlanSummary(planData) {
    // Extract key information from the plan for analysis
    let summary = '';
    
    function traverse(node, depth = 0) {
        const indent = '  '.repeat(depth);
        const nodeType = node['Node Type'] || 'Unknown';
        const totalTime = node['Actual Total Time'] || 0;
        const rows = node['Actual Rows'] || 0;
        const loops = node['Actual Loops'] || 1;
        const cost = node['Total Cost'] || 0;
        
        summary += `${indent}- ${nodeType}: ${totalTime.toFixed(2)}ms, ${rows} rows (${loops} loops), cost: ${cost.toFixed(2)}\n`;
        
        if (node['Relation Name']) {
            summary += `${indent}  Table: ${node['Relation Name']}\n`;
        }
        if (node['Filter']) {
            summary += `${indent}  Filter: ${node['Filter']}\n`;
        }
        if (node['Index Cond']) {
            summary += `${indent}  Index Condition: ${node['Index Cond']}\n`;
        }
        if (node['Index Name']) {
            summary += `${indent}  Index: ${node['Index Name']}\n`;
        }
        
        if (node.Plans) {
            node.Plans.forEach(child => traverse(child, depth + 1));
        }
    }
    
    // Handle different plan formats
    let rootPlan = planData;
    if (Array.isArray(planData) && planData[0]?.Plan) {
        rootPlan = planData[0].Plan;
    } else if (planData.Plan) {
        rootPlan = planData.Plan;
    }
    
    traverse(rootPlan);

    console.log(summary);
    
    return summary;
}

function formatGeminiResponse(text) {
    // Split text into lines for better processing
    const lines = text.split('\n');
    const processedLines = [];
    let inList = false;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // Check if this is a list item (bullet or numbered)
        const isBullet = /^[\*\-\u2022•]\s+/.test(trimmed);
        const isNumbered = /^\d+\.\s+/.test(trimmed);
        const isListItem = isBullet || isNumbered;
        
        if (isListItem) {
            // Extract content after bullet/number
            let content = trimmed.replace(/^[\*\-\u2022•]\s+/, '').replace(/^\d+\.\s+/, '');
            
            // Process bold and code within list items
            content = content
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/`([^`]+)`/g, '<code>$1</code>');
            
            if (!inList) {
                // Start a new list
                processedLines.push('<ul>');
                inList = true;
            }
            processedLines.push(`<li>${content}</li>`);
        } else {
            // Not a list item
            if (inList) {
                // Close the list
                processedLines.push('</ul>');
                inList = false;
            }
            
            // Process headers
            if (/^#### /.test(trimmed)) {
                let headerText = trimmed.replace(/^#### /, '');
                // Process bold and code in headers too
                headerText = headerText
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>');
                processedLines.push(`<h5 style="font-size: 1em; font-weight: 600; color: var(--accent); margin-top: 16px; margin-bottom: 8px;">${headerText}</h5>`);
            } else if (/^### /.test(trimmed)) {
                let headerText = trimmed.replace(/^### /, '');
                headerText = headerText
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>');
                processedLines.push(`<h4>${headerText}</h4>`);
            } else if (/^## /.test(trimmed)) {
                let headerText = trimmed.replace(/^## /, '');
                headerText = headerText
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>');
                processedLines.push(`<h3>${headerText}</h3>`);
            } else if (/^# /.test(trimmed)) {
                let headerText = trimmed.replace(/^# /, '');
                headerText = headerText
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>');
                processedLines.push(`<h3>${headerText}</h3>`);
            } else if (trimmed === '---') {
                // Skip horizontal rules
                processedLines.push('');
            } else if (trimmed === '') {
                // Skip empty lines completely - don't add anything
                continue;
            } else {
                // Regular text - process bold and code (use non-greedy and handle multiple occurrences)
                let processedLine = trimmed
                    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
                    .replace(/`([^`]+)`/g, '<code>$1</code>');
                processedLines.push(processedLine);
            }
        }
    }
    
    // Close any open list
    if (inList) {
        processedLines.push('</ul>');
    }
    
    // Join lines and handle code blocks
    let html = processedLines.join('\n');
    
    // Process code blocks (multiline) - do this before other processing
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    
    // Remove excessive blank lines (3+ consecutive newlines become 2)
    html = html.replace(/\n{3,}/g, '\n\n');
    
    // Convert double line breaks to paragraph breaks
    html = html.replace(/\n\n/g, '</p><p>');
    
    // Convert remaining single line breaks to <br>, but avoid breaking paragraph structure
    // Split by paragraph tags first to avoid replacing newlines inside them
    const parts = html.split(/(<\/p><p>)/);
    let result = '';
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === '</p><p>') {
            result += parts[i];
        } else {
            result += parts[i].replace(/\n/g, '');
        }
    }
    html = result;
    
    // Clean up any empty paragraphs or paragraphs with only whitespace/br
    html = html.replace(/<p>\s*<\/p>/g, '');
    html = html.replace(/<p><br>\s*<\/p>/gi, '');
    html = html.replace(/<p>\s*<br>\s*<\/p>/gi, '');
    
    // Remove leading/trailing empty paragraphs
    html = html.replace(/^(<p>\s*<\/p>)+/, '');
    html = html.replace(/(<p>\s*<\/p>)+$/, '');
    
    // Ensure we have at least one paragraph wrapper
    if (!html.trim().startsWith('<p>')) {
        html = '<p>' + html;
    }
    if (!html.trim().endsWith('</p>')) {
        html = html + '</p>';
    }
    
    return html;
}

// Tab switching functionality
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            // Update active tab button
            tabButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update active tab content
            tabContents.forEach(content => content.classList.remove('active'));
            if (targetTab === 'saved-plans') {
                document.getElementById('saved-plans-tab').classList.add('active');
            } else if (targetTab === 'ai-analysis') {
                document.getElementById('ai-analysis-tab').classList.add('active');
                
                // If we have a plan loaded but chat isn't initialized, initialize it
                const input = document.getElementById('inputData').value;
                if (input.trim() && !currentPlanData) {
                    try {
                        const originalData = JSON.parse(input);
                        const query = document.getElementById('queryInput').value.trim();
                        initializeChat(originalData, query);
                    } catch (e) {
                        // Invalid JSON, ignore
                    }
                }
                
                // Focus chat input after a short delay
                setTimeout(() => {
                    const chatInput = document.getElementById('chat-input');
                    if (chatInput) {
                        chatInput.focus();
                    }
                }, 100);
            }
        });
    });
}

// Resizable left sidebar
const LEFT_SIDEBAR_WIDTH_STORAGE = 'pgviz_left_sidebar_width';

function initLeftSidebarResize() {
    const sidebar = document.getElementById('left-sidebar');
    const resizeHandle = document.getElementById('left-sidebar-resize-handle');
    
    // Load saved width
    const savedWidth = localStorage.getItem(LEFT_SIDEBAR_WIDTH_STORAGE);
    if (savedWidth) {
        sidebar.style.width = savedWidth + 'px';
    }
    
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(window.getComputedStyle(sidebar).width, 10);
        sidebar.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaX = e.clientX - startX;
        const newWidth = Math.max(200, Math.min(1000, startWidth + deltaX));
        sidebar.style.width = newWidth + 'px';
        e.preventDefault();
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            sidebar.style.userSelect = '';
            document.body.style.cursor = '';
            // Save width to localStorage
            const currentWidth = parseInt(window.getComputedStyle(sidebar).width, 10);
            localStorage.setItem(LEFT_SIDEBAR_WIDTH_STORAGE, currentWidth.toString());
        }
    });
}

function getSavedPlans() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
}

function savePlan(planData, query = '', geminiResponse = '', conversationHistory = []) {
    const plans = getSavedPlans();
    const planName = `Plan ${new Date().toLocaleString()}`;
    const newPlan = {
        id: Date.now().toString(),
        name: planName,
        data: planData,
        query: query || '',
        geminiResponse: geminiResponse || '', // Keep for backward compatibility
        conversationHistory: conversationHistory || [], // New: full conversation history
        timestamp: new Date().toISOString()
    };
    plans.unshift(newPlan); // Add to beginning
    // Keep only last 50 plans
    const limitedPlans = plans.slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limitedPlans));
    renderSavedPlansList();
}

function updatePlanWithGeminiResponse(planId, geminiResponse) {
    const plans = getSavedPlans();
    const planIndex = plans.findIndex(p => p.id === planId);
    if (planIndex !== -1) {
        plans[planIndex].geminiResponse = geminiResponse; // Keep for backward compatibility
        // Update conversation history
        if (!plans[planIndex].conversationHistory) {
            plans[planIndex].conversationHistory = [];
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    }
}

function updatePlanConversationHistory(planId) {
    const plans = getSavedPlans();
    const planIndex = plans.findIndex(p => p.id === planId);
    if (planIndex !== -1) {
        // Save the full conversation history
        plans[planIndex].conversationHistory = conversationHistory;
        // Also update geminiResponse for backward compatibility (last AI response)
        const lastAiResponse = conversationHistory
            .filter(msg => msg.role === 'model')
            .map(msg => msg.parts[0].text)
            .pop();
        if (lastAiResponse) {
            plans[planIndex].geminiResponse = lastAiResponse;
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    }
}

function updateExistingPlan(planId, planData, query) {
    const plans = getSavedPlans();
    const planIndex = plans.findIndex(p => p.id === planId);
    if (planIndex !== -1) {
        // Update plan data and query, preserve conversation history
        plans[planIndex].data = planData;
        plans[planIndex].query = query || '';
        plans[planIndex].timestamp = new Date().toISOString();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
        renderSavedPlansList();
    }
}

function deletePlan(planId, event) {
    event.stopPropagation(); // Prevent triggering the load action
    const plans = getSavedPlans();
    const filtered = plans.filter(p => p.id !== planId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    renderSavedPlansList();
}

function loadPlanFromStorage(planId, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const plans = getSavedPlans();
    const plan = plans.find(p => p.id === planId);
    if (plan) {
        currentPlanId = planId;
        const jsonString = typeof plan.data === 'string' ? plan.data : JSON.stringify(plan.data, null, 2);
        document.getElementById('inputData').value = jsonString;
        // Load query if it exists
        if (plan.query) {
            document.getElementById('queryInput').value = plan.query;
        } else {
            document.getElementById('queryInput').value = '';
        }
        renderGraph(false);
        
        // Initialize chat with loaded plan and restore conversation history if available
        const savedHistory = plan.conversationHistory || null;
        initializeChat(plan.data, plan.query || '', savedHistory);
        
        // Backward compatibility: if no conversationHistory but geminiResponse exists, add it
        if (!savedHistory && plan.geminiResponse) {
            addMessageToChat('assistant', plan.geminiResponse);
            // Add to conversation history
            conversationHistory.push({
                role: 'model',
                parts: [{ text: plan.geminiResponse }]
            });
            // Save it as conversation history for future loads
            if (currentPlanId) {
                updatePlanConversationHistory(currentPlanId);
            }
        }
    }
    return false;
}

function renderSavedPlansList() {
    const plans = getSavedPlans();
    const listContainer = document.getElementById('saved-plans-list');
    
    if (plans.length === 0) {
        listContainer.innerHTML = '<div class="empty-state">No saved plans yet</div>';
        return;
    }
    
    listContainer.innerHTML = plans.map(plan => {
        const date = new Date(plan.timestamp);
        const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        // Try to extract some info from the plan for display
        let metaInfo = '';
        try {
            const planObj = typeof plan.data === 'string' ? JSON.parse(plan.data) : plan.data;
            const rootPlan = Array.isArray(planObj) && planObj[0]?.Plan ? planObj[0].Plan : (planObj.Plan || planObj);
            if (rootPlan) {
                const totalTime = rootPlan['Actual Total Time'] || 0;
                const totalRows = (rootPlan['Actual Rows'] || 0) * (rootPlan['Actual Loops'] || 1);
                metaInfo = `${totalTime.toFixed(2)}ms • ${totalRows.toLocaleString()} rows`;
            }
        } catch (e) {
            metaInfo = dateStr;
        }
        
        const hasQuery = plan.query && plan.query.trim().length > 0;
        const queryPreview = hasQuery ? plan.query.substring(0, 50) + (plan.query.length > 50 ? '...' : '') : '';
        
        return `
            <div class="saved-plan-item" data-plan-id="${plan.id}">
                <button class="saved-plan-delete" data-plan-id="${plan.id}" title="Delete">×</button>
                <div class="saved-plan-name">${plan.name}</div>
                <div class="saved-plan-meta">${metaInfo || dateStr}</div>
                ${hasQuery ? `<div class="saved-plan-query" style="font-size: 0.75rem; color: #6c757d; margin-top: 6px; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace; font-style: italic;">${queryPreview}</div>` : ''}
            </div>
        `;
    }).join('');
    
    // Add event listeners after rendering
    listContainer.querySelectorAll('.saved-plan-item').forEach(item => {
        const planId = item.getAttribute('data-plan-id');
        item.addEventListener('click', (e) => {
            // Don't trigger if clicking the delete button
            if (e.target.classList.contains('saved-plan-delete')) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            loadPlanFromStorage(planId, e);
        });
    });
    
    // Add delete button listeners
    listContainer.querySelectorAll('.saved-plan-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const planId = btn.getAttribute('data-plan-id');
            deletePlan(planId, e);
        });
    });
}

// 2. Render Function
function renderGraph(save = true) {
    const input = document.getElementById('inputData').value;
    if (!input.trim()) return alert("Please paste a JSON plan.");

    let data;
    let originalData;
    try {
        originalData = JSON.parse(input);
        data = originalData;
        // Postgres usually returns an array [ { Plan: ... } ]
        if (Array.isArray(data) && data[0].Plan) {
            data = data[0].Plan;
        } else if (data.Plan) {
            data = data.Plan; // Handle case where user pastes just the object
        }
    } catch (e) {
        return alert("Invalid JSON format. Check console for details.");
    }
    if (save) {
        // Save the plan to localStorage
        const query = document.getElementById('queryInput').value.trim();
        // Check if this plan already exists (same data)
        const plans = getSavedPlans();
        const inputString = typeof originalData === 'string' ? originalData : JSON.stringify(originalData);
        const matchingPlan = plans.find(p => {
            const planString = typeof p.data === 'string' ? p.data : JSON.stringify(p.data);
            return planString === inputString;
        });
        
        if (matchingPlan) {
            // Update existing plan (preserve conversation history)
            currentPlanId = matchingPlan.id;
            const existingHistory = matchingPlan.conversationHistory || [];
            updateExistingPlan(matchingPlan.id, originalData, query);
            // Initialize chat with existing history
            initializeChat(originalData, query, existingHistory);
        } else {
            // New plan
            savePlan(originalData, query, '', []);
            // Set currentPlanId to the newly saved plan
            const updatedPlans = getSavedPlans();
            if (updatedPlans.length > 0) {
                currentPlanId = updatedPlans[0].id; // Most recent plan is first
            }
            // Initialize chat with the new plan
            initializeChat(originalData, query);
        }
    }

    // Initialize Dagre Graph
    const g = new dagreD3.graphlib.Graph().setGraph({});
    g.graph().rankdir = "TB"; // Top-to-Bottom layout

    // Helper to calculate "Exclusive Time"
    // In PostgreSQL, Actual Total Time is the total time across all loop executions
    // For exclusive time: (node total time - sum of (child total time * child loops)) * loops
    // We multiply child times by child loops to account for how many times each child executed
    // This ensures parent nodes correctly account for children that executed multiple times
    function calculateExclusiveTime(node) {
        let childTime = 0;
        if (node.Plans) {
            node.Plans.forEach(child => {
                // Multiply child's Actual Total Time by child's loops
                // This accounts for how many times the child executed
                const childTotal = (child['Actual Total Time'] || 0) * (child['Actual Loops'] || 1);
                childTime += childTotal;
            });
        }
        
        const nodeTotalTime = node['Actual Total Time'] || 0;
        const loops = node['Actual Loops'] || 1;
        
        // Calculate exclusive time: subtract (child times * child loops), then multiply by node loops
        // This gives us the exclusive time accounting for all loop iterations
        const exclusive = (nodeTotalTime - childTime) * loops;
        
        return exclusive > 0 ? exclusive : 0;
    }

    // Get total time and max exclusive time for color scaling
    const totalTime = data['Actual Total Time'] || 0;
    const totalRows = (data['Actual Rows'] || 0) * (data['Actual Loops'] || 1);
    let maxTime = 0;
    
    function findMax(node) {
        const t = calculateExclusiveTime(node);
        if (t > maxTime) maxTime = t;
        if (node.Plans) node.Plans.forEach(findMax);
    }
    findMax(data);

    // Update summary panel
    document.getElementById('total-duration').textContent = totalTime.toFixed(2) + ' ms';
    document.getElementById('total-rows').textContent = totalRows.toLocaleString();

    // Recursive function to build graph
    function traverse(node, parentId = null) {
        const id = Math.random().toString(36).substr(2, 9);
        const exclusiveTime = calculateExclusiveTime(node);

        // Color Logic (White -> Red based on exclusive time)
        // Using a simple linear interpolation for illustration
        const intensity = maxTime > 0 ? (exclusiveTime / maxTime) : 0;
        const r = 255;
        const ga = Math.floor(255 * (1 - intensity));
        const ba = Math.floor(255 * (1 - intensity));
        const color = `rgb(${r},${ga},${ba})`;

        // Calculate percentage of total time based on exclusive time
        const percentage = totalTime > 0 ? ((exclusiveTime / totalTime) * 100).toFixed(1) : '0.0';
        
        // Calculate rows fetched (rows * loops)
        const rowsFetched = (node['Actual Rows'] || 0) * (node['Actual Loops'] || 1);

        // HTML Label for the Node - Enhanced styling
        const label = `
            <div style="padding: 10px 12px; text-align: center; min-width: 120px;">
                <div style="font-weight: 600; font-size: 14px; color: #2d3748; margin-bottom: 6px; letter-spacing: 0.3px;">
                    ${node['Node Type']}
                </div>
                <div style="font-size: 13px; color: rgb(0, 0, 0); font-weight: 500; margin-bottom: 4px;">
                    ${exclusiveTime.toFixed(3)}ms
                </div>
                <div style="font-size: 11px; color:rgb(0, 0, 0); font-weight: 500; margin-bottom: 4px;">
                    ${rowsFetched.toLocaleString()} rows
                </div>
                <div style="font-size: 11px; color: rgb(0, 0, 0); font-weight: 500;">
                    ${percentage}% of total
                </div>
            </div>
        `;

        // Enhanced node styling with gradient effect
        const strokeColor = intensity > 0.1 ? `rgb(${r}, ${Math.max(ga - 20, 0)}, ${Math.max(ba - 20, 0)})` : '#4a5568';
        const nodeStyle = `fill: ${intensity > 0.1 ? color : '#ffffff'}; 
                          stroke: ${strokeColor}; 
                          stroke-width: 2px;
                          filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));`;

        // Add Node
        g.setNode(id, {
            labelType: "html",
            label: label,
            rx: 8, ry: 8,
            style: nodeStyle,
            // Store full data for tooltip
            customData: node,
            exclusiveTime: exclusiveTime.toFixed(3)
        });

        // Add Edge with enhanced styling
        if (parentId) {
            g.setEdge(parentId, id, {
                label: node['Parent Relationship'] || "",
                curve: d3.curveBasis,
                style: "stroke: #718096; stroke-width: 2.5px; fill: none;",
                arrowheadStyle: "fill: #718096; stroke: #718096;",
                arrowhead: "normal"
            });
        }

        // Recurse
        if (node.Plans) {
            node.Plans.forEach(child => traverse(child, id));
        }
    }

    traverse(data);

    // Clear existing graph before rendering new one - remove all nodes, edges, and groups
    inner.selectAll("*").remove();

    // Reset zoom transform and inner group transform before rendering
    svg.call(zoom.transform, d3.zoomIdentity);
    inner.attr("transform", "");

    // Remove any cached width/height from nodes to force dagre to recalculate
    g.nodes().forEach(nodeId => {
        const node = g.node(nodeId);
        if (node) {
            delete node.width;
            delete node.height;
        }
    });

    // Add arrow marker definitions to SVG if not already present
    let defs = svg.select("defs");
    if (defs.empty()) {
        defs = svg.append("defs");
    }
    
    // Create or update arrow marker
    let marker = defs.select("marker#arrowhead");
    if (marker.empty()) {
        marker = defs.append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 0 10 10")
            .attr("refX", 8)
            .attr("refY", 5)
            .attr("markerWidth", 8)
            .attr("markerHeight", 8)
            .attr("orient", "auto");
        
        marker.append("path")
            .attr("d", "M 0 0 L 10 5 L 0 10 z")
            .attr("fill", "#718096")
            .attr("stroke", "none");
    }
    
    // Create a fresh renderer instance each time
    const render = new dagreD3.render();
    
    // Get the graph pane dimensions to set SVG size
    const graphPane = document.getElementById("graph-pane");
    const paneRect = graphPane.getBoundingClientRect();
    
    // Set explicit SVG dimensions
    svg.attr("width", paneRect.width)
       .attr("height", paneRect.height)
       .attr("viewBox", `0 0 ${paneRect.width} ${paneRect.height}`);
    
    // Render the graph - dagre will calculate layout and node sizes
    // The render function measures HTML labels and calculates node dimensions
    render(inner, g);
    
    // Enhance edges after rendering - ensure arrow markers are applied
    inner.selectAll("path.edgePath").attr("marker-end", "url(#arrowhead)");

    // Access graph dimensions to ensure layout is complete
    // This forces dagre to finish its calculations
    const graphWidth = g.graph().width;
    const graphHeight = g.graph().height;

    // Center the graph after rendering completes
    requestAnimationFrame(() => {
        const svgRect = svg.node().getBoundingClientRect();
        const svgWidth = svgRect.width;
        const svgHeight = svgRect.height;
        const initialScale = 0.75;
        const xOffset = Math.max(0, (svgWidth - graphWidth * initialScale) / 2);
        const yOffset = Math.max(20, (svgHeight - graphHeight * initialScale) / 2);
        svg.call(zoom.transform, d3.zoomIdentity.translate(xOffset, yOffset).scale(initialScale));
    });

    // Setup Tooltips interactions using native event listeners for better event access
    inner.selectAll("g.node").each(function(v) {
        const nodeElement = this;
        const nodeData = g.node(v);
        if (!nodeData) return;
        
        const raw = nodeData.customData;
        const tooltip = document.getElementById("tooltip");
        const graphPane = document.getElementById("graph-pane");
        
        if (!tooltip || !graphPane) return;
        
        const showTooltip = (event) => {
            let content = `<strong>${raw['Node Type']}</strong><hr/>`;
            content += `Total Time: ${raw['Actual Total Time'] || 'N/A'} ms<br/>`;
            content += `Exclusive: <b>${nodeData.exclusiveTime} ms</b><br/>`;
            content += `Rows: ${raw['Actual Rows']} (loops: ${raw['Actual Loops']})<br/>`;

            if(raw['Shared Hit Blocks']) content += `Buffers Hit: ${raw['Shared Hit Blocks']}<br/>`;
            if(raw['Shared Read Blocks']) content += `Buffers Read: ${raw['Shared Read Blocks']}<br/>`;
            if(raw['Filter']) content += `<br/><em>Filter: ${raw['Filter']}</em>`;
            if(raw['Index Cond']) content += `<br/><em>Idx Cond: ${raw['Index Cond']}</em>`;

            tooltip.innerHTML = content;
            tooltip.style.opacity = 1;
        };
        
        const moveTooltip = (event) => {
            const paneRect = graphPane.getBoundingClientRect();
            const mouseX = event.clientX - paneRect.left;
            const mouseY = event.clientY - paneRect.top;
            
            tooltip.style.left = (mouseX + 15) + "px";
            tooltip.style.top = (mouseY - 10) + "px";
        };
        
        const hideTooltip = () => {
            tooltip.style.opacity = 0;
        };
        
        nodeElement.addEventListener("mouseover", showTooltip);
        nodeElement.addEventListener("mousemove", moveTooltip);
        nodeElement.addEventListener("mouseout", hideTooltip);
    });

    // AI analysis is now triggered manually via the "Generate AI Analysis" button
}

// Function to update SVG size
function updateSVGSize() {
    const graphPane = document.getElementById("graph-pane");
    if (!graphPane) return;
    
    const paneRect = graphPane.getBoundingClientRect();
    if (paneRect.width > 0 && paneRect.height > 0) {
        svg.attr("width", paneRect.width)
               .attr("height", paneRect.height)
               .attr("viewBox", `0 0 ${paneRect.width} ${paneRect.height}`);
    }
}

// Load sample data on init for demonstration
window.onload = function() {
    // Initialize tabs
    initTabs();
    
    // Load and render saved plans
    renderSavedPlansList();
    
    // Update API key UI based on saved state
    updateApiKeyUI();
    
    // Initialize resizable left sidebar
    initLeftSidebarResize();
    
    // Setup model dropdown if API key is already set
    if (getApiKey()) {
        setupGeminiModelDropdown();
    }
    
    // Update SVG size on window resize
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(function() {
            updateSVGSize();
            // Re-render graph if there's data
            const input = document.getElementById('inputData').value;
            if (input.trim()) {
                renderGraph(false); // Don't save on resize-triggered render
            }
        }, 250);
    });
    
    // Initial SVG size update
    setTimeout(updateSVGSize, 100);
    
    // Setup chat input Enter key handler
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
    
    const sample = [
        {
            "Plan": {
                "Node Type": "Aggregate",
                "Strategy": "Plain",
                "Partial Mode": "Simple",
                "Parallel Aware": false,
                "Startup Cost": 15578.40,
                "Total Cost": 15578.41,
                "Plan Rows": 1,
                "Plan Width": 8,
                "Actual Startup Time": 25.123,
                "Actual Total Time": 25.124,
                "Actual Rows": 1,
                "Actual Loops": 1,
                "Plans": [
                    {
                        "Node Type": "Seq Scan",
                        "Parent Relationship": "Outer",
                        "Parallel Aware": false,
                        "Relation Name": "users",
                        "Alias": "users",
                        "Startup Cost": 0.00,
                        "Total Cost": 15453.00,
                        "Plan Rows": 50160,
                        "Plan Width": 0,
                        "Actual Startup Time": 0.015,
                        "Actual Total Time": 22.450,
                        "Actual Rows": 50000,
                        "Actual Loops": 1,
                        "Filter": "(age > 25)"
                    }
                ]
            }
        }
    ];
    document.getElementById('inputData').value = JSON.stringify(sample, null, 2);
};

