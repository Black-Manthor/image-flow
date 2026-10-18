export default async function* native(source) {
	for await (const event of source) {
		if (!['test:start', 'test:pass', 'test:fail', 'test:summary'].includes(event.type)) continue;
		const { details, ...data } = event.data;
		yield JSON.stringify({ type: event.type, ...data, ...(details ? { testType: details.type, failureType: details.error?.failureType, reason: details.error?.cause?.message ?? details.error?.message } : {}) }) + '\n';
	}
}
