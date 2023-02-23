#!/usr/bin/env ts-node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.testTree = void 0;
const TrueBase_1 = require("./TrueBase");
const TrueBaseServer_1 = require("./TrueBaseServer");
const path = require("path");
const { TestRacer } = require("jtree/products/TestRacer.js");
const folderPath = path.join(__dirname, "..", "planetsDB");
const testTree = {};
exports.testTree = testTree;
const getFolder = () => new TrueBase_1.TrueBaseFolder().setDir(folderPath).setGrammarDir(folderPath);
testTree.basics = (equal) => {
    const folder = getFolder().loadFolder();
    const searchServer = new TrueBaseServer_1.TrueBaseServer(folder, path.join(__dirname, "..", "ignore")).initSearch().searchServer;
    const results = searchServer.search("includes mars");
    equal(results.hits.length, 2);
};
if (!module.parent)
    TestRacer.testSingleFile(__filename, testTree);
