const path = require("path")
const fs = require("fs")
const lodash = require("lodash")

const { TreeNode, TreeEvents } = require("jtree/products/TreeNode.js")
const { HandGrammarProgram, GrammarConstants } = require("jtree/products/GrammarLanguage.js")
const { Disk } = require("jtree/products/Disk.node.js")
const { Utils } = require("jtree/products/Utils.js")
const { Table } = require("jtree/products/jtable.node.js")
const grammarNode = require("jtree/products/grammar.nodejs.js")

declare type stringMap = { [firstWord: string]: any }
declare type fileName = string
declare type filepath = string
declare type treeNode = any

interface ColumnInterface {
  Column: string
  Values: number
  Coverage: string
  Example: string
  Source: string
  SourceLink: string
  Description: string
  Definition: string
  DefinitionLink: string
  Recommended: boolean
}

class TrueBaseFile extends TreeNode {
  id = this.getWord(0)

  toScroll() {
    const prevPage = this.getPrevious().permalink
    const nextPage = this.getNext().permalink
    const title = this.get("title")
    const description = this.get("description")
    return `import ../header.scroll
viewSourceUrl ${this.sourceUrl}
keyboardNav ${prevPage} ${nextPage}
html <a class="trueBaseThemePreviousItem" href="${prevPage}">&lt;</a><a class="trueBaseThemeNextItem" href="${nextPage}">&gt;</a>

title ${title}

${description ? description : ""}

code
 ${this.childrenToString().replace(/\n/g, "\n ")}

import ../footer.scroll`
  }

  writeScrollFileIfChanged(folder: string) {
    Disk.writeIfChanged(path.join(folder, this.id + ".scroll"), this.toScroll())
  }

  get missingColumns() {
    return (this.parent.columnDocumentation as ColumnInterface[])
      .filter(col => col.Description !== "computed")
      .filter(col => !col.Column.includes("."))
      .filter(col => !this.has(col.Column))
  }

  get missingRecommendedColumns() {
    return this.missingColumns.filter(col => col.Recommended === true)
  }

  get webPermalink() {
    return `/truebase/${this.permalink}`
  }

  get permalink() {
    return this.id + ".html"
  }

  get link() {
    return `<a href="${this.webPermalink}">${this.get("title")}</a>`
  }

  get type() {
    return ""
  }

  getAll(keyword: string) {
    return this.findNodes(keyword).map((node: any) => node.content)
  }

  getTypedValue(dotPath: string) {
    const value = dotPath.includes(".") ? lodash.get(this.typed, dotPath) : this.typed[dotPath]
    const typeOfValue = typeof value
    if (typeOfValue === "object" && !Array.isArray(typeOfValue))
      // JSON and Tree Notation are not naturally isomorphic. This accounts for trees with content.
      return this.get(dotPath.replace(".", " "))
    return value
  }

  selectAsObject(columnNames: string[]) {
    const obj: any = {}
    columnNames.forEach((dotPath: string) => (obj[dotPath] = this.getTypedValue(dotPath)))
    return obj
  }

  get rank() {
    return this.getIndex()
  }

  get title() {
    return this.get("title") || this.id
  }

  get lowercase() {
    return this.toString().toLowerCase()
  }

  get lowercaseNames() {
    return this.names.map(name => name.toLowerCase())
  }

  get names() {
    return [this.id, this.title]
  }

  get linksToOtherFiles() {
    return lodash.uniq(
      this.parsed
        .getTopDownArray()
        .filter((node: TrueBaseFile) => node.containsTrueBaseIds)
        .map((node: TrueBaseFile) => node.getWordsFrom(1))
        .flat()
    )
  }

  doesLinkTo(id: string) {
    return this.linksToOtherFiles.includes(id)
  }

  private _diskVersion: string
  setDiskVersion() {
    this._diskVersion = this.childrenToString()
    return this
  }

  getDiskVersion() {
    return this._diskVersion
  }

  getDoc(terms: string[]) {
    return terms
      .map(term => {
        const nodes = this.findNodes(this._getFilePath() + " " + term)
        return nodes.map((node: treeNode) => node.childrenToString()).join("\n")
      })
      .filter(identity => identity)
      .join("\n")
  }

  set(keywordPath: any, content: any) {
    return typeof keywordPath === "object" ? this.setProperties(keywordPath) : super.set(keywordPath, content)
  }

