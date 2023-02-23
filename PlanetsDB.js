#!/usr/bin/env node

// This is a demo TrueBase
const path = require("path")
const express = require("express")

const { TrueBaseFolder } = require("./code/TrueBase.js")
const { TrueBaseServer } = require("./code/TrueBaseServer.js")

const ignoreFolder = path.join(__dirname, "ignore")
const truebaseFolder = path.join(__dirname, "planetsDB")

class PlanetsDB {
  start(port) {
    const folder = new TrueBaseFolder()
      .setDir(truebaseFolder)
      .setGrammarDir(truebaseFolder)
      .loadFolder()
    const trueBaseServer = new TrueBaseServer(folder, ignoreFolder).initSearch().serveFolder(truebaseFolder)
    trueBaseServer.listen(port)
  }
}
if (!module.parent) new PlanetsDB().start(3333)

module.exports = { PlanetsDB }
