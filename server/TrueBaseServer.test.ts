#!/usr/bin/env ts-node

import { TrueBaseFolder, TrueBaseFile } from "./TrueBase"
import { TrueBaseServer } from "./TrueBaseServer"

const path = require("path")
const fs = require("fs")
const { TestRacer } = require("jtree/products/TestRacer.js")
const { Disk } = require("jtree/products/Disk.node.js")
const { PlanetsDB } = require("../planetsDB/PlanetsDB.js")
const testTree = PlanetsDB.testTree

testTree.search = (equal: any) => {
  PlanetsDB.listen(4567)
  equal(!!PlanetsDB.combinedJs, true)
  const { searchServer } = PlanetsDB
  const results = searchServer.search("includes mars")
  equal(results.hits.length, 2)

  const searchQuery = `select diameter
where diameter > 1
sortBy diameter
reverse`
  const resultsAdvanced = PlanetsDB.searchToHtml(searchQuery)
  equal(resultsAdvanced.includes("Mars"), true)
  // Test Cache
  equal(PlanetsDB.searchToHtml(searchQuery).includes("Mars"), true)
  // Test formats
  equal(searchServer.json(searchQuery).length > 1, true)
  equal(searchServer.tree(searchQuery).length > 1, true)
  equal(searchServer.csv(searchQuery).length > 1, true)
  equal(searchServer.tsv(searchQuery).length > 1, true)

  equal(PlanetsDB.validateSubmission(`title ISS\ndiameter 1\nmoons 0`).content.length > 1, true)

  equal(PlanetsDB.columnsCsv.length > 1, true)

  PlanetsDB.stopListening()
}

testTree.editing = async (equal: any) => {
  const tempBase = path.join(__dirname, "..", "ignore", "testTemp")
  const tempDir = path.join(tempBase, "planetsDB")
  const staticSiteDir = path.join(tempBase, "staticSite")
  fs.rmSync(tempDir, { recursive: true, force: true })
  Disk.mkdir(tempDir)
  const pbDir = path.join(__dirname, "..", "planetsDB")
  fs.cpSync(pbDir, tempDir, { recursive: true })
  const PlanetsDB = new TrueBaseServer(path.join(tempDir, "planetsdb.truebase"))
  // Act
  PlanetsDB.formatCommand()
  // Assert
  equal(PlanetsDB.statusPage.length > 0, true)
  equal(PlanetsDB.columnsCsv.length > 1, true)

  // Act
  PlanetsDB.dumpStaticSiteCommand(staticSiteDir)
  // Assert
  equal(Disk.exists(staticSiteDir), true)

  // Act
  PlanetsDB.gitOn = true
  await PlanetsDB.git.init()
}

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
export { testTree }
