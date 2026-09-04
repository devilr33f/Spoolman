<script lang="ts">
	import Button from '$components/Button.svelte';
	import NumberInput from '../NumberInput.svelte';
	import type { LabelDesign } from '$lib/labels/types';
	import type { LabelBinding } from '$lib/labels/template';
	import { getLogoImage } from '$lib/labels/logo';
	import { renderMonochromeCanvas } from '$lib/labels/niimbot/print';
	import {
		acrossHeadPx,
		alongFeedPx,
		resolveDirection,
		LABEL_TYPES,
		MONO_MODES,
		type MonoMode,
		type NiimbotOptions
	} from '$lib/labels/niimbot/options';
	import type { NiimbotErrorReason } from '$lib/labels/niimbot/errors';
	import { niimbot, bluetoothSupported, serialSupported, supportReason } from '$lib/stores/niimbot.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		design: LabelDesign;
		/** First selected subject, for the 1-bit preview. */
		binding?: LabelBinding;
	}
	let { design = $bindable(), binding }: Props = $props();

	// Browser capability does not change while the page is open.
	const reason = supportReason();

	const opt = $derived(design.layout.niimbot);
	const direction = $derived(resolveDirection(opt, niimbot.meta));
	const across = $derived(acrossHeadPx(design.label, direction, niimbot.dpi));
	const along = $derived(alongFeedPx(design.label, direction, niimbot.dpi));
	const headPx = $derived(niimbot.meta?.printheadPixels ?? 384);
	const fits = $derived(across <= headPx);
	const labelTypes = $derived(
		LABEL_TYPES.filter((t) => !niimbot.meta || niimbot.meta.paperTypes.includes(t.value))
	);

	function set<K extends keyof NiimbotOptions>(key: K, value: NiimbotOptions[K]) {
		design.layout.niimbot = { ...design.layout.niimbot, [key]: value };
	}

	const ERROR_TEXT: Record<NiimbotErrorReason, () => string> = {
		unsupported: m['labels.niimbotUnsupported'],
		insecureContext: m['labels.niimbotInsecure'],
		cancelled: m['labels.niimbotErrorCancelled'],
		notAllowed: m['labels.niimbotErrorNotAllowed'],
		notFound: m['labels.niimbotErrorNotFound'],
		disconnected: m['labels.niimbotErrorDisconnected'],
		timeout: m['labels.niimbotErrorTimeout'],
		printerError: m['labels.niimbotErrorPrinterError'],
		tooWide: m['labels.niimbotErrorTooWide'],
		unknown: m['labels.niimbotErrorUnknown']
	};
	const LABEL_TYPE_TEXT = {
		gaps: m['labels.niimbotLabelTypeGaps'],
		black: m['labels.niimbotLabelTypeBlack'],
		transparent: m['labels.niimbotLabelTypeTransparent']
	};
	const MONO_TEXT: Record<MonoMode, () => string> = {
		threshold: m['labels.niimbotMonoThreshold'],
		'floyd-steinberg': m['labels.niimbotMonoFloyd'],
		atkinson: m['labels.niimbotMonoAtkinson']
	};

	// The preview is the actual print raster (same dpi, same 1-bit pass), drawn
	// upright — feed direction only decides how the bits are streamed. Konva at
	// print resolution is too heavy per slider tick, so it is debounced.
	let previewCanvas = $state<HTMLCanvasElement | null>(null);
	$effect(() => {
		const target = previewCanvas;
		const b = binding;
		const snapshot = $state.snapshot(design) as LabelDesign;
		const dpi = niimbot.dpi;
		if (!target || !b) return;
		const timer = setTimeout(() => void draw(target, snapshot, b, dpi), 150);
		return () => clearTimeout(timer);
	});

	async function draw(target: HTMLCanvasElement, d: LabelDesign, b: LabelBinding, dpi: number) {
		const logo = await getLogoImage().catch(() => null);
		const src = renderMonochromeCanvas(d, b, settings.baseUrl, logo, dpi, d.layout.niimbot);
		target.width = src.width;
		target.height = src.height;
		target.getContext('2d')?.drawImage(src, 0, 0);
	}
</script>

