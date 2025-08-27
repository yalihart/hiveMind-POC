<script lang="ts">
	import { onMount, afterUpdate } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { jsPDF } from 'jspdf';
	import SvelteMarkdown from 'svelte-markdown';

	// State management
	let problem: string = '';
	let messages: { role: string; member_name: string; model: string; content: string }[] = [];
	let finalSolution: string | null = null;
	let loading: boolean = false;
	let isFinalSolution: boolean = true;
	let error: string | null = null;
	let useStreaming: boolean = false;
	let streamTerminated: boolean = false; // New flag to track chat termination

	// Mapping member names to models (matches backend)
	const memberToModel: { [key: string]: string } = {
		Leader: 'cognitivecomputations/dolphin3.0-r1-mistral-24b:free',
		Member1: 'google/gemini-2.0-pro-exp-02-05:free',
		Member2: 'deepseek/deepseek-r1:free'
	};

	// Handle textarea auto-expansion
	function adjustTextareaHeight(event: Event) {
		const textarea = event.target as HTMLTextAreaElement;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
	}

	// Clear the input field
	function clearProblem() {
		problem = '';
		const textarea = document.querySelector('textarea');
		if (textarea) textarea.style.height = 'auto';
	}

	// Handle form submission with keyboard shortcut
	function handleKeydown(event: KeyboardEvent) {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
			submitProblem();
		}
	}

	// Submit problem to server
	async function submitProblem() {
		if (!problem.trim() || loading) return;

		loading = true;
		error = null;
		messages = [{ role: 'user', member_name: 'User', model: '', content: problem }];
		finalSolution = null;
		isFinalSolution = true;
		streamTerminated = false; // Reset termination flag

		try {
			if (useStreaming) {
				await streamProblem();
			} else {
				await fetchProblem();
			}
		} catch (err) {
			console.error('Error:', err);
			messages = [
				...messages,
				{
					role: 'system',
					member_name: 'System',
					model: '',
					content: 'Error: Unable to fetch response. Please try again later.'
				}
			];
			error = 'Failed to connect to the server. Please check your connection and try again.';
		} finally {
			loading = false;
		}
	}

	// Non-streaming fetch
	async function fetchProblem() {
		const response = await fetch('/api/solve', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ problem })
		});

		if (!response.ok) throw new Error(`API error: ${response.status}`);
		const data = await response.json();
		messages = data.conversation;
		finalSolution = data.final_solution;
	}

	// Streaming fetch with SSE
	async function streamProblem() {
		const response = await fetch('/api/solve_stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ problem })
		});

		if (!response.ok) throw new Error(`Streaming API error: ${response.status}`);
		const reader = response.body?.getReader();
		if (!reader) throw new Error('No stream reader available');

		const decoder = new TextDecoder();
		let buffer = '';
		let firstMessageReceived = false;

		const processStream = async () => {
			while (true) {
				const { done, value } = await reader.read();
				if (done) {
					console.log('Stream completed');
					loading = false;
					break;
				}

				// Stop processing if stream is terminated
				if (streamTerminated) {
					reader.releaseLock();
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const parts = buffer.split('\n\n');
				buffer = parts.pop() || '';

				for (const part of parts) {
					if (part.startsWith('data: ')) {
						const jsonStr = part.slice(6).trim();
						try {
							const data = JSON.parse(jsonStr);
							console.log('Received SSE:', data);

							if (!firstMessageReceived) {
								loading = false;
								firstMessageReceived = true;
							}

							if (data.member && data.content) {
								const newMessage = {
									role: 'assistant',
									member_name: data.member,
									model: memberToModel[data.member] || '',
									content: data.content
								};
								messages = [...messages, newMessage];
								if (data.content.includes('x019898199281x7:')) {
									finalSolution = data.content;
									streamTerminated = true; // Terminate chat
									messages = [
										...messages,
										{
											role: 'system',
											member_name: 'System',
											model: '',
											content: 'Collaboration complete!'
										}
									];
									break; // Exit inner loop
								}
							} else if (data.error) {
								error = data.error;
								messages = [
									...messages,
									{
										role: 'system',
										member_name: 'System',
										model: '',
										content: data.error
									}
								];
							} else if (data.status === 'completed') {
								messages = [
									...messages,
									{
										role: 'system',
										member_name: 'System',
										model: '',
										content: 'Collaboration complete!'
									}
								];
								break;
							}
						} catch (e) {
							console.error('Error parsing JSON:', e, 'Raw:', jsonStr);
						}
					}
				}

				if (streamTerminated) {
					reader.releaseLock();
					break; // Exit outer loop
				}
			}
		};

		processStream(); // Start streaming without awaiting
	}

	// Auto-scroll chat area to bottom
	afterUpdate(() => {
		const chatArea = document.querySelector('.chat-area');
		if (chatArea) {
			chatArea.scrollTo({ top: chatArea.scrollHeight, behavior: 'smooth' });
		}
	});

	// Download conversation as PDF
	function downloadPDF() {
		const doc = new jsPDF();
		let y = 20;

		doc.setFontSize(20);
		doc.setTextColor(0, 0, 150);
		doc.text('AI Collaboration Log', 105, y, { align: 'center' });
		y += 15;

		doc.setFontSize(10);
		doc.setTextColor(100);
		doc.text(`Generated: ${new Date().toLocaleString()}`, 105, y, { align: 'center' });
		y += 15;

		if (messages.length > 0 && messages[0].role === 'user') {
			doc.setFontSize(14);
			doc.setTextColor(0);
			doc.text('Problem Statement:', 20, y);
			y += 8;

			doc.setFontSize(12);
			const problemLines = doc.splitTextToSize(messages[0].content, 170);
			doc.text(problemLines, 20, y);
			y += problemLines.length * 7 + 10;
		}

		doc.setFontSize(14);
		doc.text('Conversation:', 20, y);
		y += 10;

		messages.slice(1).forEach((msg) => {
			if (y > 270) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(12);
			doc.setTextColor(0, 0, 150);
			doc.text(`${msg.member_name}:`, 20, y);
			y += 6;
			doc.setTextColor(0);
			const lines = doc.splitTextToSize(msg.content, 170);
			doc.text(lines, 20, y);
			y += lines.length * 6 + 8;
		});

		if (finalSolution) {
			if (y > 240) {
				doc.addPage();
				y = 20;
			}
			doc.setFontSize(16);
			doc.setTextColor(0, 100, 0);
			doc.text('Final Solution:', 20, y);
			y += 10;
			doc.setFontSize(12);
			doc.setTextColor(0);
			const solutionLines = doc.splitTextToSize(finalSolution, 170);
			doc.text(solutionLines, 20, y);
		}

		doc.save('collaboration_log.pdf');
	}

	// Export conversation as JSON
	function exportMessagesAsJSON() {
		const exportData = {
			problem,
			conversation: messages,
			solution: finalSolution,
			timestamp: new Date().toISOString()
		};
		const dataStr =
			'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
		const downloadAnchorNode = document.createElement('a');
		downloadAnchorNode.setAttribute('href', dataStr);
		downloadAnchorNode.setAttribute('download', 'ai_collaboration.json');
		document.body.appendChild(downloadAnchorNode);
		downloadAnchorNode.click();
		downloadAnchorNode.remove();
	}

	// Initialize textarea height
	onMount(() => {
		const textarea = document.querySelector('textarea');
		if (textarea) {
			textarea.style.height = 'auto';
			textarea.style.height = `${Math.min(textarea.scrollHeight, 300)}px`;
		}
	});

	// Get message bubble color based on member name
	function getBubbleClass(memberName: string): string {
		switch (memberName) {
			case 'Leader':
				return 'bg-primary text-primary-content';
			case 'Member1':
				return 'bg-secondary text-secondary-content';
			case 'Member2':
				return 'bg-accent text-accent-content';
			case 'User':
				return 'bg-info text-info-content';
			case 'System':
				return 'bg-error text-error-content';
			default:
				return 'bg-neutral text-neutral-content';
		}
	}
