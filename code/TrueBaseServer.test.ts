#!/usr/bin/env ts-node

import { TrueBaseFolder, TrueBaseFile } from "./TrueBase"
import { TrueBaseServer } from "./TrueBaseServer"

const path = require("path")
const { TestRacer } = require("jtree/products/TestRacer.js")
const folderPath = path.join(__dirname, "..", "planetsDB")
const testTree: any = {}

const getFolder = () => new TrueBaseFolder().setDir(folderPath).setGrammarDir(folderPath)

testTree.basics = (equal: any) => {
  const searchServer = new TrueBaseServer(getFolder(), path.join(__dirname, "..", "ignore")).initSearch().searchServer
  const results = searchServer.search("includes mars")
  equal(results.hits.length, 2)
}

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
export { testTree }
