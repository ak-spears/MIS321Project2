const state = {
	messages: [
		{
			role: "assistant",
			content:
				"Welcome to ExamPrep AI. Ask me anything from class and I'll help you review."
		}
	]
};

const elements = {};

function createAppMarkup() {
	return `
		<main class="container py-4 py-md-5">
			<section class="hero-card p-4 p-md-5 mb-4">
				<p class="text-uppercase small fw-semibold mb-2">MIS 321 Study Assistant</p>
				<h1 class="display-6 fw-bold mb-3">Study faster for your next exam</h1>
				<p class="lead mb-0">
					Ask questions, review concepts, and keep a running chat history while you prep.
				</p>
			</section>
			<section class="chat-shell p-3 p-md-4">
				<div class="d-flex justify-content-between align-items-center mb-3">
					<h2 class="h5 mb-0">LLM Chat History</h2>
					<button id="clearChatBtn" class="btn btn-outline-secondary btn-sm">Clear</button>
				</div>
				<div id="chatHistory" class="chat-history mb-3" aria-live="polite"></div>
				<form id="chatForm" class="chat-form d-flex gap-2">
					<input
						id="messageInput"
						type="text"
						class="form-control"
						placeholder="Enter your next question..."
						autocomplete="off"
						required
					/>
					<button type="submit" class="btn btn-primary">Send</button>
				</form>
			</section>
		</main>
	`;
}

function cacheElements() {
	elements.chatHistory = document.getElementById("chatHistory");
	elements.chatForm = document.getElementById("chatForm");
	elements.messageInput = document.getElementById("messageInput");
	elements.clearChatBtn = document.getElementById("clearChatBtn");
}

function renderChatHistory() {
	elements.chatHistory.innerHTML = "";

	for (const message of state.messages) {
		const messageEl = document.createElement("article");
		messageEl.className = `chat-message ${message.role}`;
		messageEl.textContent = message.content;
		elements.chatHistory.appendChild(messageEl);
	}

	elements.chatHistory.scrollTop = elements.chatHistory.scrollHeight;
}

function buildAssistantReply(userPrompt) {
	return `Got it. You asked: "${userPrompt}"\n\nAdd backend LLM call next so this response comes from your API.`;
}

function wireEvents() {
	elements.chatForm.addEventListener("submit", (event) => {
		event.preventDefault();
		const message = elements.messageInput.value.trim();
		if (!message) return;

		state.messages.push({
			role: "user",
			content: message
		});

		state.messages.push({
			role: "assistant",
			content: buildAssistantReply(message)
		});

		elements.messageInput.value = "";
		renderChatHistory();
	});

	elements.clearChatBtn.addEventListener("click", () => {
		state.messages = [
			{
				role: "assistant",
				content:
					"Chat cleared. Ask your next exam prep question whenever you're ready."
			}
		];
		renderChatHistory();
	});
}

function init() {
	const appEl = document.getElementById("app");
	if (!appEl) return;

	appEl.innerHTML = createAppMarkup();
	cacheElements();
	wireEvents();
	renderChatHistory();
}

init();
