<script lang="ts">
  import '../app.css';
  import { page } from '$app/state';
  import { beforeNavigate } from '$app/navigation';
  import { onMount } from 'svelte';
  import Icon from '$lib/components/Icon.svelte';
  import { withBase } from '$lib/paths';

  let { children, data } = $props();
  let menuOpen = $state(false);
  let theme = $state<'light' | 'dark'>('light');

  const h = (path: string) => withBase(data.ingressPath, path);
  const currentPath = $derived.by(() => {
    const pathname = page.url.pathname;
    if (data.ingressPath && pathname.startsWith(data.ingressPath)) {
      return pathname.slice(data.ingressPath.length) || '/';
    }
    return pathname;
  });

  onMount(() => {
    theme = (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light';
  });

  // Home Assistant ingress puts the app under a changing path prefix. SvelteKit
  // cannot know that prefix at build time, so use normal full-page navigation
  // while ingress is active instead of the client-side router.
  beforeNavigate(({ to, cancel }) => {
    if (!data.ingressPath || !to) return;
    cancel();
    const target = to.url;
    const prefix = data.ingressPath;
    if (
      target.origin === window.location.origin &&
      target.pathname !== prefix &&
      !target.pathname.startsWith(`${prefix}/`)
    ) {
      window.location.assign(`${prefix}${target.pathname}${target.search}${target.hash}`);
    } else {
      window.location.assign(target.href);
    }
  });

  $effect(() => {
    page.url.pathname;
    menuOpen = false;
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // ignore private-mode storage errors
    }
  }

  const isActive = (prefix: string) =>
    prefix === '/' ? currentPath === '/' : currentPath.startsWith(prefix);
</script>

<svelte:head>
  <title>Inventory</title>
</svelte:head>

<aside class="sidebar" class:open={menuOpen}>
  <a class="brand" href={h('/')} aria-label="Inventory home">
    <span class="brand-mark">
      <Icon name="box" size={21} strokeWidth={1.7} />
    </span>
    <span>
      <span class="brand-name">Inventory</span>
      <span class="brand-sub">Parts &amp; supplies</span>
    </span>
  </a>

  <div class="nav-group">Workspace</div>
  <nav class="nav" aria-label="Main navigation">
    <a class="nav-link" class:active={isActive('/')} href={h('/')}>
      <Icon name="dashboard" size={18} />
      Overview
    </a>
    <a class="nav-link" class:active={isActive('/items')} href={h('/items')}>
      <Icon name="box" size={18} />
      Items
      {#if data.stats.item_count > 0}
        <span class="nav-count">{data.stats.item_count}</span>
      {/if}
    </a>
    <a class="nav-link" class:active={isActive('/locations')} href={h('/locations')}>
      <Icon name="pin" size={18} />
      Locations
      {#if data.stats.location_count > 0}
        <span class="nav-count">{data.stats.location_count}</span>
      {/if}
    </a>
  </nav>

  <div class="nav-group">Developers</div>
  <nav class="nav" aria-label="Developer navigation">
    <a class="nav-link" class:active={isActive('/api')} href={h('/api')}>
      <Icon name="code" size={18} />
      API &amp; AI
    </a>
  </nav>

  <div class="nav-group">System</div>
  <nav class="nav" aria-label="System navigation">
    <a class="nav-link" class:active={isActive('/backup')} href={h('/backup')}>
      <Icon name="archive" size={18} />
      Backup &amp; restore
    </a>
  </nav>

  <div class="sidebar-foot">
    {#if data.stats.low_stock_count > 0}
      <a class="low-alert" href={h('/items?low=1')}>
        <Icon name="alert" size={15} />
        {data.stats.low_stock_count} item{data.stats.low_stock_count === 1 ? '' : 's'} low on stock
      </a>
    {/if}
    <div class="sidebar-tools">
      <button class="theme-toggle" onclick={toggleTheme} type="button">
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
      <span class="sidebar-version">v1.0</span>
    </div>
  </div>
</aside>

{#if menuOpen}
  <button class="sidebar-scrim" aria-label="Close navigation" onclick={() => (menuOpen = false)}></button>
{/if}

<div class="main">
  <header class="topbar">
    <button
      class="icon-btn menu-btn"
      type="button"
      aria-label="Open navigation"
      onclick={() => (menuOpen = true)}
    >
      <Icon name="menu" size={20} />
    </button>

    <form class="topbar-search" action={h('/items')} method="GET" role="search">
      <Icon name="search" size={17} />
      <input
        type="search"
        name="q"
        placeholder="Search parts, SKUs, tags…"
        aria-label="Search inventory"
        value={currentPath.startsWith('/items') ? (page.url.searchParams.get('q') ?? '') : ''}
      />
    </form>

    <div class="topbar-spacer"></div>

    <a class="btn btn-primary btn-add" href={h('/items/new')}>
      <Icon name="plus" size={16} />
      <span>Add item</span>
    </a>
  </header>

  <main class="page">
    {@render children()}
  </main>
</div>
