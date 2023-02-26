#! /usr/bin/env node

const path = require("path")
const { TreeNode } = require("jtree/products/TreeNode.js")
const { Disk } = require("jtree/products/Disk.node.js")
const { GrammarCompiler } = require("jtree/products/GrammarCompiler.js")

const tqlPath = path.join(__dirname, "tql.grammar")
const tqlGrammar = new TreeNode(Disk.read(tqlPath))
// Todo: fix path problems
GrammarCompiler.compileGrammarForBrowser(tqlPath, __dirname + "/", false)
GrammarCompiler.compileGrammarForNodeJs(tqlPath, __dirname + "/", true)
