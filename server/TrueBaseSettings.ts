export interface TrueBaseSettingsObject {
	grammarFolder: string
	thingsFolder: string
}

export interface TrueBaseServerSettingsObject extends TrueBaseSettingsObject {
	trueBaseId: string
	name: string
	domain: string
	ignoreFolder: string
	siteFolder: string
	devPort: number
}
