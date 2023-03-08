#!/usr/bin/env node

// This is a demo TrueBase
const path = require("path")
const express = require("express")

const { TrueBaseFolder } = require("../code/TrueBase.js")
const { TrueBaseServer } = require("../code/TrueBaseServer.js")

const ignoreFolder = path.join(__dirname, "..", "ignore")
const truebaseFolder = path.join(__dirname)
const frontendFolder = path.join(__dirname, "..", "frontEnd")

class PlanetsDB {
  start(port) {
    const folder = new TrueBaseFolder().setDir(truebaseFolder).setGrammarDir(truebaseFolder)
    const trueBaseServer = new TrueBaseServer(folder, ignoreFolder, truebaseFolder).initSearch().serveFolder(frontendFolder)
    trueBaseServer.listen(port)
  }
}
if (!module.parent) new PlanetsDB().start(3333)

module.exports = { PlanetsDB }
