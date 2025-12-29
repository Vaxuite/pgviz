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

// Gemini API Integration
function saveApiKey() {
    const apiKey = document.getElementById('gemini-api-key').value.trim();
    if (apiKey) {
        localStorage.setItem(GEMINI_API_KEY_STORAGE, apiKey);
        alert('API key saved!');
    } else {
        alert('Please enter a valid API key');
    }
}

function getApiKey() {
    return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
}

async function analyzePlanWithGemini(planData, query = '') {
    const apiKey = getApiKey();
    if (!apiKey) {
        const responseBox = document.getElementById('gemini-response');
        responseBox.className = 'gemini-response-box error';
        responseBox.innerHTML = '<div>Please enter and save your Gemini API key to get AI analysis.</div>';
        return;
    }

    const responseBox = document.getElementById('gemini-response');
    responseBox.className = 'gemini-response-box loading';
    responseBox.innerHTML = '<div>Analyzing query plan with AI...</div>';

    try {
        // Format the full plan data as JSON
        const planJson = JSON.stringify(planData, null, 2);
        
        let prompt = `Analyze this PostgreSQL query execution plan and provide insights:\n\n`;
        
        if (query && query.trim().length > 0) {
            prompt += `SQL Query:\n\`\`\`sql\n${query}\n\`\`\`\n\n`;
        }
        
        prompt += `Query Execution Plan (JSON):\n\`\`\`json\n${planJson}\n\`\`\`\n\n`;
        prompt += `Please provide:
1. A brief summary of what this query does
2. Performance bottlenecks or concerns
3. Suggestions for optimization
4. Key metrics to watch

Format your response in a clear, readable way with sections.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            }
        );

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error?.message || 'Failed to get response from Gemini API');
        }

        const data = await response.json();
        const geminiText = data.candidates[0].content.parts[0].text;

        responseBox.className = 'gemini-response-box';
        responseBox.innerHTML = `<div class="response-content">${formatGeminiResponse(geminiText)}</div>`;
    } catch (error) {
        console.error('Gemini API error:', error);
        responseBox.className = 'gemini-response-box error';
        responseBox.innerHTML = `<div>Error: ${error.message}<br><br>Make sure your API key is valid and you have access to the Gemini API.</div>`;
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
    // Convert markdown-like formatting to HTML
    let html = text
        // Headers
        .replace(/^### (.*$)/gim, '<h4>$1</h4>')
        .replace(/^## (.*$)/gim, '<h3>$1</h3>')
        .replace(/^# (.*$)/gim, '<h3>$1</h3>')
        // Bold
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Code blocks
        .replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
        // Inline code
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // Lists
        .replace(/^\d+\.\s+(.*)$/gim, '<li>$1</li>')
        .replace(/^[-*]\s+(.*)$/gim, '<li>$1</li>')
        // Line breaks
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>');
    
    // Wrap list items in ul tags
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    
    return '<p>' + html + '</p>';
}

// Resizable Gemini pane
const GEMINI_PANE_HEIGHT_STORAGE = 'pgviz_gemini_pane_height';

function initGeminiPaneResize() {
    const pane = document.getElementById('gemini-pane');
    const resizeHandle = document.getElementById('gemini-resize-handle');
    
    // Load saved height
    const savedHeight = localStorage.getItem(GEMINI_PANE_HEIGHT_STORAGE);
    if (savedHeight) {
        pane.style.height = savedHeight + 'px';
    }
    
    let isResizing = false;
    let startY = 0;
    let startHeight = 0;
    
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = parseInt(window.getComputedStyle(pane).height, 10);
        pane.style.userSelect = 'none';
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        
        const deltaY = startY - e.clientY; // Inverted because we're resizing from top
        const newHeight = Math.max(150, Math.min(window.innerHeight * 0.8, startHeight + deltaY));
        pane.style.height = newHeight + 'px';
        e.preventDefault();
    });
    
    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            pane.style.userSelect = '';
            document.body.style.cursor = '';
            // Save height to localStorage
            const currentHeight = parseInt(window.getComputedStyle(pane).height, 10);
            localStorage.setItem(GEMINI_PANE_HEIGHT_STORAGE, currentHeight.toString());
        }
    });
}

function getSavedPlans() {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
}

function savePlan(planData, query = '') {
    const plans = getSavedPlans();
    const planName = `Plan ${new Date().toLocaleString()}`;
    const newPlan = {
        id: Date.now().toString(),
        name: planName,
        data: planData,
        query: query || '',
        timestamp: new Date().toISOString()
    };
    plans.unshift(newPlan); // Add to beginning
    // Keep only last 50 plans
    const limitedPlans = plans.slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(limitedPlans));
    renderSavedPlansList();
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
        const jsonString = typeof plan.data === 'string' ? plan.data : JSON.stringify(plan.data, null, 2);
        document.getElementById('inputData').value = jsonString;
        // Load query if it exists
        if (plan.query) {
            document.getElementById('queryInput').value = plan.query;
        } else {
            document.getElementById('queryInput').value = '';
        }
        renderGraph(false);
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
        savePlan(originalData, query);
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

        // HTML Label for the Node
        const label = `
            <div style="padding: 5px; text-align: center;">
                <strong>${node['Node Type']}</strong><br/>
                <span style="font-size: 0.8em">${exclusiveTime.toFixed(3)}ms</span><br/>
                <span style="font-size: 0.75em; color: #666;">${percentage}%</span>
            </div>
        `;

        // Add Node
        g.setNode(id, {
            labelType: "html",
            label: label,
            rx: 5, ry: 5,
            style: `fill: ${intensity > 0.1 ? color : '#fff'}; stroke: #333;`,
            // Store full data for tooltip
            customData: node,
            exclusiveTime: exclusiveTime.toFixed(3)
        });

        // Add Edge
        if (parentId) {
            g.setEdge(parentId, id, {
                label: node['Parent Relationship'] || "",
                curve: d3.curveBasis
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

    // Create a fresh renderer instance each time
    const render = new dagreD3.render();
    
    // Render the graph - dagre will calculate layout and node sizes
    // The render function measures HTML labels and calculates node dimensions
    render(inner, g);

    // Access graph dimensions to ensure layout is complete
    // This forces dagre to finish its calculations
    const graphWidth = g.graph().width;
    const graphHeight = g.graph().height;

    // Center the graph after rendering completes
    requestAnimationFrame(() => {
        const svgRect = svg.node().getBoundingClientRect();
        const svgWidth = svgRect.width;
        const initialScale = 0.75;
        const xOffset = Math.max(0, (svgWidth - graphWidth * initialScale) / 2);
        svg.call(zoom.transform, d3.zoomIdentity.translate(xOffset, 20).scale(initialScale));
    });

    // Setup Tooltips interactions - remove old handlers first
    inner.selectAll("g.node")
        .on("mouseover", null)
        .on("mousemove", null)
        .on("mouseout", null);

    inner.selectAll("g.node")
        .on("mouseover", function(v) {
            const nodeData = g.node(v);
            if (!nodeData) return;
            const raw = nodeData.customData;
            const tooltip = document.getElementById("tooltip");

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
        })
        .on("mousemove", function() {
            const tooltip = document.getElementById("tooltip");
            tooltip.style.left = (d3.event.pageX + 15) + "px";
            tooltip.style.top = (d3.event.pageY - 10) + "px";
        })
        .on("mouseout", function() {
            document.getElementById("tooltip").style.opacity = 0;
        });

    // Analyze plan with Gemini AI
    const query = document.getElementById('queryInput').value.trim();
    analyzePlanWithGemini(originalData, query);
}

// Load sample data on init for demonstration
window.onload = function() {
    // Load and render saved plans
    renderSavedPlansList();
    
    // Load saved API key if available
    const savedApiKey = getApiKey();
    if (savedApiKey) {
        document.getElementById('gemini-api-key').value = savedApiKey;
    }
    
    // Initialize resizable Gemini pane
    initGeminiPaneResize();
    
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

