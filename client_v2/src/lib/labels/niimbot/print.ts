import type { EncodedImage, PrintTaskName } from '@mmote/niimbluelib';
import type { LabelDesign, PrintLayout } from '../types';
import type { LabelBinding } from '../template';
import { renderLabelCanvas } from '../print';
import { getLogoImage } from '../logo';
import { toMonochrome } from './monochrome';
import {
	clampDensity,
	fitsHead,
	resolveDirection,
	type NiimbotOptions,
	type PrintDirection
} from './options';
import { NiimbotError, reasonFor } from './errors';

// Sends rendered labels to a Niimbot printer. The printer is reached through the
// NiimbotPrinter port rather than niimbluelib directly, so this module has no
// Bluetooth dependency of its own: the session store adapts the real client and
// the tests pass a recorder. Rasterizing is injectable for the same reason —
// vitest has no canvas.

export interface PrintTaskLike {
	printInit(): Promise<void>;
	printPage(image: EncodedImage, quantity: number): Promise<void>;
	waitForFinished(): Promise<void>;
	/** Resolves to whatever the library reports; the job only awaits it. */
	printEnd(): Promise<unknown>;
}

/** niimbluelib's `printprogress` event, structurally. */
export interface PrintProgress {
	page: number;
	pagesTotal: number;
	pagePrintProgress: number;
	pageFeedProgress: number;
}

export interface NiimbotPrinter {
	/** Real dots per inch of the head (203.2 for the "203 dpi" models). */
	dpi: number;
	printheadPixels: number;
	defaultDirection: PrintDirection;
	densityRange: { min: number; max: number };
	newPrintTask(
		task: PrintTaskName,
		opt: { totalPages: number; density: number; labelType: number }
	): PrintTaskLike;
	encode(canvas: HTMLCanvasElement, direction: PrintDirection): EncodedImage;
	pauseHeartbeat(): void;
	resumeHeartbeat(): void;
	/** Subscribe to progress; returns the unsubscribe. */
	onProgress(cb: (p: PrintProgress) => void): () => void;
}

export interface JobProgress {
	/** 1-based index of the label being printed. */
	label: number;
	labels: number;
	/** 0..100 within the current label. */
	percent: number;
}

export interface NiimbotJob {
	design: LabelDesign;
	bindings: LabelBinding[];
	layout: PrintLayout;
	baseUrl: string;
	task: PrintTaskName;
	printer: NiimbotPrinter;
	/** Checked between labels only: a label in flight always runs to printEnd. */
	signal?: AbortSignal;
	onProgress?: (p: JobProgress) => void;
	/** Rasterizer override; defaults to renderMonochromeCanvas. Tests inject a stub. */
	render?: (binding: LabelBinding, dpi: number) => HTMLCanvasElement;
}

/** Render one label at `dpi` and reduce it to pure black and white in place. */
export function renderMonochromeCanvas(
	design: LabelDesign,
	binding: LabelBinding,
	baseUrl: string,
	logo: HTMLImageElement | null,
	dpi: number,
	opt: NiimbotOptions
): HTMLCanvasElement {
	const canvas = renderLabelCanvas(design, binding, baseUrl, logo, dpi);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new NiimbotError('unknown');
	const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
	toMonochrome(img, opt);
	ctx.putImageData(img, 0, 0);
	return canvas;
}

/** Percent of one label's job; niimblue's formula (print and feed weighted equally). */
export function jobPercent(p: PrintProgress): number {
	if (p.pagesTotal <= 0) return 0;
	return Math.min(
		100,
		Math.floor((p.page / p.pagesTotal) * ((p.pagePrintProgress + p.pageFeedProgress) / 2))
	);
}

async function defaultRenderer(design: LabelDesign, baseUrl: string, opt: NiimbotOptions) {
	const logo = await getLogoImage().catch(() => null);
	return (binding: LabelBinding, dpi: number) =>
		renderMonochromeCanvas(design, binding, baseUrl, logo, dpi, opt);
}

/**
 * Print every binding, one print task each with `layout.copies` copies. Sequential
 * on purpose: the B1 parks the paper between pages of a multi-page job, and a
 * separate job per label is what every other client does and what is known to
 * work. Rejects with a NiimbotError; `tooWide` is raised before any packet.
 */
export async function printToNiimbot(job: NiimbotJob): Promise<void> {
	const { design, bindings, layout, printer } = job;
	const opt = layout.niimbot;
	const direction = resolveDirection(opt, { printDirection: printer.defaultDirection });
	if (!fitsHead(design.label, direction, printer.dpi, printer.printheadPixels))
		throw new NiimbotError('tooWide');
	if (bindings.length === 0) return;

	const copies = Math.max(1, layout.copies);
	const density = clampDensity(opt.density, printer.densityRange);
	const render = job.render ?? (await defaultRenderer(design, job.baseUrl, opt));
	const report = (label: number, percent: number) =>
		job.onProgress?.({ label, labels: bindings.length, percent });

	// The heartbeat shares the channel with the row stream; niimblue stops it for
	// the whole job rather than per page.
	printer.pauseHeartbeat();
	try {
		for (let i = 0; i < bindings.length; i++) {
			if (job.signal?.aborted) throw new NiimbotError('cancelled');
			report(i + 1, 0);
			const encoded = printer.encode(render(bindings[i], printer.dpi), direction);
			const task = printer.newPrintTask(job.task, { totalPages: copies, density, labelType: opt.labelType });
			const off = printer.onProgress((p) => report(i + 1, jobPercent(p)));
			try {
				await task.printInit();
				await task.printPage(encoded, copies);
				await task.waitForFinished();
			} catch (e) {
				throw e instanceof NiimbotError ? e : new NiimbotError(reasonFor(e), { cause: e });
			} finally {
				off();
				// The printer stays in its printing state until it hears PrintEnd, so it
				// is sent even after a failure; a second failure here has nothing to add.
				await task.printEnd().catch(() => undefined);
			}
			report(i + 1, 100);
		}
	} finally {
		printer.resumeHeartbeat();
	}
}
