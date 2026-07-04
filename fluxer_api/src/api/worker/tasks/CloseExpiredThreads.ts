// SPDX-License-Identifier: AGPL-3.0-or-later

import type {WorkerTaskHandler} from '@pkgs/worker/src/contracts/WorkerTask';
import {Logger} from '../../Logger';
import {getWorkerDependencies} from '../WorkerContext';

const BUCKET_LOOKBACK_DAYS = 2;
const MAX_ITERATIONS_PER_BUCKET = 50;

export async function processExpiredThreads(now = new Date()): Promise<void> {
	const {channelService} = getWorkerDependencies();
	const threads = channelService.threads;
	let closed = 0;
	let stale = 0;
	for (let offset = 0; offset <= BUCKET_LOOKBACK_DAYS; offset++) {
		const bucketDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
		const bucket = threads.getAutoCloseBucket(bucketDate);
		for (let iteration = 0; iteration < MAX_ITERATIONS_PER_BUCKET; iteration++) {
			const due = await threads.fetchDueAutoCloseEntries(bucket, now);
			if (due.length === 0) break;
			for (const entry of due) {
				const outcome = await threads.sweepAutoCloseEntry(entry, now);
				if (outcome === 'closed') {
					closed++;
				} else {
					stale++;
				}
			}
		}
	}
	Logger.info({closed, staleRemoved: stale, lookbackDays: BUCKET_LOOKBACK_DAYS}, 'Processed thread auto-close buckets');
}

const closeExpiredThreads: WorkerTaskHandler = async () => {
	await processExpiredThreads();
};

export default closeExpiredThreads;
