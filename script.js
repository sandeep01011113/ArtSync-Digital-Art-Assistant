const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');
const typingIndicator = document.getElementById('typing-indicator');
const errorMessage = document.getElementById('error-message');
const apiKeyInput = document.getElementById('api-key');

// New UI Elements for Enhancements
const languageSelect = document.getElementById('language-select');
const imageUpload = document.getElementById('image-upload');
const uploadBtn = document.getElementById('upload-btn');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const clearBtn = document.getElementById('clear-btn');

let currentImageBase64 = null;
let currentImageMimeType = null;

// System prompt for the AI persona
const BASE_SYSTEM_PROMPT = "Act as ArtSync, an expert digital art director and friendly AI assistant. Your goal is to help users brainstorm highly creative, unique, and detailed prompts for digital illustrations. Discuss setting, subject, mood, and color palettes. Be conversational, encouraging, and human-like. Keep your responses relatively concise (under 150 words per message) and use markdown to format beautifully. Occasionally suggest that you can find a reference image for them.";

// Maintain conversation history for Gemini API
let conversationHistory = [];

const searchTerms = ['landscape', 'portrait', 'abstract', 'modern', 'city', 'nature', 'future', 'surrealism'];

// --- Audio System ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTone(freq, type, duration, vol) {
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playSendSound() { playTone(600, 'sine', 0.1, 0.05); setTimeout(()=>playTone(800, 'sine', 0.15, 0.05), 100); }
function playReceiveSound() { playTone(500, 'sine', 0.1, 0.05); setTimeout(()=>playTone(600, 'sine', 0.15, 0.05), 100); setTimeout(()=>playTone(800, 'sine', 0.2, 0.05), 200); }

// --- Image Upload Logic ---
uploadBtn.addEventListener('click', () => imageUpload.click());

imageUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const dataUrl = event.target.result;
            // Extract MIME type and base64 string from data URL
            const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                currentImageMimeType = matches[1];
                currentImageBase64 = matches[2];
                imagePreview.src = dataUrl;
                imagePreviewContainer.classList.remove('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
});

removeImageBtn.addEventListener('click', () => {
    currentImageBase64 = null;
    currentImageMimeType = null;
    imageUpload.value = '';
    imagePreviewContainer.classList.add('hidden');
});

// --- Chat Logic ---
sendBtn.addEventListener('click', handleSend);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSend();
    }
});

clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the entire chat history?')) {
        // Clear history array
        conversationHistory = [];
        
        // Clear UI messages (keep only the first bot greeting)
        const messages = chatMessages.querySelectorAll('.message');
        for (let i = 1; i < messages.length; i++) {
            messages[i].remove();
        }
        
        // Clear image upload state
        removeImageBtn.click();
        
        // Notification
        console.log('Chat cleared');
    }
});

async function handleSend() {
    const text = chatInput.value.trim();
    if (!text && !currentImageBase64) return; // Must have text or image
    
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        showError("Please enter your Gemini API Key first.");
        return;
    }

    playSendSound();

    // 1. Add user message to UI
    let displayHtml = text;
    if (currentImageBase64) {
        displayHtml += `<br><img src="data:${currentImageMimeType};base64,${currentImageBase64}" style="max-height: 100px; border-radius: 8px; margin-top: 8px;">`;
    }
    appendMessage('user', displayHtml, true);
    
    chatInput.value = '';
    hideError();
    
    // 2. Prepare payload parts (Text + Image)
    const parts = [];
    if (text) {
        parts.push({ text: text });
    }
    if (currentImageBase64) {
        parts.push({
            inlineData: {
                mimeType: currentImageMimeType,
                data: currentImageBase64
            }
        });
    }

    // Add to history
    conversationHistory.push({
        role: "user",
        parts: parts
    });

    // Clear image selection
    removeImageBtn.click();

    // 3. Show typing indicator
    showTyping();
    sendBtn.disabled = true;
    uploadBtn.disabled = true;

    try {
        let botResponseText = "";
        const lang = languageSelect.value;
        const systemInstruction = `${BASE_SYSTEM_PROMPT} \n\nCRITICAL INSTRUCTION: You MUST respond entirely in ${lang}.`;

        if (apiKey.toLowerCase() === 'demo') {
            await new Promise(r => setTimeout(r, 1500));
            botResponseText = `This is a **demo response** in ${lang}. Since you used the 'demo' key, I'm providing a sample idea. If you uploaded an image, I would normally analyze it here!`;
        } else {
            botResponseText = await fetchGeminiChat(apiKey, conversationHistory, systemInstruction);
        }
        
        // 5. Add to history
        conversationHistory.push({
            role: "model",
            parts: [{ text: botResponseText }]
        });

        playReceiveSound();
        hideTyping();
        await appendBotMessageWithTyping(botResponseText);

        // 7. Decide if we should fetch a reference image
        const lowerRes = botResponseText.toLowerCase();
        if (lowerRes.includes('reference') || lowerRes.includes('image') || Math.random() < 0.3) {
            showTyping();
            const imageUrl = await fetchReferenceImage(text);
            hideTyping();
            if (imageUrl) {
                playReceiveSound();
                appendImageMessage(imageUrl);
            }
        }

    } catch (error) {
        console.error("Chat error:", error);
        hideTyping();
        const lang = languageSelect.value;
        const fallbackMessage = `*I encountered an issue connecting to the API.* \n\n**Error:** ${error.message}\n\nPlease check your key or try again.`;
        conversationHistory.pop(); 
        playReceiveSound();
        await appendBotMessageWithTyping(fallbackMessage);
    } finally {
        sendBtn.disabled = false;
        uploadBtn.disabled = false;
        chatInput.focus();
    }
}

