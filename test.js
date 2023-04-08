#! /usr/bin/env node

const { TestRacer } = require("jtree/products/TestRacer.js")

const testAll = async () => {
  const fileTree = {}
  let folders = `./server/TrueBase.test.js
./server/TrueBaseServer.test.js
./tql/tql.test.js
./cli.test.js`
    .split("\n")
    .forEach(file => (fileTree[file] = require(file).testTree))
  const runner = new TestRacer(fileTree)
  await runner.execute()
  runner.finish()
}
testAll()