  save() {
    const str = this.childrenToString()
    if (this.getDiskVersion() === str) return this

    Disk.write(this._getFilePath(), str)
    this.setDiskVersion()
    return this
  }

  appendUniqueLine(line: string) {
    const file = this.toString()
    if (file.match(new RegExp("^" + Disk.escape(line), "m"))) return true
    const prefix = !file || file.endsWith("\n") ? "" : "\n"
    return this.appendLine(prefix + line + "\n")
  }

  private _getFilePath() {
    return this.parent.makeFilePath(this.id)
  }

  getFileName() {
    return Disk.getFileName(this._getFilePath())
  }

  createParser() {
    return new TreeNode.Parser(TreeNode)
  }

  updateTrueBaseIds(oldTrueBaseId: string, newTrueBaseId: string) {
    this.parsed
      .getTopDownArray()
      .filter((node: TrueBaseFile) => node.containsTrueBaseIds)
      .map((node: TrueBaseFile) =>
        node.setContent(
          node
            .getWordsFrom(1)
            .map((word: string) => (word === oldTrueBaseId ? newTrueBaseId : word))
            .join(" ")
        )
      )
    this.setChildren(this.parsed.childrenToString())
    this.save()
  }

  get factCount() {
    return this.parsed.getTopDownArray().filter((node: any) => node.shouldSerialize !== false).length
  }

  get parsed() {
    if (!this.quickCache.parsed) {
      const programParser = this.parent.grammarProgramConstructor
      this.quickCache.parsed = new programParser(this.childrenToString())
    }
    return this.quickCache.parsed
  }

  get typed() {
    return this.parsed.typedTuple[1]
  }

  sort() {
    this.setChildren(
      this.parsed
        .sortFromSortTemplate()
        .toString()
        .replace(/\n\n+/g, "\n\n")
        .replace(/\n+$/g, "") + "\n"
    )
  }

  prettifyAndSave() {
    this.sort()
    this.save()
    return this
  }
}

class TrueBaseFolder extends TreeNode {
  computedColumnNames: string[] = []
  globalSortFunction = (item: object) => -Object.keys(item).length // By default show the items with most cells filled up top.
  gitRepoPath = "https://github.com/breck7/truebase"
  defaultColumnSortOrder = ["title"]
  dir = ""
  grammarDir = ""
  grammarCode = ""
  grammarProgramConstructor: any = undefined
  fileExtension = ""
  baseUrl = ""
  sourceFilename = Utils.getFileName(__filename)

  get filesWithInvalidFilenames() {
    return this.filter((file: TrueBaseFile) => file.id !== Utils.titleToPermalink(file.id))
  }

  get searchIndex() {
    if (!this.quickCache.searchIndex) this.quickCache.searchIndex = this.makeNameSearchIndex(this)
    return this.quickCache.searchIndex
  }

  get bytes() {
    if (!this.quickCache.bytes) this.quickCache.bytes = this.toString().length
    return this.quickCache.bytes
  }

  get factCount() {
    if (!this.quickCache.factCount) this.quickCache.factCount = lodash.sum(this.map((file: TrueBaseFile) => file.factCount))
    return this.quickCache.factCount
  }

  get nodesForCsv() {
    if (this.quickCache.nodesForCsv) return this.quickCache.nodesForCsv
    const { computedColumnNames } = this
    this.quickCache.nodesForCsv = this.map((file: TrueBaseFile) => {
      const clone = file.parsed.clone()
      clone.getTopDownArray().forEach((node: any) => {
        if (node.includeChildrenInCsv === false) node.deleteChildren()
        if (node.getNodeTypeId() === "blankLineNode") node.destroy()
      })

      computedColumnNames.forEach(prop => {
        const value = file[prop]
        if (value !== undefined) clone.set(prop, value.toString())
      })

      return clone
    })
    return this.quickCache.nodesForCsv
  }

  get objectsForCsv() {
    if (!this.quickCache.objectsForCsv)
      this.quickCache.objectsForCsv = lodash.sortBy(
        this.nodesForCsv.map((node: treeNode) => node.toFlatObject()),
        this.globalSortFunction
      )
    return this.quickCache.objectsForCsv
  }

