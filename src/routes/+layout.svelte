<script lang="ts">
	import '../app.css';
	let { children } = $props();
	import { onMount } from 'svelte';
	let theme: string = 'light';

	onMount(() => {
		theme = localStorage.getItem('theme') || 'light';
		document.documentElement.setAttribute('data-theme', theme);
	});

	function toggleTheme() {
		theme = theme === 'light' ? 'dark' : 'light';
		localStorage.setItem('theme', theme);
		document.documentElement.setAttribute('data-theme', theme);
	}
</script>

<header class="navbar bg-base-100 shadow">
	<div class="navbar-start">
		<a class="btn btn-ghost text-xl" href="/">AI Team Chat</a>
	</div>
	<div class="navbar-end">
		<button class="btn btn-circle" on:click={toggleTheme}>
			{#if theme === 'light'}
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
					/></svg
				>
			{:else}
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"
					><path
						d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
					/></svg
				>
			{/if}
		</button>
	</div>
</header>

<main class="container mx-auto p-4">
	{@render children()}
</main>
