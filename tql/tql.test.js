#! /usr/bin/env node

const path = require("path")
const { TestRacer } = require("jtree/products/TestRacer.js")
const { TrueBaseFolder } = require("../server/TrueBase.js")
const tql = require("./tql.nodejs.js")

const folder = new TrueBaseFolder().setSettingsFromPath(path.join(__dirname, "..", "planetsDB", "planetsdb.truebase")).loadFolder()

const testTree = {}

testTree.all = equal => {
  // Arrange
  const program = new tql(`includes mars
doesNotInclude zzzzz
matchesRegex \\d+
where moons = 1
where diameter > 10000
where nicknames includes Planet Earth
notMissing diameter
rename diameter Diameter`)

  // Act/Assert
  const results = program.filterFolder(folder)
  equal(results.length, 1)
}

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
module.exports = { testTree }