  get grammarFileMap() {
    if (this.quickCache.grammarFileMap) return this.quickCache.grammarFileMap
    this.quickCache.grammarFileMap = {}
    const map = this.quickCache.grammarFileMap
    this.grammarFilePaths.forEach((filepath: string) => (map[filepath] = Disk.read(filepath)))
    return map
  }

  get pageRankLinks() {
    if (this.quickCache.pageRankLinks) return this.quickCache.pageRankLinks

    this.quickCache.pageRankLinks = {}
    const pageRankLinks = this.quickCache.pageRankLinks
    this.forEach((file: any) => {
      pageRankLinks[file.id] = []
    })

    this.forEach((file: any) => {
      file.linksToOtherFiles.forEach((link: any) => {
        if (!pageRankLinks[link]) throw new Error(`Broken permalink in '${file.id}': No language "${link}" found`)

        pageRankLinks[link].push(file.id)
      })
    })

    return pageRankLinks
  }

  // todo: is there already a way to do this in jtree?
  getFilePathAndLineNumberWhereGrammarNodeIsDefined(nodeTypeId: string) {
    const { grammarFileMap } = this
    const regex = new RegExp(`^${nodeTypeId}`, "gm")
    let filePath: string
    let lineNumber: number
    Object.keys(grammarFileMap).some(grammarFilePath => {
      const code = grammarFileMap[grammarFilePath]
      if (grammarFileMap[grammarFilePath].match(regex)) {
        filePath = grammarFilePath
        lineNumber = code.split("\n").indexOf(nodeTypeId)
        return true
      }
    })
    return { filePath, lineNumber }
  }

  get colNameToGrammarDefMap() {
    if (this.quickCache.colNameToGrammarDefMap) return this.quickCache.colNameToGrammarDefMap
    this.quickCache.colNameToGrammarDefMap = new Map()
    const map = this.quickCache.colNameToGrammarDefMap
    this.nodesForCsv.forEach((node: any) => {
      node.getTopDownArray().forEach((node: any) => {
        const path = node.getFirstWordPath().replace(/ /g, ".")
        map.set(path, node.getDefinition())
      })
    })
    return map
  }

  get colNamesForCsv() {
    return this.columnDocumentation.map((col: any) => col.Column)
  }

  makeCsv(filename: string, objectsForCsv = this.objectsForCsv) {
    if (this.quickCache[filename]) return this.quickCache[filename]
    const { colNamesForCsv } = this
    this.quickCache[filename] = new TreeNode(objectsForCsv).toDelimited(",", colNamesForCsv)
    return this.quickCache[filename]
  }

  get sources() {
    const sources = Array.from(
      new Set(
        this.grammarCode
          .split("\n")
          .filter(line => line.includes("string sourceDomain"))
          .map(line => line.split("string sourceDomain")[1].trim())
      )
    )
    return sources.sort()
  }

  get columnsCsvOutput() {
    const columnsMetadataTree = new TreeNode(this.columnDocumentation)
    const columnMetadataColumnNames = ["Index", "Column", "Values", "Coverage", "Example", "Description", "Source", "SourceLink", "Definition", "DefinitionLink"]

    const columnsCsv = columnsMetadataTree.toDelimited(",", columnMetadataColumnNames)

    return {
      columnsCsv,
      columnsMetadataTree,
      columnMetadataColumnNames
    }
  }

