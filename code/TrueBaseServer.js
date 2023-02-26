#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrueBaseServer = exports.SearchServer = void 0;
const fs = require("fs");
const path = require("path");
const lodash = require("lodash");
const numeral = require("numeral");
const morgan = require("morgan");
const https = require("https");
const express = require("express");
const bodyParser = require("body-parser");
const { Disk } = require("jtree/products/Disk.node.js");
const { Utils } = require("jtree/products/Utils.js");
const { TreeNode } = require("jtree/products/TreeNode.js");
const tqlNode = require("../tql/tql.nodejs.js");
const delimitedEscapeFunction = (value) => (value.includes("\n") ? value.split("\n")[0] : value);
const TrueBase_1 = require("./TrueBase");
class TrueBaseServer {
    constructor(folder, ignoreFolder) {
        this.ignoreFolder = "";
        this.notFoundPage = "Not found";
        this.folder = folder;
        const app = express();
        this.app = app;
        this.ignoreFolder = ignoreFolder;
        if (!Disk.exists(ignoreFolder))
            Disk.mkdir(ignoreFolder);
        this._initLogs();
        app.use(bodyParser.urlencoded({ extended: false }));
        app.use(bodyParser.json());
        app.use((req, res, next) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
            res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type");
            res.setHeader("Access-Control-Allow-Credentials", true);
            next();
        });
        return this;
    }
    _initLogs() {
        const { ignoreFolder, app } = this;
        const requestLog = path.join(ignoreFolder, "access.log");
        Disk.touch(requestLog);
        app.use(morgan("combined", { stream: fs.createWriteStream(requestLog, { flags: "a" }) }));
        const requestTimesLog = path.join(ignoreFolder, "requestTimes.log");
        Disk.touch(requestTimesLog);
        app.use(morgan("tiny", { stream: fs.createWriteStream(requestTimesLog, { flags: "a" }) }));
    }
    _addNotFoundRoute() {
        const { notFoundPage } = this;
        //The 404 Route (ALWAYS Keep this as the last route)
        this.app.get("*", (req, res) => res.status(404).send(notFoundPage));
    }
    serveFolder(folder) {
        this.app.use(express.static(folder));
        return this;
    }
    initSearch() {
        const searchServer = new SearchServer(this.folder, this.ignoreFolder);
        this.searchServer = searchServer;
        this.app.get("/search.json", (req, res) => res.send(searchServer.logAndRunSearch(req.query.q, "json", req.ip)));
        this.app.get("/search.csv", (req, res) => res.send(searchServer.logAndRunSearch(req.query.q, "csv", req.ip)));
        this.app.get("/search.tsv", (req, res) => res.send(searchServer.logAndRunSearch(req.query.q, "tsv", req.ip)));
        this.app.get("/search.tree", (req, res) => res.send(searchServer.logAndRunSearch(req.query.q, "tree", req.ip)));
        return this;
    }
    async applyPatch(patch) {
        const { folder } = this;
        const tree = new TreeNode(patch);
        const create = tree.getNode("create");
        const changedFiles = [];
        if (create) {
            const data = create.childrenToString();
            // todo: audit
            const validateSubmissionResults = this.validateSubmission(data);
            const newFile = folder.createFile(validateSubmissionResults.content);
            changedFiles.push(newFile);
        }
        tree.delete("create");
        tree.forEach((node) => {
            const id = Utils.removeFileExtension(node.getWord(0));
            const file = folder.getFile(id);
            if (!file)
                throw new Error(`File '${id}' not found.`);
            const validateSubmissionResults = this.validateSubmission(node.childrenToString());
            file.setChildren(validateSubmissionResults.content);
            file.prettifyAndSave();
            changedFiles.push(file);
        });
        folder.clearQuickCache();
        return changedFiles;
    }
    validateSubmission(content) {
        // Run some simple sanity checks.
        if (content.length > 200000)
            throw new Error(`Submission too large`);
        // Remove all return characters
        content = Utils.removeEmptyLines(Utils.removeReturnChars(content));
        const programParser = this.folder.grammarProgramConstructor;
        const parsed = new programParser(content);
        const errs = parsed.getAllErrors();
        if (errs.length > 3)
            throw new Error(`Too many errors detected in submission: ${JSON.stringify(errs.map((err) => err.toObject()))}`);
        const { scopeErrors } = parsed;
        if (scopeErrors.length > 3)
            throw new Error(`Too many scope errors detected in submission: ${JSON.stringify(scopeErrors.map((err) => err.toObject()))}`);
        if (parsed.length < 3)
            throw new Error(`Must provide at least 3 facts about the language.`);
        return {
            content: parsed.sortFromSortTemplate().toString()
        };
    }
    listen(port = 4444) {
        this._addNotFoundRoute();
        this.app.listen(port, () => console.log(`TrueBase server running: \ncmd+dblclick: http://localhost:${port}/`));
        return this;
    }
    listenProd() {
        this._addNotFoundRoute();
        const key = fs.readFileSync(path.join(this.ignoreFolder, "privkey.pem"));
        const cert = fs.readFileSync(path.join(this.ignoreFolder, "fullchain.pem"));
        https
            .createServer({
            key,
            cert
        }, this.app)
            .listen(443);
        const redirectApp = express();
        redirectApp.use((req, res) => res.redirect(301, `https://${req.headers.host}${req.url}`));
        redirectApp.listen(80, () => console.log(`Running redirect app`));
        return this;
    }
}
exports.TrueBaseServer = TrueBaseServer;
class SearchServer {
    constructor(trueBaseFolder, ignoreFolder) {
        this.searchCache = {};
        this._touchedLog = false;
        this.folder = trueBaseFolder;
        this.ignoreFolder = ignoreFolder;
        this.searchRequestLog = path.join(this.ignoreFolder, "searchLog.tree");
    }
    logQuery(originalQuery, ip, format = "html") {
        const tree = `search
 time ${Date.now()}
 ip ${ip}
 format ${format}
 query
  ${originalQuery.replace(/\n/g, "\n  ")} 
`;
        if (!this._touchedLog) {
            Disk.touch(this.searchRequestLog);
            this._touchedLog = true;
        }
        fs.appendFile(this.searchRequestLog, tree, function () { });
        return this;
    }
    logAndRunSearch(originalQuery = "", format = "object", ip = "") {
        this.logQuery(originalQuery, ip, format);
        return this[format](decodeURIComponent(originalQuery).replace(/\r/g, ""));
    }
    search(treeQLCode, tqlParser = tqlNode) {
        var _a, _b, _c, _d;
        const { searchCache } = this;
        if (searchCache[treeQLCode])
            return searchCache[treeQLCode];
        const startTime = Date.now();
        let hits = [];
        let errors = "";
        let columnNames = [];
        let title = "";
        let description = "";
        try {
            const treeQLProgram = new tqlParser(treeQLCode);
            const programErrors = treeQLProgram.scopeErrors.concat(treeQLProgram.getAllErrors());
            if (programErrors.length)
                throw new Error(programErrors.map((err) => err.getMessage()).join(" "));
            const sortBy = treeQLProgram.get("sortBy");
            title = treeQLProgram.get("title");
            description = treeQLProgram.get("description");
            let rawHits = treeQLProgram.filterFolder(this.folder);
            if (sortBy) {
                const sortByFns = sortBy.split(" ").map((columnName) => (file) => file.getTypedValue(columnName));
                rawHits = lodash.sortBy(rawHits, sortByFns);
            }
            if (treeQLProgram.has("reverse"))
                rawHits.reverse();
            // By default right now we basically add: select title titleLink
            // We will probably ditch that in the future and make it explicit.
            if (treeQLProgram.has("selectAll"))
                columnNames = (_d = (_b = (_a = treeQLProgram.rootGrammarTree.get("columnNameCell enum")) === null || _a === void 0 ? void 0 : _a.split(" ")) !== null && _b !== void 0 ? _b : Object.keys(((_c = rawHits[0]) === null || _c === void 0 ? void 0 : _c.typed) || undefined)) !== null && _d !== void 0 ? _d : ["title"];
            else
                columnNames = ["title", "titleLink"].concat((treeQLProgram.get("select") || "").split(" "));
            let matchingFilesAsObjectsWithSelectedColumns = rawHits.map((file) => {
                const obj = file.selectAsObject(columnNames);
                obj.titleLink = file.webPermalink;
                return obj;
            });
            const limit = treeQLProgram.get("limit");
            if (limit)
                matchingFilesAsObjectsWithSelectedColumns = matchingFilesAsObjectsWithSelectedColumns.slice(0, parseInt(limit));
            const renames = treeQLProgram.findNodes("rename").forEach((node) => {
                const oldName = node.getWord(1);
                const newName = node.getWord(2);
                matchingFilesAsObjectsWithSelectedColumns.forEach((obj) => {
                    obj[newName] = obj[oldName];
                    delete obj[oldName];
                    columnNames = columnNames.map(columnName => (oldName === columnName ? newName : columnName));
                });
            });
            hits = matchingFilesAsObjectsWithSelectedColumns;
        }
        catch (err) {
            errors = err.toString();
            console.error(err);
        }
        searchCache[treeQLCode] = { hits, queryTime: numeral((Date.now() - startTime) / 1000).format("0.00"), columnNames, errors, title, description };
        return searchCache[treeQLCode];
    }
    json(treeQLCode) {
        return JSON.stringify(this.search(treeQLCode), undefined, 2);
    }
    tree(treeQLCode) {
        return new TreeNode(this.search(treeQLCode).hits).toString();
    }
    csv(treeQLCode) {
        const { hits, columnNames } = this.search(treeQLCode);
        return new TreeNode(hits).toDelimited(",", columnNames, delimitedEscapeFunction);
    }
    tsv(treeQLCode) {
        const { hits, columnNames } = this.search(treeQLCode);
        return new TreeNode(hits).toDelimited("\t", columnNames, delimitedEscapeFunction);
    }
}
exports.SearchServer = SearchServer;
if (!module.parent) {
    const folderPath = process.cwd();
    const folder = new TrueBase_1.TrueBaseFolder().setDir(folderPath).setGrammarDir(folderPath);
    new SearchServer(folder, folderPath).csv(process.argv.slice(2).join(" "));
}
