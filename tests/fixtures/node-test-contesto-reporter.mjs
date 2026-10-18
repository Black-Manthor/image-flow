// Raw native outcomes and declaration sites for the compatibility fixture.
// Its destination is always a file in the fixture's isolated directory.
export default async function* events(source) {
	for await (const { type, data } of source) {
		if (type === 'test:stdout' || type === 'test:stderr') {
			yield `${JSON.stringify({ type, message: data.message })}\n`;
		} else if (type === 'test:pass' || type === 'test:fail') {
			yield `${JSON.stringify({ type, name: data.name, nesting: data.nesting, file: data.file, line: data.line, column: data.column,
				skip: data.skip, todo: data.todo, testType: data.details?.type, failureType: data.details?.error?.failureType })}\n`;
		}
	}
}
