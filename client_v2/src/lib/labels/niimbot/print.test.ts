import { describe, it, expect } from 'vitest';
import type { EncodedImage } from '@mmote/niimbluelib';
import {
	jobPercent,
	printToNiimbot,
	type NiimbotJob,
	type NiimbotPrinter,
	type PrintTaskLike
} from './print';
import { NiimbotError } from './errors';
import { DEFAULT_LAYOUT, newDesign, type LabelDesign, type PrintLayout } from '../types';
import type { LabelBinding } from '../template';

class FakeTask implements PrintTaskLike {
	constructor(
		private log: string[],
		private failAt?: 'waitForFinished'
	) {}
	async printInit() {
		this.log.push('init');
	}
	async printPage(_img: EncodedImage, qty: number) {
		this.log.push(`page x${qty}`);
	}
	async waitForFinished() {
		if (this.failAt === 'waitForFinished') throw new Error('Timeout waiting response (waited for 0xb3)');
		this.log.push('wait');
	}
	async printEnd() {
		this.log.push('end');
	}
}

function fakePrinter(log: string[], failAt?: 'waitForFinished'): NiimbotPrinter {
	return {
		dpi: 203.2,
		printheadPixels: 384,
		defaultDirection: 'top',
		densityRange: { min: 1, max: 5 },
		newPrintTask: (task, opt) => {
			log.push(`task ${task} d${opt.density} t${opt.labelType} p${opt.totalPages}`);
			return new FakeTask(log, failAt);
		},
		encode: (_canvas, direction) => {
			log.push(`encode ${direction}`);
			return {} as EncodedImage;
		},
		pauseHeartbeat: () => log.push('pause'),
		resumeHeartbeat: () => log.push('resume'),
		onProgress: () => () => undefined
	};
}

// No DOM in vitest: the rasterizer is injected and its result never inspected.
const stubCanvas = () => ({}) as HTMLCanvasElement;
const binding = (id: number) => ({ spool: { id } }) as unknown as LabelBinding;

function job(
	log: string[],
	over: Partial<NiimbotJob> = {},
	layoutOver: Partial<PrintLayout> = {}
): NiimbotJob {
	const design: LabelDesign = newDesign('t');
	design.label = { w: 48, h: 25 };
	return {
		design,
		bindings: [binding(1), binding(2)],
		layout: { ...DEFAULT_LAYOUT, mode: 'niimbot', copies: 2, ...layoutOver },
		baseUrl: '',
		task: 'B1',
		printer: fakePrinter(log),
		render: stubCanvas,
		...over
	};
}

describe('printToNiimbot', () => {
	it('runs one print task per label with the copies count, heartbeat paused', async () => {
		const log: string[] = [];
		await printToNiimbot(job(log));
		expect(log).toEqual([
			'pause',
			'encode top',
			'task B1 d3 t1 p2',
			'init',
			'page x2',
			'wait',
			'end',
			'encode top',
			'task B1 d3 t1 p2',
			'init',
			'page x2',
			'wait',
			'end',
			'resume'
		]);
	});

	it('still sends printEnd and resumes the heartbeat when the printer times out', async () => {
		const log: string[] = [];
		const j = job(log, { printer: fakePrinter(log, 'waitForFinished') });
		await expect(printToNiimbot(j)).rejects.toMatchObject({ reason: 'timeout' });
		expect(log.filter((l) => l === 'encode top')).toHaveLength(1);
		expect(log.slice(-2)).toEqual(['end', 'resume']);
	});

	it('stops between labels when aborted', async () => {
		const log: string[] = [];
		const ctrl = new AbortController();
		const j = job(log, {
			signal: ctrl.signal,
			onProgress: (p) => {
				if (p.label === 1 && p.percent === 100) ctrl.abort();
			}
		});
		await expect(printToNiimbot(j)).rejects.toMatchObject({ reason: 'cancelled' });
		expect(log.filter((l) => l.startsWith('encode'))).toHaveLength(1);
		expect(log.at(-1)).toBe('resume');
	});

	it('refuses a label wider than the head before touching the printer', async () => {
		const log: string[] = [];
		const j = job(log);
		j.design.label = { w: 50, h: 25 }; // 400 px across a 384 px head
		await expect(printToNiimbot(j)).rejects.toBeInstanceOf(NiimbotError);
		await expect(printToNiimbot(j)).rejects.toMatchObject({ reason: 'tooWide' });
		expect(log).toEqual([]);
	});

	it('rotates when the layout asks for left, so the height goes across the head', async () => {
		const log: string[] = [];
		const j = job(log, {}, { niimbot: { ...DEFAULT_LAYOUT.niimbot, direction: 'left' } });
		j.design.label = { w: 50, h: 25 };
		await printToNiimbot(j);
		expect(log).toContain('encode left');
	});

	it('clamps density into the printer range', async () => {
		const log: string[] = [];
		await printToNiimbot(job(log, {}, { niimbot: { ...DEFAULT_LAYOUT.niimbot, density: 9 } }));
		expect(log).toContain('task B1 d5 t1 p2');
	});

	it('reports progress per label', async () => {
		const seen: string[] = [];
		await printToNiimbot(job([], { onProgress: (p) => seen.push(`${p.label}/${p.labels}:${p.percent}`) }));
		expect(seen).toEqual(['1/2:0', '1/2:100', '2/2:0', '2/2:100']);
	});
});

describe('jobPercent', () => {
	it('weights page and feed progress equally over the page count', () => {
		expect(jobPercent({ page: 1, pagesTotal: 2, pagePrintProgress: 100, pageFeedProgress: 100 })).toBe(50);
		expect(jobPercent({ page: 2, pagesTotal: 2, pagePrintProgress: 100, pageFeedProgress: 100 })).toBe(100);
		expect(jobPercent({ page: 0, pagesTotal: 0, pagePrintProgress: 0, pageFeedProgress: 0 })).toBe(0);
	});
});
