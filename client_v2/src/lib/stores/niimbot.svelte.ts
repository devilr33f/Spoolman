import type { NiimbotAbstractClient, PrinterModelMeta, PrintTaskName } from '@mmote/niimbluelib';
import { NiimbotError, reasonFor, type NiimbotErrorReason } from '$lib/labels/niimbot/errors';
import { nativeDpi } from '$lib/labels/niimbot/options';
import type { NiimbotPrinter, PrintProgress } from '$lib/labels/niimbot/print';

// One printer connection per browser tab, shared by the print panel and the job.
//
// Web Bluetooth and Web Serial exist only in Chromium and only in a secure
// context, so `supportReason()` is consulted before any control is drawn — the
// same policy as utils/nfc.ts: a button the user can never explain is worse than
// no button. Note that Chrome removes navigator.bluetooth on plain HTTP, so an
// insecure page and an unsupported browser look alike from the API; the secure
// context flag is what tells them apart.
//
// niimbluelib is loaded on first connect. It is a megabyte of protocol tables
// that everyone printing on paper never needs, so it gets its own chunk, the way
// fflate does for zip export.

export type Transport = 'bluetooth' | 'serial';
export type Status = 'idle' | 'connecting' | 'connected' | 'printing';

type Lib = typeof import('@mmote/niimbluelib');
let libPromise: Promise<Lib> | null = null;
function loadLib(): Promise<Lib> {
	libPromise ??= import('@mmote/niimbluelib');
	return libPromise;
}

export function bluetoothSupported(): boolean {
	return typeof navigator !== 'undefined' && 'bluetooth' in navigator && window.isSecureContext;
}

export function serialSupported(): boolean {
	return typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext;
}

/** Why no transport is available here, or null when at least one is. */
export function supportReason(): 'unsupported' | 'insecureContext' | null {
	if (bluetoothSupported() || serialSupported()) return null;
	if (typeof window !== 'undefined' && !window.isSecureContext) return 'insecureContext';
	return 'unsupported';
}

class NiimbotSession {
	status = $state<Status>('idle');
	transport = $state<Transport | null>(null);
	deviceName = $state<string | null>(null);
	meta = $state<PrinterModelMeta | null>(null);
	detectedTask = $state<PrintTaskName | null>(null);
	/** Manual print-task choice. Session-local: it describes the printer, not the design. */
	taskOverride = $state<PrintTaskName | null>(null);
	/** 0..100 when the printer reports a charge level. */
	battery = $state<number | null>(null);
	error = $state<NiimbotErrorReason | null>(null);
	/** Filled from the library once loaded; B1 is the only choice before that. */
	taskNames = $state<PrintTaskName[]>(['B1']);

	#lib: Lib | null = null;
	#client: NiimbotAbstractClient | null = null;

	get task(): PrintTaskName {
		return this.taskOverride ?? this.detectedTask ?? 'B1';
	}

	/** Real dpi to rasterize at; 203.2 until a printer says otherwise. */
	get dpi(): number {
		return nativeDpi(this.meta?.dpi ?? 203);
	}

	get connected(): boolean {
		return this.status === 'connected' || this.status === 'printing';
	}

	async connect(transport: Transport): Promise<void> {
		if (this.status === 'connecting' || this.status === 'printing') return;
		const supported = transport === 'bluetooth' ? bluetoothSupported() : serialSupported();
		if (!supported) {
			this.error = supportReason() ?? 'unsupported';
			return;
		}
		await this.disconnect();
		this.error = null;
		this.status = 'connecting';
		try {
			const lib = await loadLib();
			this.#lib = lib;
			this.taskNames = lib.printTaskNames;
			const client =
				transport === 'bluetooth' ? new lib.NiimbotBluetoothClient() : new lib.NiimbotSerialClient();
			client.on('disconnect', () => {
				if (this.#client === client) this.#reset();
			});
			const info = await client.connect();
			this.#client = client;
			this.transport = transport;
			this.deviceName = info.deviceName ?? null;
			this.meta = client.getModelMetadata() ?? null;
			this.detectedTask = client.getPrintTaskType() ?? null;
			const charge = client.getPrinterInfo().charge;
			this.battery = typeof charge === 'number' ? charge * 25 : null;
			this.status = 'connected';
		} catch (e) {
			console.error('Niimbot connect failed', e);
			this.#reset();
			this.error = reasonFor(e);
		}
	}

	async disconnect(): Promise<void> {
		const client = this.#client;
		this.#reset();
		this.error = null;
		if (client) await client.disconnect().catch(() => undefined);
	}

	/** Mark the session busy for the duration of `fn`; a mid-job disconnect wins. */
	async whilePrinting<T>(fn: () => Promise<T>): Promise<T> {
		this.status = 'printing';
		try {
			return await fn();
		} finally {
			if (this.status === 'printing') this.status = this.#client ? 'connected' : 'idle';
		}
	}

	/** The connected printer as the print job sees it. Throws when not connected. */
	printer(): NiimbotPrinter {
		const client = this.#client;
		const lib = this.#lib;
		const meta = this.meta;
		if (!client || !lib || !this.connected) throw new NiimbotError('disconnected');
		return {
			dpi: this.dpi,
			printheadPixels: meta?.printheadPixels ?? 384,
			defaultDirection: meta?.printDirection ?? 'top',
			densityRange: { min: meta?.densityMin ?? 1, max: meta?.densityMax ?? 5 },
			newPrintTask: (task, opt) =>
				client.abstraction.newPrintTask(task, {
					totalPages: opt.totalPages,
					density: opt.density,
					labelType: opt.labelType,
					statusPollIntervalMs: 100,
					statusTimeoutMs: 8_000
				}),
			encode: (canvas, direction) =>
				lib.ImageEncoder.encodeCanvas(canvas, lib.PageColorType.SingleColor, direction),
			pauseHeartbeat: () => client.stopHeartbeat(),
			// A mid-job disconnect nulls #client and the library stops its own heartbeat;
			// only restart it if this is still the live, connected client.
			resumeHeartbeat: () => {
				if (this.#client === client && client.isConnected()) client.startHeartbeat();
			},
			onProgress: (cb) => {
				const listener = (e: PrintProgress) => cb(e);
				client.on('printprogress', listener);
				return () => {
					client.off('printprogress', listener);
				};
			}
		};
	}

	#reset() {
		this.#client = null;
		this.status = 'idle';
		this.transport = null;
		this.deviceName = null;
		this.meta = null;
		this.detectedTask = null;
		this.battery = null;
	}
}

export const niimbot = new NiimbotSession();
