#! /usr/bin/env node

const fs = require("fs")
const path = require("path")
const { TestRacer } = require("jtree/products/TestRacer.js")
const { Disk } = require("jtree/products/Disk.node.js")
const { TrueBaseCli } = require("./cli.js")

const tempDir = path.join(__dirname, "testBase")

const testTree = {}

testTree.all = equal => {
  // Arrange
  try {
    const cli = new TrueBaseCli()
    Disk.mkdir(tempDir)
    cli.initCommand(tempDir)
    cli.testCommand(tempDir)
    cli.testPerf(tempDir)
    equal(true, true, "no errors")
  } catch (err) {
    equal(false, true, "Expected no errors")
    console.error(err)
  }

  // Cleanup
  fs.rmSync(tempDir, { recursive: true })
}

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
module.exports = { testTree }