  get columnDocumentation(): ColumnInterface[] {
    if (this.quickCache.columnDocumentation) return this.quickCache.columnDocumentation

    // Return columns with documentation sorted in the most interesting order.

    const { colNameToGrammarDefMap, objectsForCsv, gitRepoPath, defaultColumnSortOrder } = this
    const colNames = new TreeNode(objectsForCsv)
      .toCsv()
      .split("\n")[0]
      .split(",")
      .map((col: string) => {
        return { name: col }
      })
    const table = new Table(objectsForCsv, colNames, undefined, false) // todo: fix jtable or switch off
    const cols = table
      .getColumnsArray()
      .map((col: any) => {
        const reductions = col.getReductions()
        const Column = col.getColumnName()
        const colDef = colNameToGrammarDefMap.get(Column)
        let colDefId
        if (colDef) colDefId = colDef.getLine()
        else colDefId = ""

        const Example = reductions.mode
        const Description = colDefId !== "" && colDefId !== "errorNode" ? colDef.get("description") : "computed"
        let Source
        if (colDef) Source = colDef.getFrom("string sourceDomain")
        else Source = ""

        const sourceLocation = this.getFilePathAndLineNumberWhereGrammarNodeIsDefined(colDefId)
        if (!sourceLocation.filePath) throw new Error(`Could not find source file for column '${Column}'`)

        const Definition = colDefId !== "" && colDefId !== "errorNode" ? path.basename(sourceLocation.filePath) : "A computed value"
        const DefinitionLink =
          colDefId !== "" && colDefId !== "errorNode" ? `${gitRepoPath}/blob/main/truebase/grammar/${Definition}#L${sourceLocation.lineNumber + 1}` : `${gitRepoPath}/blob/main/code/${this.sourceFilename}#:~:text=get%20${Column}()`
        const SourceLink = Source ? `https://${Source}` : ""
        return {
          Column,
          Values: reductions.count,
          Coverage: Math.round((100 * reductions.count) / (reductions.count + reductions.incompleteCount)) + "%",
          Example,
          Source,
          SourceLink,
          Description,
          Definition,
          DefinitionLink,
          Recommended: colDef && colDef.getFrom("boolean alwaysRecommended") === "true"
        }
      })
      .filter((col: any) => col.Values)

    const sortedCols: any[] = []
    defaultColumnSortOrder.forEach(colName => {
      const hit = cols.find((col: any) => col.Column === colName)
      sortedCols.push(hit)
    })

    lodash
      .sortBy(cols, "Values")
      .reverse()
      .forEach((col: any) => {
        if (!defaultColumnSortOrder.includes(col.Column)) sortedCols.push(col)
      })

    sortedCols.forEach((col, index) => (col.Index = index + 1))

    this.quickCache.columnDocumentation = sortedCols
    return sortedCols
  }

  makeNameSearchIndex(files: TrueBaseFile[] | TrueBaseFolder) {
    const map = new Map<string, TrueBaseFile>()
    files.forEach((file: TrueBaseFile) => {
      const { id } = file
      file.names.forEach(name => map.set(name.toLowerCase(), id))
    })
    return map
  }

  touch(filename: fileName) {
    // todo: throw if its a folder path, has wrong file extension, or other invalid
    return Disk.touch(path.join(this.dir, filename))
  }

  createFile(content: string, id?: string) {
    if (id === undefined) {
      const title = new TreeNode(content).get("title")
      if (!title) throw new Error(`A "title" must be provided when creating a new file`)

      id = this.makeId(title)
    }
    Disk.write(this.makeFilePath(id), content)
    return this.appendLineAndChildren(id, content)
  }

  // todo: do this properly upstream in jtree
  rename(oldTrueBaseId: string, newTrueBaseId: string) {
    const content = this.getFile(oldTrueBaseId).childrenToString()
    Disk.write(this.makeFilePath(newTrueBaseId), content)
    this.delete(oldTrueBaseId)
    this.filter((file: TrueBaseFile) => file.doesLinkTo(oldTrueBaseId)).forEach((file: TrueBaseFile) => file.updateTrueBaseIds(oldTrueBaseId, newTrueBaseId))
    this.appendLineAndChildren(newTrueBaseId, content)
  }

  getFile(id: string) {
    if (id === undefined) return undefined
    if (id.includes("/")) id = Utils.removeFileExtension(Disk.getFileName(id))
    return this.getNode(id)
  }

  makeId(title: string) {
    let id = Utils.titleToPermalink(title)
    let newId = id
    if (!this.getFile(newId)) return newId

    throw new Error(`Already file with id: "${id}". Are you sure the database doesn't have this already? Perhaps update the title to something more unique for now.`)
  }

  // WARNING: Very basic support! Not fully developed.
  // WARNING: Does not yet support having multiple tuples with the same key???will collapse those to one.
  toSQLite() {
    return this.toSQLiteCreateTables() + "\n\n" + this.toSQLiteInsertRows()
  }

  toSQLiteCreateTables() {
    this.loadFolder()

    const grammarProgram = new HandGrammarProgram(this.grammarCode)
    const tableDefinitionNodes = grammarProgram.filter((node: any) => node.getTableNameIfAny && node.getTableNameIfAny())
    // todo: filter out root root

    return tableDefinitionNodes.map((node: any) => node.toSQLiteTableSchema()).join("\n")
  }

