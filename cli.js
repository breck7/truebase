#! /usr/bin/env node

const path = require("path")
const fs = require("fs")
const { Disk } = require("jtree/products/Disk.node.js")
const parseArgs = require("minimist")
const packageJson = require("./package.json")
const { Utils } = require("jtree/products/Utils.js")
const { TrueBaseFolder } = require("./server/TrueBase.js")
const { TrueBaseServer } = require("./server/TrueBaseServer.js")

const CommandFnDecoratorSuffix = "Command"
class TrueBaseCli {
	executeUsersInstructionsFromShell(args = [], userIsPipingInput = fs.fstatSync(0).isFIFO()) {
		const command = args[0]
		const commandName = `${command}${CommandFnDecoratorSuffix}`
		if (this[commandName]) return userIsPipingInput ? this._runCommandOnPipedStdIn(commandName) : this[commandName](process.cwd(), args[1], args[2])
		else if (command) this.log(`No command '${command}'. Running help command.`)
		else this.log(`No command provided. Running help command.`)
		return this.helpCommand()
	}

	_runCommandOnPipedStdIn(commandName) {
		let pipedData = ""
		process.stdin.on("readable", function() {
			pipedData += this.read() // todo: what's the lambda way to do this?
		})
		process.stdin.on("end", () => {
			const folders = pipedData
				.trim()
				.split("\n")
				.map(line => line.trim())
				.filter(line => fs.existsSync(line))

			folders.forEach(line => this[commandName](line))

			if (folders.length === 0)
				// Hacky to make sure this at least does something in all environments.
				// process.stdin.isTTY is not quite accurate for pipe detection
				this[commandName](process.cwd())
		})
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

	serveCommand() {
		const ignoreFolder = path.join(__dirname, "..", "ignore")

		class PlanetsDBServer extends TrueBaseServer {
			trueBaseId = "planetsdb"
			siteName = "PlanetsDB"
			siteDomain = "planetsdb.truebase.pub"
			devPort = 5678
		}

		const PlanetsDB = new PlanetsDBServer(new TrueBaseFolder().setDir(__dirname).setGrammarDir(__dirname), ignoreFolder, __dirname)
	}

	async createCommand(cwd, id = "truebase") {
		this.log(`Initializing TrueBase in "${cwd}"`)
		const fullPath = path.join(cwd, id)
		if (Disk.exists(fullPath)) throw new Error(`${fullPath} already exists`)
		Disk.mkdir(fullPath)
		Disk.mkdir(path.join(fullPath, "grammar"))
		Disk.mkdir(path.join(fullPath, "things"))
		const initFolder = {}
		initFolder[`${id}.truebase`] = `id ${id}
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
		return this.log(`\n💡 To delete a TrueBase just delete the folder\n`)
	}

	helpCommand() {
		this.log(`\n🛰🛰🛰  WELCOME TO TrueBase (v${packageJson.version}) 🛰🛰🛰`)
		return this.log(`\nThis is the TrueBase help page.\n\nCommands you can run from your TrueBase's folder:\n\n${this._allCommands.map(comm => `- ` + comm.replace(CommandFnDecoratorSuffix, "")).join("\n")}\n`)
	}
}

if (module && !module.parent) new TrueBaseCli().executeUsersInstructionsFromShell(parseArgs(process.argv.slice(2))._)

module.exports = { TrueBaseCli }
