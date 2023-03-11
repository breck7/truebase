#! /usr/bin/env node

const path = require("path")
const fs = require("fs")
const { Disk } = require("jtree/products/Disk.node.js")
const { TreeNode } = require("jtree/products/TreeNode.js")
const parseArgs = require("minimist")
const packageJson = require("./package.json")
const { TrueBaseServer } = require("./server/TrueBaseServer.js")

const SETTINGS_EXTENSION = ".truebase"

const CommandFnDecoratorSuffix = "Command"
class TrueBaseCli {
	executeUsersInstructionsFromShell(args = []) {
		const command = args[0]
		const commandName = `${command}${CommandFnDecoratorSuffix}`
		if (this[commandName]) return this[commandName](process.cwd(), args[1], args[2])
		else if (command) this.log(`No command '${command}'. Running help command.`)
		else this.log(`No command provided. Running help command.`)
		return this.helpCommand()
	}

	verbose = true
	log(message) {
		if (this.verbose) console.log(message)
		return message
	}

	get _allCommands() {
		return Object.getOwnPropertyNames(Object.getPrototypeOf(this))
			.filter(word => word.endsWith(CommandFnDecoratorSuffix))
			.sort()
	}

	serveCommand(cwd) {
		let settingsPath
		Disk.recursiveReaddirSync(cwd, filename => {
			if (!filename.endsWith(SETTINGS_EXTENSION)) return
			if (!settingsPath) settingsPath = filename
		})
		if (!settingsPath) return this.log(`❌ No TrueBase found in ${cwd}`)
		const tbServer = new TrueBaseServer(settingsPath)
		tbServer.startDevServerCommand()
	}

	async createCommand(cwd, id) {
		if (!id) return this.log(`❌ You must provide a name: truebase create [folderName]`)
		this.log(`Initializing TrueBase in "${cwd}"`)
		const fullPath = path.join(cwd, id)
		if (Disk.exists(fullPath)) throw new Error(`${fullPath} already exists`)
		Disk.mkdir(fullPath)
		Disk.mkdir(path.join(fullPath, "grammar"))
		Disk.mkdir(path.join(fullPath, "things"))
		const initFolder = {}
		initFolder[`${id}${SETTINGS_EXTENSION}`] = `id ${id}
siteName ${id}
siteDomain ${id}.truebase.pub
grammarFolder .
thingsFolder .
ignoreFolder ./ignore
siteFolder .
devPort 5678`

		Object.keys(initFolder).forEach(filename => {
			const filePath = path.join(fullPath, filename)
			if (!fs.existsSync(filePath)) Disk.writeIfChanged(filePath, initFolder[filename])
		})
		return this.log(`\n👍 Initialized new TrueBase in '${cwd}'.`)
	}

	deleteCommand() {
		return this.log(`\n💡 To delete a TrueBase just delete the *.truebase file and related folder\n`)
	}

	helpCommand() {
		this.log(`\n🛰🛰🛰  WELCOME TO TrueBase (v${packageJson.version}) 🛰🛰🛰`)
		return this.log(`\nThis is the TrueBase help page.\n\nCommands you can run from your TrueBase's folder:\n\n${this._allCommands.map(comm => `- ` + comm.replace(CommandFnDecoratorSuffix, "")).join("\n")}\n`)
	}

	listCommand(cwd) {
		return this.findTrueBasesInDirRecursive(cwd)
	}

	findTrueBasesInDirRecursive(dir) {
		const trueBases = []
		Disk.recursiveReaddirSync(dir, filename => {
			if (!filename.endsWith(SETTINGS_EXTENSION)) return
			trueBases.push(filename)
			this.log(filename)
		})

		return trueBases
	}
}

if (module && !module.parent) new TrueBaseCli().executeUsersInstructionsFromShell(parseArgs(process.argv.slice(2))._)

module.exports = { TrueBaseCli }
