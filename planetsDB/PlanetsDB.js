#!/usr/bin/env node

const path = require("path")
const { Utils } = require("jtree/products/Utils.js")
const { TreeNode } = require("jtree/products/TreeNode.js")
const { TrueBaseServer } = require("../server/TrueBaseServer.js")

const PlanetsDB = new TrueBaseServer(TreeNode.fromDisk(path.join(__dirname, "planetsdb.truebase")).toObject())
module.exports = { PlanetsDB }

if (!module.parent) Utils.runCommand(PlanetsDB, process.argv[2], process.argv[3])
