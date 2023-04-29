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
  // Arrange
  const tempBase = path.join(__dirname, "..", "ignore", "testTemp")
  const tempDir = path.join(tempBase, "planetsDB")
  const staticSiteDir = path.join(tempBase, "staticSite")
  fs.rmSync(tempDir, { recursive: true, force: true })
  Disk.mkdir(tempDir)
  const pbDir = path.join(__dirname, "..", "planetsDB")
  fs.cpSync(pbDir, tempDir, { recursive: true })
  const PlanetsDB = new TrueBaseServer(path.join(tempDir, "planetsdb.truebase"))
  const folder = PlanetsDB.folder

  // Assert
  equal(PlanetsDB.statusPage.length > 0, true)
  equal(PlanetsDB.columnsCsv.length > 1, true)

  // Act
  equal(folder.hasChanges, false, "should have no changes")
  PlanetsDB.formatCommand()
  equal(folder.hasChanges, false, "should already be formatted")

  // Act
  PlanetsDB.dumpStaticSiteCommand(staticSiteDir)
  // Assert
  equal(Disk.exists(staticSiteDir), true)

  // Act/Assert
  try {
    PlanetsDB.applyPatch(`foo.planetsdb
 title Planet X`)
    equal(false, true, "Should fail to update")
  } catch (err) {
    equal(err.message.includes("not found"), true, "Try updating a file that does not exist")
  }
  try {
    PlanetsDB.applyPatch(`create
  title Planet X`)
    equal(false, true, "Should fail to create")
  } catch (err) {
    equal(err.message.includes("Not enough"), true, "Try creating a file without enough fields")
  }
  try {
    PlanetsDB.applyPatch(`create
 yearsToOrbitSun 2
 diameter 23
 moons 1`)
    equal(false, true, "Should fail to create")
  } catch (err) {
    equal(err.message.includes(`"title" must be provided`), true, "Try creating a file without a title")
  }
  try {
    PlanetsDB.applyPatch(`create
 title Planet X
 diameter abc
 surfaceGravitError 2
 moons one
 unknown foo`)
    equal(false, true, "Should fail to create")
  } catch (err) {
    equal(err.message.includes("Too many errors"), true, "Try creating a file with too many errors")
  }
  try {
    PlanetsDB.applyPatch(`mars.planetsdb
 title Planet X
 diameter abc
 surfaceGravitError 2
 moons one
 unknown foo`)
    equal(false, true, "Should fail to patch")
  } catch (err) {
    equal(err.message.includes("Too many errors"), true, "Try updating a file with too many errors")
  }

  // Act
  const patch = `create
 title Planet X
 diameter 49572
 yearsToOrbitSun 2064.79
mars.planetsdb
 title Mars
 diameter 6794
 surfaceGravity 4
 yearsToOrbitSun 1.88
 moons 2`
  const changes = PlanetsDB.applyPatch(patch)
  equal(changes.length, 2, "Successfully create and update a file")

  // Act
  PlanetsDB.gitOn = true
  PlanetsDB.pushOnCommit = false
  await PlanetsDB.git.init()

  const hash = await PlanetsDB.applyPatchCommitAndPush(
    `mars.planetsdb
 title Mars
 diameter 6794
 surfaceGravity 4
 yearsToOrbitSun 1.9
 moons 2`,
    "Breck Yunits <breck7@gmail.com>"
  )
  equal(hash.length, 40)
}

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
export { testTree }
