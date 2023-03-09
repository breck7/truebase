#!/usr/bin/env node

const path = require("path")
const { Utils } = require("jtree/products/Utils.js")
const { TrueBaseFolder } = require("../server/TrueBase.js")
const { TrueBaseServer } = require("../server/TrueBaseServer.js")

const ignoreFolder = path.join(__dirname, "..", "ignore")
const browserFolder = path.join(__dirname, "..", "browser")

class PlanetsDBServer extends TrueBaseServer {
  beforeListen() {
    this.buildScrollsCommand()
    this.buildDistFolderCommand()
    super.beforeListen()
  }
}

const PlanetsDB = new PlanetsDBServer(new TrueBaseFolder().setDir(__dirname).setGrammarDir(__dirname), ignoreFolder, __dirname)

module.exports = { PlanetsDB }

if (!module.parent) Utils.runCommand(PlanetsDB, process.argv[2], process.argv[3])
