#!/usr/bin/env node

// This is a demo TrueBase
const path = require("path");
const express = require("express");

const { TrueBaseFolder } = require("../server/TrueBase.js");
const { TrueBaseServer } = require("../server/TrueBaseServer.js");

const ignoreFolder = path.join(__dirname, "..", "ignore");
const browserFolder = path.join(__dirname, "..", "browser");
const truebaseFolder = path.join(__dirname);

class PlanetsDB {
  start(port) {
    const folder = new TrueBaseFolder()
      .setDir(truebaseFolder)
      .setGrammarDir(truebaseFolder);
    const trueBaseServer = new TrueBaseServer(
      folder,
      ignoreFolder,
      truebaseFolder
    )
      .initSearch()
      .serveFolder(browserFolder);
    trueBaseServer.listen(port);
  }
}
if (!module.parent) new PlanetsDB().start(3333);

module.exports = { PlanetsDB };
