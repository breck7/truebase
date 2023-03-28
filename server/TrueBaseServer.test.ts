#!/usr/bin/env ts-node

import { TrueBaseFolder, TrueBaseFile } from "./TrueBase"
import { TrueBaseServer } from "./TrueBaseServer"

const path = require("path")
const { TestRacer } = require("jtree/products/TestRacer.js")
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

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
export { testTree }