  toSQLiteInsertRows() {
    return this.map((file: any) => file.parsed.toSQLiteInsertStatement(file.id)).join("\n")
  }

  createParser() {
    return new TreeNode.Parser(TrueBaseFile)
  }

  get typedMap() {
    this.loadFolder()
    const map: stringMap = {}
    this.forEach((file: any) => (map[file.id] = file.typed))
    return map
  }

  get typedMapJson() {
    if (!this.quickCache.typedMapJson) this.quickCache.typedMapJson = JSON.stringify(this.typedMap, null, 2)
    return this.quickCache.typedMapJson
  }

  private _isLoaded = false

  // todo: RAII?
  loadFolder() {
    if (this._isLoaded) return this
    const files = this._getAndFilterFilesFromFolder()

    this.setChildren(this._readFiles(files)) // todo: speedup?
    this._setDiskVersions()

    this._isLoaded = true
    return this
  }

  // todo: need to RAII this. Likely just not have TrueBaseFolder extend TreeNode
  setDir(dir: string, fileExtension = "") {
    this.dir = dir
    return this
  }

  setGrammarDir(dir: string) {
    this.grammarDir = dir
    const rawCode = this.grammarFilePaths.map(Disk.read).join("\n")
    this.grammarCode = new grammarNode(rawCode).format().toString()
    this.grammarProgramConstructor = new HandGrammarProgram(this.grammarCode).compileAndReturnRootConstructor()
    this.fileExtension = new this.grammarProgramConstructor().fileExtension
    return this
  }

  get grammarFilePaths() {
    return Disk.getFiles(this.grammarDir).filter((file: string) => file.endsWith(GrammarConstants.grammarFileExtension))
  }

  private _setDiskVersions() {
    // todo: speedup?
    this.forEach((file: treeNode) => file.setDiskVersion())
    return this
  }

  private _getAndFilterFilesFromFolder() {
    return this._filterFiles(Disk.getFiles(this.dir))
  }

  // todo: cleanup the filtering here.
  private _filterFiles(files: string[]) {
    if (!this.fileExtension) return files
    return files.filter((file: string) => file.endsWith(this.fileExtension))
  }

  private _fsWatcher: any

  startListeningForFileChanges() {
    this.loadFolder()
    const { dir } = this
    this._fsWatcher = fs.watch(dir, (event: any, filename: fileName) => {
      let fullPath = path.join(dir, filename)
      fullPath = this._filterFiles([fullPath])[0]
      if (!fullPath) return true

      const node = <any>this.getNode(fullPath)
      if (!Disk.exists(fullPath)) {
        this.delete(fullPath)
        this.trigger(new TreeEvents.ChildRemovedTreeEvent(node))
        this.trigger(new TreeEvents.DescendantChangedTreeEvent(node))
        return
      }

      const data = Disk.read(fullPath)
      if (!node) {
        const newNode = this.appendLineAndChildren(fullPath, data)
        this.trigger(new TreeEvents.ChildAddedTreeEvent(newNode))
        this.trigger(new TreeEvents.DescendantChangedTreeEvent(newNode))
      } else {
        node.setChildren(data)
        this.trigger(new TreeEvents.DescendantChangedTreeEvent(node))
      }
    })
  }

  stopListeningForFileChanges() {
    this._fsWatcher.close()
    delete this._fsWatcher
  }

  makeFilePath(id: string) {
    return path.join(this.dir, id + "." + this.fileExtension)
  }

  get errors() {
    let errors: any[] = []
    this.forEach((file: TrueBaseFile) => {
      const { parsed } = file
      const errs = parsed.getAllErrors()
      if (errs.length) errors = errors.concat(errs)
      const { scopeErrors } = parsed
      if (scopeErrors.length) errors = errors.concat(scopeErrors)
    })
    return errors
  }

  private _readFiles(files: filepath[]) {
    return files
      .map(fullPath => {
        const content = Disk.read(fullPath)
        if (content.match(/\r/)) throw new Error("bad \\r in " + fullPath)
        const id = Utils.getFileName(Utils.removeFileExtension(fullPath))
        return content ? id + "\n " + content.replace(/\n/g, "\n ") : id
      })
      .join("\n")
  }
}

export { TrueBaseFile, TrueBaseFolder }