<div class="niimbot">
	{#if reason}
		<div class="warn">{ERROR_TEXT[reason]()}</div>
	{:else if niimbot.connected}
		<div class="status">
			<span class="chip">{niimbot.meta?.model ?? niimbot.deviceName ?? '?'}</span>
			{#if niimbot.battery !== null}
				<span class="muted small">{m['labels.niimbotBattery']({ percent: niimbot.battery })}</span>
			{/if}
			<Button
				variant="outline"
				onclick={() => void niimbot.disconnect()}
				disabled={niimbot.status === 'printing'}>{m['labels.niimbotDisconnect']()}</Button
			>
		</div>
	{:else}
		<div class="status">
			{#if bluetoothSupported()}
				<Button
					variant="outline"
					onclick={() => void niimbot.connect('bluetooth')}
					disabled={niimbot.status === 'connecting'}
				>
					{niimbot.status === 'connecting'
						? m['labels.niimbotConnecting']()
						: m['labels.niimbotConnectBle']()}
				</Button>
			{/if}
			{#if serialSupported()}
				<Button
					variant="outline"
					onclick={() => void niimbot.connect('serial')}
					disabled={niimbot.status === 'connecting'}>{m['labels.niimbotConnectUsb']()}</Button
				>
			{/if}
		</div>
	{/if}

	{#if niimbot.error}
		<div class="warn">{ERROR_TEXT[niimbot.error]()}</div>
	{/if}

	<label class="fld"
		>{m['labels.niimbotPrintTask']()}
		<select
			value={niimbot.task}
			disabled={!!reason}
			onchange={(e) => (niimbot.taskOverride = e.currentTarget.value as typeof niimbot.task)}
		>
			{#each niimbot.taskNames as t (t)}
				<option value={t}>{t}</option>
			{/each}
		</select></label
	>
	{#if niimbot.detectedTask}
		<p class="help">{m['labels.niimbotDetected']({ task: niimbot.detectedTask })}</p>
	{/if}

	<div class="row2">
		<label class="fld"
			>{m['labels.niimbotDensity']()}<NumberInput
				dense
				min={niimbot.meta?.densityMin ?? 1}
				max={niimbot.meta?.densityMax ?? 5}
				value={opt.density}
				onchange={(v) => set('density', v)}
			/></label
		>
		<label class="fld"
			>{m['labels.niimbotLabelType']()}
			<select value={opt.labelType} onchange={(e) => set('labelType', Number(e.currentTarget.value))}>
				{#each labelTypes as t (t.value)}
					<option value={t.value}>{LABEL_TYPE_TEXT[t.id]()}</option>
				{/each}
			</select></label
		>
	</div>

	<label class="fld"
		>{m['labels.niimbotDirection']()}
		<select
			value={opt.direction}
			onchange={(e) => set('direction', e.currentTarget.value as NiimbotOptions['direction'])}
		>
			<option value="auto">{m['labels.niimbotDirectionAuto']()}</option>
			<option value="top">{m['labels.niimbotDirectionTop']()}</option>
			<option value="left">{m['labels.niimbotDirectionLeft']()}</option>
		</select></label
	>

	<div class="row2">
		<label class="fld"
			>{m['labels.niimbotMono']()}
			<select value={opt.mono} onchange={(e) => set('mono', e.currentTarget.value as MonoMode)}>
				{#each MONO_MODES as mode (mode)}
					<option value={mode}>{MONO_TEXT[mode]()}</option>
				{/each}
			</select></label
		>
		<label class="fld"
			>{m['labels.niimbotThreshold']()} · {opt.threshold}
			<input
				type="range"
				min="0"
				max="255"
				value={opt.threshold}
				oninput={(e) => set('threshold', Number(e.currentTarget.value))}
			/></label
		>
	</div>

	{#if binding}
		<div class="preview">
			<canvas bind:this={previewCanvas}></canvas>
		</div>
	{/if}
	<div class="grid-info">{m['labels.niimbotPreviewSize']({ across, along })}</div>
	{#if !fits}
		<div class="warn">{m['labels.niimbotTooWide']({ px: across, max: headPx })}</div>
	{/if}
</div>

<style>
	.niimbot {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chip {
		font-size: 12px;
		font-weight: 600;
		padding: 4px 9px;
		border-radius: 999px;
		background: var(--accent-wash);
		color: var(--accent-soft);
	}
	.fld {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: var(--text-dim);
	}
	.fld select {
		width: 100%;
		border: 1px solid var(--border-strong);
		background: none;
		border-radius: 6px;
		padding: 7px 9px;
		color: var(--text);
		font-size: 12.5px;
		font-family: inherit;
	}
	.fld select:focus {
		outline: none;
		border-color: var(--accent);
	}
	.fld input[type='range'] {
		width: 100%;
		accent-color: var(--accent);
	}
	.row2 {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 8px;
	}
	.help {
		margin: 2px 0 0;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-dim);
	}
	.warn {
		font-size: 11.5px;
		line-height: 1.35;
		color: var(--danger, #e5484d);
	}
	.grid-info {
		font-size: 11.5px;
		color: var(--text-dim);
	}
	.muted {
		color: var(--text-dim);
		font-size: 12.5px;
	}
	.small {
		font-size: 11px;
	}
	.preview {
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px;
		background: #fff;
	}
	.preview canvas {
		display: block;
		width: 100%;
		height: auto;
		image-rendering: pixelated;
	}
</style>
