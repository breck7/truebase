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
    // No params on purpose. This is a design decision to keep the CLI simple.
    if (this[commandName]) return this[commandName](process.cwd())
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

  firstSettingsPath(cwd) {
    let settingsPath
    Disk.recursiveReaddirSync(cwd, filename => {
      if (!filename.endsWith(SETTINGS_EXTENSION)) return
      if (!settingsPath) settingsPath = filename
    })
    return settingsPath
  }

  startCommand(cwd) {
    const settingsPath = this.firstSettingsPath(cwd)
    if (!settingsPath) return this.log(`❌ No TrueBase found in ${cwd}`)
    const tbServer = new TrueBaseServer(settingsPath)
    tbServer.startDevServerCommand()
  }

  testCommand(cwd) {
    const settingsPath = this.firstSettingsPath(cwd)
    if (!settingsPath) return this.log(`❌ No TrueBase found in ${cwd}`)
    const tbServer = new TrueBaseServer(settingsPath)
    tbServer.testCommand()
  }

  async initCommand(cwd) {
    const trueBaseId = cwd.split("/").pop()
    if (!trueBaseId) return this.log(`❌ cannot make a truebase in top folder`)
    const initFolder = {}
    initFolder[`${trueBaseId}${SETTINGS_EXTENSION}`] = `trueBaseId ${trueBaseId}
name ${trueBaseId}
domain localhost
grammarFolder ./grammar
thingsFolder ./things
ignoreFolder ./ignore
siteFolder ./site
devPort 5678`
    initFolder[`/grammar/${trueBaseId}.grammar`] = `${trueBaseId}Parser
 root
 string tableName ${trueBaseId}
 string fileExtension ${trueBaseId}
 inScope abstractTrueBaseColumnParser
 catchAllParser trueBaseErrorParser
titleParser
 extends abstractStringColumnParser
diameterParser
 extends abstractIntColumnParser`
    initFolder[`/things/earth.${trueBaseId}`] = `title Earth
diameter 12756`
    initFolder[`/site/settings.scroll`] = `importOnly

replaceDefault BASE_URL 
replace SITE_NAME ${trueBaseId}
replace SITE_DESCRIPTION A truebase
replace TRUEBASE_ID ${trueBaseId}
replace DOMAIN_NAME localhost
replace GIT_URL https://github.com/breck7/truebase

description SITE_NAME: SITE_DESCRIPTION
git GIT_URL
viewSourceBaseUrl https://github.com/breck7/truebase/blob/main/planetsDB/
email feedback@DOMAIN_NAME
baseUrl https://DOMAIN_NAME/`
    initFolder[`/grammar/wwc.grammar`] = Disk.read(path.join(__dirname, "planetsDB", "wwc.grammar"))
    Disk.writeObjectToDisk(cwd, initFolder)
    require("child_process").execSync("git init", { cwd })
    return this.log(`\n👍 Initialized new TrueBase in '${cwd}'.`)
  }

  deleteCommand() {
    return this.log(`\n💡 To delete a TrueBase just delete the *.truebase file and related folder\n`)
  }

  helpCommand() {
    this.log(`\n🛰🛰🛰  WELCOME TO TrueBase (v${packageJson.version}) 🛰🛰🛰`)
    return this.log(`\nThis is the TrueBase help page.\n\nCommands you can run from your TrueBase's folder:\n\n${this._allCommands.map(comm => `🔘 ` + comm.replace(CommandFnDecoratorSuffix, "")).join("\n")}\n`)
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
