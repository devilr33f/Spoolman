import type { EncodedImage, ImageRow, PrintTaskName } from '@mmote/niimbluelib';
import type { LabelDesign, PrintLayout } from '../types';
import type { LabelBinding } from '../template';
import { renderLabelCanvas } from '../print';
import { getLogoImage } from '../logo';
import { toMonochrome, type RgbaImage } from './monochrome';
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
	/** Encode a pure black/white raster (see {@link monochromeSource}) for the wire. */
	encode(image: RgbaImage, direction: PrintDirection): EncodedImage;
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
	/** Rasterizer override; defaults to renderMonochromeImage. Tests inject a stub. */
	render?: (binding: LabelBinding, dpi: number) => RgbaImage;
}

/**
 * Render one label at `dpi` and reduce it to pure black and white. The result
 * is a plain pixel buffer, deliberately not written back into a canvas: on some
 * GPU-backed Chrome canvases a putImageData/getImageData round trip shifts
 * values by one (255 -> 254), and the printer path must never see that.
 */
export function renderMonochromeImage(
	design: LabelDesign,
	binding: LabelBinding,
	baseUrl: string,
	logo: HTMLImageElement | null,
	dpi: number,
	opt: NiimbotOptions
): RgbaImage {
	const canvas = renderLabelCanvas(design, binding, baseUrl, logo, dpi);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new NiimbotError('unknown');
	return toMonochrome(ctx.getImageData(0, 0, canvas.width, canvas.height), opt);
}

/** The same raster as a canvas, for on-screen preview only. */
export function renderMonochromeCanvas(
	design: LabelDesign,
	binding: LabelBinding,
	baseUrl: string,
	logo: HTMLImageElement | null,
	dpi: number,
	opt: NiimbotOptions
): HTMLCanvasElement {
	const img = renderMonochromeImage(design, binding, baseUrl, logo, dpi, opt);
	const canvas = document.createElement('canvas');
	canvas.width = img.width;
	canvas.height = img.height;
	const ctx = canvas.getContext('2d');
	if (ctx) {
		const out = ctx.createImageData(img.width, img.height);
		out.data.set(img.data);
		ctx.putImageData(out, 0, 0);
	}
	return canvas;
}

/** Below this luma a pixel prints; well away from both 0 and 255 so drift is harmless. */
const BLACK_BELOW = 128;

/**
 * Adapter from our pixel buffer to niimbluelib's ImageSource. Classifies by
 * luma threshold rather than the library's exact `=== #ffffff` test, and maps
 * `left` (rotate 90° clockwise) exactly as the library's CanvasImageSource does.
 */
export function monochromeSource(img: RgbaImage): {
	readonly width: number;
	readonly height: number;
	getPixelColor(x: number, y: number, printDirection: PrintDirection): number;
} {
	const { data, width, height } = img;
	return {
		width,
		height,
		getPixelColor(x, y, printDirection) {
			const idx = (printDirection === 'left' ? (height - 1 - x) * width + y : y * width + x) * 4;
			return data[idx] < BLACK_BELOW ? 0x000000 : 0xffffff;
		}
	};
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
		renderMonochromeImage(design, binding, baseUrl, logo, dpi, opt);
}

/**
 * niimbluelib emits PrintBitmapRowIndexed for rows with at most this many black
 * pixels; marking a row above it keeps every row on the plain PrintBitmapRow path.
 */
const INDEXED_ROW_MAX_PIXELS = 6;

/**
 * Rewrite an encoded image so every row goes out as its own full PrintBitmapRow:
 * blank runs become zero bitmaps, coalesced repeats are split, few-pixel rows are
 * kept off the indexed packet, and check rows are dropped. Verified against a B1
 * that printed random specks in blank areas with the compact stream and printed
 * cleanly with this one.
 */
export function expandToFullRows(image: EncodedImage): EncodedImage {
	const bytesPerRow = image.cols / 8;
	const rowsData: ImageRow[] = [];
	for (const row of image.rowsData) {
		if (row.dataType === 'check') continue;
		const rowDataBlack =
			row.dataType === 'pixels' && row.rowDataBlack ? row.rowDataBlack : new Uint8Array(bytesPerRow);
		for (let i = 0; i < row.repeat; i++) {
			rowsData.push({
				dataType: 'pixels',
				rowNumber: row.rowNumber + i,
				repeat: 1,
				blackPixelsCount: Math.max(INDEXED_ROW_MAX_PIXELS + 1, row.blackPixelsCount),
				redPixelsCount: 0,
				rowDataBlack
			});
		}
	}
	return { ...image, rowsData };
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
			const raw = printer.encode(render(bindings[i], printer.dpi), direction);
			const encoded = opt.fullRows ? expandToFullRows(raw) : raw;
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
