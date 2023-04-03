export interface TrueBaseSettingsObject {
	grammarFolder: string
	thingsFolder: string
	columnOrder?: string // Define a custom CSV column order. Any columns not listed will be appended according to least sparse.
}

export interface TrueBaseServerSettingsObject extends TrueBaseSettingsObject {
	trueBaseId: string
	name: string
	domain: string
	ignoreFolder: string
	siteFolder: string
	devPort: number
}