function appendMessage(sender, htmlContent, isRawHtml = false) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', sender === 'user' ? 'user-message' : 'bot-message');
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    if (isRawHtml) {
        contentDiv.innerHTML = htmlContent;
    } else {
        contentDiv.textContent = htmlContent;
    }
    
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    scrollToBottom();
}

async function appendBotMessageWithTyping(markdownText) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'bot-message');
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content', 'typing-cursor');
    
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    scrollToBottom();

    let formattedHTML = '';
    if (typeof marked !== 'undefined') {
        formattedHTML = marked.parse(markdownText);
    } else {
        formattedHTML = `<p>${markdownText}</p>`;
    }

    await typeHTML(contentDiv, formattedHTML);
    contentDiv.classList.remove('typing-cursor');
}

function appendImageMessage(imageUrl) {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'bot-message');
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    contentDiv.innerHTML = `<p>Here's a reference image I found that might inspire you:</p>`;
    
    const img = document.createElement('img');
    img.src = imageUrl;
    img.classList.add('reference-image-msg');
    
    contentDiv.appendChild(img);
    msgDiv.appendChild(contentDiv);
    chatMessages.appendChild(msgDiv);
    
    img.onload = scrollToBottom;
}

async function typeHTML(element, html, isRoot = true) {
    if (isRoot) {
        element.innerHTML = '';
    }
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    
    for (const child of Array.from(tempDiv.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
            const text = child.textContent;
            for (let i = 0; i < text.length; i++) {
                element.appendChild(document.createTextNode(text[i]));
                scrollToBottom();
                await new Promise(r => setTimeout(r, Math.random() * 15 + 10)); // Human typing speed
            }
        } else {
            const clone = child.cloneNode(false);
            element.appendChild(clone);
            await typeHTML(clone, child.innerHTML, false);
        }
    }
}

async function fetchGeminiChat(apiKey, history, systemInstructionText, retryCount = 0) {
    const modelsToTry = ['gemini-2.5-flash', 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
    const MAX_RETRIES = 3;
    let lastError = null;

    for (const model of modelsToTry) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: {
                        parts: [{ text: systemInstructionText }]
                    },
                    contents: history,
                    generationConfig: { temperature: 0.8 }
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                const errorMsg = (errorData.error && errorData.error.message) ? errorData.error.message : 'API Error';
                
                // If model not found, try the next model
                if (errorMsg.includes('not found') || errorMsg.includes('not supported')) {
                    lastError = new Error(`${model}: ${errorMsg}`);
                    continue; 
                }
                
                // If overloaded / rate limited, retry with delay
                if (errorMsg.includes('high demand') || errorMsg.includes('rate limit') || errorMsg.includes('overloaded') || errorMsg.includes('RESOURCE_EXHAUSTED') || response.status === 429 || response.status === 503) {
                    if (retryCount < MAX_RETRIES) {
                        const delay = (retryCount + 1) * 2000; // 2s, 4s, 6s
                        console.log(`Server busy. Retrying in ${delay/1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
                        await new Promise(r => setTimeout(r, delay));
                        return fetchGeminiChat(apiKey, history, systemInstructionText, retryCount + 1);
                    }
                    throw new Error(`Server is busy after ${MAX_RETRIES} retries. Please wait a minute and try again.`);
                }
                
                // For auth errors or other bad requests, throw immediately
                throw new Error(errorMsg);
            }
            
            const data = await response.json();
            return data.candidates[0].content.parts[0].text;
            
        } catch (error) {
            if (!error.message.includes('not found') && !error.message.includes('not supported') && !error.message.includes(`${modelsToTry[0]}:`)) {
                throw error;
            }
            lastError = error;
        }
    }
    
    throw lastError || new Error("All models failed. Please try again later.");
}

async function fetchReferenceImage(contextStr = "") {
    try {
        const words = contextStr.split(/[\s,.-]+/).filter(w => w.length > 4);
        let term = searchTerms[Math.floor(Math.random() * searchTerms.length)];
        
        if (words.length > 0) {
            term = words[Math.floor(Math.random() * words.length)];
        }

        const searchUrl = `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${term}`;
        const searchRes = await fetch(searchUrl);
        const searchData = await searchRes.json();
        
        if (searchData.objectIDs && searchData.objectIDs.length > 0) {
            const randomId = searchData.objectIDs[Math.floor(Math.random() * Math.min(searchData.objectIDs.length, 50))];
            const objectRes = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${randomId}`);
            const objectData = await objectRes.json();
            
            if (objectData.primaryImageSmall || objectData.primaryImage) {
                return objectData.primaryImageSmall || objectData.primaryImage;
            }
        }
        
        if (words.length > 0) {
            return fetchReferenceImage(""); 
        }
    } catch (error) {
        console.warn('Primary image API failed', error);
    }
    return `https://picsum.photos/600/400?random=${Math.random()}`;
}

function showTyping() { typingIndicator.classList.remove('hidden'); scrollToBottom(); }
function hideTyping() { typingIndicator.classList.add('hidden'); }
function showError(msg) { errorMessage.textContent = msg; errorMessage.classList.remove('hidden'); }
function hideError() { errorMessage.classList.add('hidden'); }
function scrollToBottom() { chatMessages.scrollTop = chatMessages.scrollHeight; }
