#!/usr/bin/env ts-node

import { TrueBaseFolder, TrueBaseFile } from "./TrueBase"
import { TrueBaseSettingsObject } from "./TrueBaseSettings"

const path = require("path")
const { TestRacer } = require("jtree/products/TestRacer.js")
const { Disk } = require("jtree/products/Disk.node.js")

const planetsFolderPath = path.join(__dirname, "..", "planetsDB")
const testTree: any = {}

const settings: TrueBaseSettingsObject = {
  grammarFolder: planetsFolderPath,
  rowsFolder: planetsFolderPath,
  questionsFolder: planetsFolderPath
}

const getFolder = () => new TrueBaseFolder().setSettings(settings)

testTree.errorChecking = (equal: any) => {
  const folder = getFolder().loadFolder()
  const errs = folder.errors
  equal(errs.length, 0, "no errors")
  if (errs.length) console.log(errs.join("\n"))

  // Act
  folder.getNode("earth").set("foo", "bar")

  // Assert
  equal(folder.errors.length, 1, "1 error")

  // Act
  folder.getNode("earth").delete("foo")

  // Assert
  equal(folder.errors.length, 0, "no errors")
}

testTree.sqlLite = (equal: any) => {
  // Arrange
  const folder = getFolder()
  // Act/Assert
  equal(folder.asSQLite, Disk.read(path.join(planetsFolderPath, "planetsdb.sql")), "sqlite works")
}

testTree.colNamesForCsv = (equal: any) => {
  // Arrange
  const folder = getFolder()
  // Act/Assert
  equal(folder.colNamesForCsv.join(" "), "title aka id nicknames description surfaceGravity diameter moons age length yearsToOrbitSun hasLife wikipedia wikipedia_pageViews neighbors", "col names works")
}

testTree.topUnansweredQuestions = (equal: any) => {
  // Arrange
  const folder = getFolder().loadFolder()
  const mars = folder.getNode("mars")
  const earth = folder.getNode("earth")
  // Act/Assert
  equal(earth.topUnansweredQuestions.length < mars.topUnansweredQuestions.length, true)
}

testTree.toTypedMap = (equal: any) => {
  // Arrange
  const folder = getFolder()
  // Act/Assert
  const { typedMap } = folder

  equal(Object.values(typedMap).length, 8)
  equal(typedMap.neptune.surfaceGravity, 11)
  equal(typedMap.mercury.moons, 0)
  equal(typedMap.earth.title, "Earth")
  equal(typedMap.earth.neighbors.mars, 110000000)
  equal(typedMap.earth.hasLife, true)
  equal(typedMap.earth.aka.length, 2)
  equal(typedMap.earth.wikipedia.url, "https://en.wikipedia.org/wiki/Earth")
  equal(typedMap.earth.wikipedia.pageViews, 123)
  equal(typedMap.earth.age.value, 4500000000)
  equal(typedMap.earth.age.description, "It was only during the 19th century that geologists realized Earth's age was at least many millions of years.")
  equal(typedMap.earth.description.split("\n").length, 2)
  equal(typedMap.earth.nicknames[1], "Planet Earth")
}

testTree.fileSystemEvents = async (equal: any) => {
  // Arrange
  const ignoreFolder = path.join(__dirname, "..", "ignore")
  const testDbIgnoreFolder = path.join(ignoreFolder, "testDb")
  if (!Disk.exists(ignoreFolder)) Disk.mkdir(ignoreFolder)
  if (!Disk.exists(testDbIgnoreFolder)) Disk.mkdir(testDbIgnoreFolder)

  const settings: TrueBaseSettingsObject = {
    grammarFolder: testDbIgnoreFolder,
    rowsFolder: testDbIgnoreFolder,
    questionsFolder: testDbIgnoreFolder
  }

  const folder = new TrueBaseFolder().setSettings(settings).silence()
  folder.loadFolder()
  folder.startListeningForFileChanges()
  const newFilePath = path.join(testDbIgnoreFolder, "foobar.planetsdb")

  // Arrange
  let fileAdded = ""
  let waiting: any
  waiting = new Promise(resolve => {
    folder.onChildAdded((event: any) => {
      fileAdded = event.targetNode.getLine()
      // Assert
      equal(fileAdded, newFilePath, "new file detected")
      resolve(true)
    })
    // Act
    Disk.write(newFilePath, "")
  })
  await waiting

  // Arrange
  const expectedContent = "hello world"
  waiting = new Promise(resolve => {
    folder.onDescendantChanged((event: any) => {
      const fileNode = event.targetNode.getAncestorByParser(TrueBaseFile)

      // Assert
      equal(fileNode.childrenToString(), expectedContent, "file change detected")
      resolve(true)
      return true // remove after running once
    })
    // Act
    Disk.write(newFilePath, expectedContent)
  })
  await waiting

  // Arrange
  let fileRemoved = ""
  waiting = new Promise(resolve => {
    folder.onChildRemoved((event: any) => {
      fileRemoved = event.targetNode.getLine()
      // Assert
      equal(fileRemoved, newFilePath, "file remove expected")
      resolve(true)
    })
    // Act
    Disk.rm(newFilePath)
  })
  await waiting

  folder.stopListeningForFileChanges()
}

if (!module.parent) TestRacer.testSingleFile(__filename, testTree)
export { testTree }