</script>

<div
	class="flex flex-col h-[calc(86vh)] max-w-6xl mx-auto my-4 gap-4 p-4 bg-base-200 rounded-xl shadow-xl"
>
	<!-- Header -->
	<div class="text-center mb-2">
		<h1 class="text-2xl font-bold text-primary">AI Collaboration Assistant</h1>
		<p class="text-sm opacity-75">Submit your problem and watch our AI team solve it</p>
	</div>

	<!-- Chat Area -->
	<div
		class="chat-area flex-1 overflow-y-auto bg-base-100 rounded-lg shadow-inner p-4"
		role="log"
		aria-live="polite"
	>
		{#if messages.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-center p-6 opacity-60">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-12 w-12 mb-4"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
					/>
				</svg>
				<h3 class="text-lg font-medium">No messages yet</h3>
				<p class="mt-1">Enter your problem below to start</p>
			</div>
		{:else}
			{#each messages as msg, i (i)}
				<div
					in:fade={{ duration: 300 }}
					class="chat {msg.role === 'user' ? 'chat-end' : 'chat-start'} mb-4 animate-slide-up"
				>
					<div class="chat-header opacity-75 text-xs">
						{msg.member_name}
						{#if msg.model}<span class="text-xs opacity-50">({msg.model})</span>{/if}
					</div>
					<div class="chat-bubble {getBubbleClass(msg.member_name)} shadow-md">
						<SvelteMarkdown source={msg.content} />
					</div>
				</div>
			{/each}
		{/if}

		{#if loading}
			<div class="flex justify-center items-center py-4" in:fade={{ duration: 300 }}>
				<div class="flex flex-col items-center gap-2">
					<span class="loading loading-dots loading-md text-primary"></span>
					<span class="text-sm opacity-75">
						{useStreaming ? 'Starting collaboration...' : 'AI team is collaborating...'}
					</span>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="alert alert-error mb-4" in:slide={{ duration: 300 }}>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-6 w-6 flex-shrink-0"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				<span>{error}</span>
			</div>
		{/if}
	</div>

	<!-- Final Solution -->
	{#if finalSolution}
		<div
			in:fade={{ duration: 300 }}
			class="collapse collapse-arrow bg-success/10 border border-success/20 rounded-lg shadow-md animate-scale-in"
		>
			<input type="checkbox" bind:checked={isFinalSolution} />
			<div class="collapse-title font-medium flex items-center gap-2">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-5 w-5 text-success"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
					/>
				</svg>
				Final Solution
			</div>
			<div class="collapse-content">
				<div class="rounded-md bg-base-100 p-4 mt-2">
					<SvelteMarkdown source={finalSolution} />
				</div>
			</div>
		</div>
	{/if}

	<!-- Input Form -->
	<div class="bg-base-100 rounded-lg shadow-md p-3">
		<form on:submit|preventDefault={submitProblem} class="flex flex-col gap-3">
			<div class="relative">
				<textarea
					bind:value={problem}
					on:input={adjustTextareaHeight}
					on:keydown={handleKeydown}
					placeholder="Describe your problem here..."
					class="textarea textarea-bordered w-full min-h-[3rem] max-h-[300px] resize-none pr-10"
					disabled={loading}
				></textarea>
				{#if problem}
					<button
						type="button"
						class="absolute right-2 top-2 btn btn-sm btn-circle btn-ghost hover:bg-gray-200"
						on:click={clearProblem}
					>
						✕
					</button>
				{/if}
			</div>

			<div class="flex flex-wrap gap-2 justify-between items-center">
				<div class="flex items-center gap-2">
					<input
						type="checkbox"
						bind:checked={useStreaming}
						class="toggle toggle-primary"
						disabled={loading}
					/>
					<span class="text-xs opacity-75">Live Collaboration</span>
				</div>

				<div class="flex flex-wrap gap-2">
					{#if messages.length > 1}
						<div class="dropdown dropdown-top dropdown-end">
							<button tabindex="0" class="btn btn-outline btn-sm hover:bg-gray-200">
								<svg
									xmlns="http://www.w3.org/2000/svg"
									class="h-4 w-4 mr-1"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
								>
									<path
										stroke-linecap="round"
										stroke-linejoin="round"
										stroke-width="2"
										d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
									/>
								</svg>
								Export
							</button>
							<ul
								tabindex="0"
								class="dropdown-content z-10 menu p-2 shadow bg-base-100 rounded-box w-52"
							>
								<li><button type="button" on:click={downloadPDF}>Download as PDF</button></li>
								<li>
									<button type="button" on:click={exportMessagesAsJSON}>Export as JSON</button>
								</li>
							</ul>
						</div>
					{/if}
					<button
						type="submit"
						class="btn btn-primary hover:scale-105 transition-transform"
						disabled={loading || !problem.trim()}
					>
						{#if loading}
							<span class="loading loading-spinner loading-xs"></span>
							Processing...
						{:else}
							Submit
						{/if}
					</button>
				</div>
			</div>
		</form>
	</div>
</div>

<style>
	@keyframes slideUp {
		from {
			transform: translateY(20px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	@keyframes scaleIn {
		from {
			transform: scale(0.95);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	.animate-slide-up {
		animation: slideUp 0.4s ease-in-out;
	}

	.animate-scale-in {
		animation: scaleIn 0.3s ease-out;
	}

	:global(.chat-bubble) {
		border-radius: 1rem;
		padding: 1rem;
		max-width: 80%;
	}

	.textarea {
		transition: height 0.2s ease;
	}

	.chat-header {
		font-weight: 600;
		margin-bottom: 0.5rem;
	}
</style>
