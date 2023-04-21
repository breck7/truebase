const path = require("path")
const fs = require("fs")
const lodash = require("lodash")
const numeral = require("numeral")

const { TreeNode, TreeEvents } = require("jtree/products/TreeNode.js")
const { HandGrammarProgram, GrammarConstants } = require("jtree/products/GrammarLanguage.js")
const { Disk } = require("jtree/products/Disk.node.js")
const { Utils } = require("jtree/products/Utils.js")
import { TrueBaseSettingsObject } from "./TrueBaseSettings"
const grammarParser = require("jtree/products/grammar.nodejs.js")

declare type stringMap = { [firstWord: string]: any }
declare type fileName = string
declare type filepath = string
declare type treeNode = any
declare type parserDef = treeNode

interface ColumnInterface {
  Column: string
  ColumnLink: string
  Values: number
  Missing: number
  Coverage: string
  Example: string
  Source: string
  SourceLink: string
  Description: string
  Definition: string
  DefinitionLink: string
  Recommended: boolean
}

enum SQLiteTypes {
  integer = "INTEGER",
  float = "FLOAT",
  text = "TEXT"
}

const UserFacingWarningMessages = {
  noFiles: (folderName: string) => `No files found in '${folderName}' folder`,
  noFilesWithRightExtension: (extName: string) => `No files found with extension '${extName}'.`
}

const UserFacingErrorMessages = {
  brokenPermalink: (subjectId: string, targetId: string) => `Broken permalink in '${subjectId}': No file '${targetId}' found`,
  missingColumnSourceFile: (filePath: string) => `Could not find grammar file '${filePath}'`,
  missingColumn: (colName: string, allColumnNames: string[]) => `No column found for '${colName}'. Available columns: ${allColumnNames.sort().join(" ")}`,
  titleRequired: (content: string) => `A "title" must be provided when creating a new file. Content provided:\n ${content.replace(/\n/g, "\n ")}`,
  duplicateId: (id: string) => `Already file with id: "${id}". Are you sure the database doesn't have this already? Perhaps update the title to something more unique for now.`,
  returnCharFound: (fullPath: string) => `Return character '\\r' found in '${fullPath}'. Return chars are unneeded.`
}

class TrueBaseFile extends TreeNode {
  id = this.getWord(0)

  get sourceUrl() {
    return this.parent.thingsViewSourcePath + this.filename
  }

  get helpfulResearchLinks() {
    const { id } = this
    return `<a href="/truebase/${id}.html">/truebase/${id}.html</a>`
  }

  toScroll() {
    const prevPage = this.previous.permalink
    const nextPage = this.next.permalink
    const title = this.get("title")
    const description = this.get("description")
    return `import ../header.scroll
viewSourceUrl ${this.sourceUrl}
keyboardNav ${prevPage} ${nextPage}
html <a class="trueBaseThemePreviousItem" href="${prevPage}">&lt;</a><a class="trueBaseThemeNextItem" href="${nextPage}">&gt;</a>

title ${title}

${description ? description : ""}

* Edit
 link /edit.html?id=${this.id}

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
      .filter(col => !col.Column.includes("_"))
      .filter(col => !this.has(col.Column))
  }

  get missingRecommendedColumnNames() {
    return this.missingColumns.filter(col => col.Recommended === true).map(col => col.Column)
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

  get rank() {
    return this.getIndex()
  }

  get title() {
    return this.get("title") || this.id
  }

  get lowercase() {
    return this.asString.toLowerCase()
  }

  get lowercaseNames() {
    return this.names.map(name => name.toLowerCase())
  }

  get names() {
    return [this.id, this.title]
  }

  // todo: assumes a catch all
  get linksToOtherFiles() {
    return lodash.uniq(
      this.parsed.topDownArray
        .filter((node: TrueBaseFile) => node.trueBaseIds)
        .map((node: TrueBaseFile) => node.trueBaseIds)
        .flat()
    )
  }

  updateTrueBaseIds(oldTrueBaseId: string, newTrueBaseId: string) {
    this.parsed.topDownArray.filter((node: TrueBaseFile) => node.updateTruebaseIds).map((node: TrueBaseFile) => node.updateTruebaseIds(oldTrueBaseId, newTrueBaseId))
    this.setChildren(this.parsed.childrenToString())
    this.save()
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
    const file = this.asString
    if (file.match(new RegExp("^" + Disk.escape(line), "m"))) return true
    const prefix = !file || file.endsWith("\n") ? "" : "\n"
    return this.appendLine(prefix + line + "\n")
  }

  private _getFilePath() {
    return this.parent.makeFilePath(this.id)
  }

  get filename() {
    return Disk.getFileName(this._getFilePath())
  }

  createParserCombinator() {
    return new TreeNode.ParserCombinator(TreeNode)
  }

  get factCount() {
    return this.parsed.topDownArray.filter((node: any) => node.shouldSerialize !== false).length
  }

  get topUnansweredQuestions() {
    // V1 algo is just that the questions with the most answers are the most important
    // V2 should take into account the currently answered questions
    const cols = lodash.sortBy(this.missingColumns, "Missing")
    return cols
      .map((col: ColumnInterface) => {
        const column = col.Column
        const parserDef = this.parent.getParserDefFromColumnName(column)
        if (!parserDef) return false
        return {
          column,
          question: parserDef.description
        }
      })
      .filter((i: any) => i)
  }

  get parsed() {
    if (!this.quickCache.parsed) {
      const rootParser = this.parent.rootParser
      this.quickCache.parsed = new rootParser(this.childrenToString())
    }
    return this.quickCache.parsed
  }

  get typed() {
    return this.parsed.typedTuple[1]
  }

  sort() {
    this.setChildren(this.parsed.sortFromSortTemplate().asString.replace(/\n\n+/g, "\n\n").replace(/\n+$/g, "") + "\n")
  }

  prettifyAndSave() {
    this.sort()
    this.save()
    return this
  }

  getTypedValue(dotPath: string, dot = "_") {
    const value = dotPath.includes(dot) ? lodash.get(this.typed, dotPath.replace("_", ".")) : this.typed[dotPath]
    const typeOfValue = typeof value
    if (typeOfValue === "object" && !Array.isArray(typeOfValue)) {
      // This is a little messy. JSON and Tree Notation are not naturally isomorphic. This either returns the content or the children, depending on the situation:.
      /*
// Returns content:
wikipedia someUrl
 pageViews 123

// Returns children as string:
neighbors
 Mars 232
 Venus 123
      */
      const node = this.getNode(dotPath.replace(dot, " "))
      const content = node.content
      return content ? content : node.childrenToString()
    }
    return value
  }

  selectAsObject(columnNames: string[]) {
    const obj: any = {}
    columnNames.forEach((dotPath: string) => (obj[dotPath] = this.getTypedValue(dotPath)))
    return obj
  }

  // For CSV export
  get asObject() {
    if (this.quickCache.asObject) return this.quickCache.asObject
    const { computedColumnNames } = this.parent
    const obj: any = {}
    this.parsed.topDownArray.forEach((col: any) => {
      if (col.isColumn) obj[col.columnName] = col.columnValue
    })
    computedColumnNames.forEach((colName: string) => {
      const value = this[colName]
      if (value !== undefined) obj[colName] = value.toString() // todo: do we need to do this here?
    })
    this.quickCache.asObject = obj
    return obj
  }

  get asSQLiteInsertStatement() {
    const { id, parsed } = this
    const tableName = this.parent.tableName
    const columns = this.parent.sqliteTableColumns
    const hits = columns.filter((colDef: any) => this.has(colDef.columnName))

    const values = hits.map((colDef: any) => {
      const node = parsed.getNode(colDef.columnName)
      let content = node.content
      const hasChildren = node.length
      const isText = colDef.type === SQLiteTypes.text
      if (content && hasChildren) content = node.contentWithChildren.replace(/\n/g, "\\n")
      else if (hasChildren) content = node.childrenToString().replace(/\n/g, "\\n")
      return isText || hasChildren ? `"${content}"` : content
    })

    hits.unshift({ columnName: "id", type: SQLiteTypes.text })
    values.unshift(`"${id}"`)
    return `INSERT INTO ${tableName} (${hits.map((col: any) => col.columnName).join(",")}) VALUES (${values.join(",")});`
  }
}

class TrueBaseFolder extends TreeNode {
  globalSortFunction = (item: object) => -Object.keys(item).length // By default show the items with most cells filled up top.
  rootParser: any = undefined // The root parser as defined by the Grammar files in a TrueBase

  dir = ""
  grammarDir = ""
  grammarCode = ""
  fileExtension = ""

  // todo: move these to .truebase settings file
  computedColumnNames: string[] = []
  thingsViewSourcePath = `/things/`
  grammarViewSourcePath = `/grammar/`
  computedsViewSourcePath = ``

  settings: TrueBaseSettingsObject
  setSettings(settings: TrueBaseSettingsObject) {
    this.settings = settings
    this.dir = settings.thingsFolder
    this.grammarDir = settings.grammarFolder
    const rawCode = this.grammarFilePaths.map(Disk.read).join("\n")
    this.grammarCode = new grammarParser(rawCode).format().asString
    this.grammarProgram = new HandGrammarProgram(this.grammarCode)
    this.rootParser = this.grammarProgram.compileAndReturnRootParser()
    this.fileExtension = new this.rootParser().fileExtension
    return this
  }

  get filesWithInvalidFilenames() {
    return this.filter((file: TrueBaseFile) => file.id !== Utils.titleToPermalink(file.id))
  }

  get searchIndex() {
    if (!this.quickCache.searchIndex) this.quickCache.searchIndex = this.makeNameSearchIndex(this)
    return this.quickCache.searchIndex
  }

  get bytes() {
    if (!this.quickCache.bytes) this.quickCache.bytes = this.asString.length
    return this.quickCache.bytes
  }

  get dashboard() {
    const { columnDocumentation } = this
    const complete = lodash.sum(columnDocumentation.map(col => col.Values))
    const missing = lodash.sum(columnDocumentation.map(col => col.Missing))
    const linksToOtherFiles = lodash.sum(this.map((file: any) => file.linksToOtherFiles.length))
    const urlCells = this.cellIndex["urlCell"].length
    return `dashboard
 ${numeral(this.length).format("0,0")} Files
 ${numeral(this.bytes).format("0,0")} Bytes
 ${numeral(this.numberOfLines).format("0,0")} Lines
 ${numeral(this.numberOfWords).format("0,0")} Words
 ${this.colNamesForCsv.length} Columns
 ${numeral(complete).format("0,0")} Filled
 ${numeral(missing).format("0,0")} Missing
 ${numeral(linksToOtherFiles).format("0,0")} File links
 ${numeral(urlCells).format("0,0")} URLs`
  }

  get cellIndex() {
    if (this.quickCache.cellIndex) return this.quickCache.cellIndex
    const cellIndex: any = {}
    this.forEach((file: any) => {
      file.parsed.programAsCells.forEach((line: any) => {
        line.forEach((cell: any) => {
          if (cell) {
            if (!cellIndex[cell.cellTypeId]) cellIndex[cell.cellTypeId] = []
            cellIndex[cell.cellTypeId].push(cell)
          }
        })
      })
    })
    this.quickCache.cellIndex = cellIndex
    return cellIndex
  }

  get factCount() {
    if (!this.quickCache.factCount) this.quickCache.factCount = lodash.sum(this.map((file: TrueBaseFile) => file.factCount))
    return this.quickCache.factCount
  }

  get objectsForCsv() {
    if (!this.quickCache.objectsForCsv) {
      const objects = this.map((file: TrueBaseFile) => file.asObject)
      this.quickCache.objectsForCsv = lodash.sortBy(objects, this.globalSortFunction)

      const colStats: any = {}
      const { colNamesForCsv, computedColumnNames } = this
      const colNames = colNamesForCsv.concat(computedColumnNames)
      objects.forEach((obj: any) => {
        colNames.forEach((colName: string) => {
          if (!colStats[colName]) colStats[colName] = { missingCount: 0 }
          const stats = colStats[colName]
          const value = obj[colName]
          if (value === undefined) stats.missingCount++
          else if (stats.example === undefined) stats.example = value
        })
      })
      this.quickCache.colStats = colStats
    }
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
        if (!pageRankLinks[link]) throw new Error(UserFacingErrorMessages.brokenPermalink(file.id, link))

        pageRankLinks[link].push(file.id)
      })
    })

    return pageRankLinks
  }

  // todo: is there already a way to do this in jtree? there should be, if not.
  getFilePathAndLineNumberWhereParserIsDefined(parserId: string) {
    const { grammarFileMap } = this
    const regex = new RegExp(`^ *${parserId}`, "gm") // todo: this will break for scoped parsers
    let filePath: string
    let lineNumber: number
    Object.keys(grammarFileMap).some(grammarFilePath => {
      const code = grammarFileMap[grammarFilePath]
      if (grammarFileMap[grammarFilePath].match(regex)) {
        filePath = grammarFilePath
        lineNumber = code.split("\n").indexOf(parserId)
        return true
      }
    })
    return { filePath, lineNumber }
  }

  get colNameToParserDefMap() {
    if (this.quickCache.colNameToParserDefMap) return this.quickCache.colNameToParserDefMap
    const map = new Map()
    this.concreteColumnDefinitions.forEach((def: any) => map.set(def.cruxPathAsColumnName, def)) // todo: handle nested definitions
    this.quickCache.colNameToParserDefMap = map
    return map
  }

  getParserDefFromColumnName(columnName: string) {
    return this.colNameToParserDefMap.get(columnName)
  }

  get concreteColumnDefinitions() {
    if (this.quickCache.concreteColumnDefinitions) return this.quickCache.concreteColumnDefinitions
    this.quickCache.concreteColumnDefinitions = this.grammarProgram.getNode("abstractTrueBaseColumnParser").concreteDescendantDefinitions
    return this.quickCache.concreteColumnDefinitions
  }

  get colNamesForCsv() {
    if (this.quickCache.colNamesForCsv) return this.quickCache.colNamesForCsv
    // todo: nested columns?
    this.quickCache.colNamesForCsv = this.concreteColumnDefinitions.map((def: any) => def.cruxPathAsColumnName)
    return this.quickCache.colNamesForCsv
  }

  makeCsv(filename: string, objectsForCsv = this.objectsForCsv) {
    if (this.quickCache[filename]) return this.quickCache[filename]
    const { columnNamesSortedByMostInteresting } = this
    this.quickCache[filename] = new TreeNode(objectsForCsv).toDelimited(",", columnNamesSortedByMostInteresting)
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
    const columnMetadataColumnNames = ["Index", "Column", "ColumnLink", "Values", "Coverage", "Example", "Description", "Source", "SourceLink", "Definition", "DefinitionLink"]

    const columnsCsv = columnsMetadataTree.toDelimited(",", columnMetadataColumnNames)

    return {
      columnsCsv,
      columnsMetadataTree,
      columnMetadataColumnNames
    }
  }

  get columnNamesSortedByMostInteresting() {
    return this.columnDocumentation.map(col => col.Column)
  }

  get columnDocumentation(): ColumnInterface[] {
    if (this.quickCache.columnDocumentation) return this.quickCache.columnDocumentation

    // Return columns with documentation sorted in the most interesting order.
    const names = this.colNamesForCsv.concat(this.computedColumnNames)

    const { colNameToParserDefMap, objectsForCsv, grammarViewSourcePath, computedsViewSourcePath } = this
    const columnOrder = this.settings.columnOrder ? this.settings.columnOrder.split(" ") : ["title"]
    const colStats = this.quickCache.colStats
    const fileCount = this.length
    const cols = names.map((Column: string) => {
      const parserDef = colNameToParserDefMap.get(Column)
      let colDefId
      if (parserDef) colDefId = parserDef.getLine()
      else colDefId = ""
      const stats = colStats[Column]
      const Missing = stats.missingCount
      const Values = fileCount - Missing
      const Example = stats.example !== undefined ? stats.example.toString().replace(/\n/g, " ").substr(0, 30) : ""
      const Description = colDefId !== "" && colDefId !== "errorParser" ? parserDef.description : "computed"
      let Source
      if (parserDef) Source = parserDef.getFrom("string sourceDomain")
      else Source = ""

      const columnsToSelect = Column.includes("_") ? [Column, Column.split("_")[0]].join("+") : Column
      const ColumnLink = `search.html?q=select+${columnsToSelect}%0D%0AnotMissing+${Column}%0D%0AsortBy+${Column}%0D%0Areverse`
      const sourceLocation = this.getFilePathAndLineNumberWhereParserIsDefined(colDefId)
      if (!sourceLocation.filePath) throw new Error(UserFacingErrorMessages.missingColumnSourceFile(sourceLocation.filePath))

      const Definition = colDefId !== "" && colDefId !== "errorParser" ? path.basename(sourceLocation.filePath) : "A computed value"
      const DefinitionLink = colDefId !== "" && colDefId !== "errorParser" ? `${grammarViewSourcePath}${Definition}#L${sourceLocation.lineNumber + 1}` : `${computedsViewSourcePath}#:~:text=get%20${Column}()`
      const SourceLink = Source ? `https://${Source}` : ""
      return {
        Column,
        ColumnLink,
        Values,
        Missing,
        Coverage: Math.round((100 * Values) / (Values + Missing)) + "%",
        Example,
        Source,
        SourceLink,
        Description,
        Definition,
        DefinitionLink,
        Recommended: parserDef && parserDef.getFrom("boolean alwaysRecommended") === "true"
      }
    })

    const sortedCols: any[] = []
    columnOrder.forEach(colName => {
      const hit = cols.find((col: any) => col.Column === colName)
      if (!hit)
        throw new Error(
          UserFacingErrorMessages.missingColumn(
            colName,
            cols.map((col: any) => col.Column)
          )
        )
      sortedCols.push(hit)
    })

    lodash
      .sortBy(cols, "Values")
      .reverse()
      .forEach((col: any) => {
        if (!columnOrder.includes(col.Column)) sortedCols.push(col)
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
      if (!title) throw new Error(UserFacingErrorMessages.titleRequired(content))

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

    throw new Error(UserFacingErrorMessages.duplicateId(id))
  }

  // WARNING: Very basic support! Not fully developed.
  // WARNING: Does not yet support having multiple tuples with the same key—will collapse those to one.
  get asSQLite() {
    return this.sqliteCreateTables + "\n\n" + this.sqliteInsertRows
  }

  get tableName() {
    return this.fileExtension
  }

  get sqliteCreateTables() {
    this.loadFolder()
    const columns = this.sqliteTableColumns.map((columnDef: any) => `${columnDef.columnName} ${columnDef.type}`)
    return `create table ${this.tableName} (
 id TEXT NOT NULL PRIMARY KEY,
 ${columns.join(",\n ")}
);`
  }

  get sqliteTableColumns() {
    return this.concreteColumnDefinitions.map((def: any) => {
      const firstNonKeywordCellType = def.cellParser.getCellArray()[1]

      let type = SQLiteTypes.text
      if (firstNonKeywordCellType) {
        if (firstNonKeywordCellType.constructor.parserFunctionName === "parseInt") type = SQLiteTypes.integer
        else if (firstNonKeywordCellType.constructor.parserFunctionName === "parseFloat") type = SQLiteTypes.float
      }

      return {
        columnName: def.cruxPathAsColumnName,
        type
      }
    })
  }

  get sqliteInsertRows() {
    return this.map((file: TrueBaseFile) => file.asSQLiteInsertStatement).join("\n")
  }

  createParserCombinator() {
    return new TreeNode.ParserCombinator(TrueBaseFile)
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
  verbose = true

  warn(message: string) {
    if (this.verbose) console.log(message)
  }

  silence() {
    this.verbose = false
    return this
  }

  // todo: RAII?
  loadFolder() {
    if (this._isLoaded) return this

    const allFiles = Disk.getFiles(this.dir)
    if (!allFiles.length) this.warn(UserFacingWarningMessages.noFiles(this.thingsFolder))

    const files = this._filterFiles(Disk.getFiles(this.dir))
    if (!files.length) this.warn(UserFacingWarningMessages.noFilesWithRightExtension(this.fileExtension))

    this.setChildren(this._readFiles(files)) // todo: speedup?
    this._setDiskVersions()

    this._isLoaded = true
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
        if (content.match(/\r/)) throw new Error(UserFacingErrorMessages.returnCharFound(fullPath))
        const id = Utils.getFileName(Utils.removeFileExtension(fullPath))
        return content ? id + "\n " + content.replace(/\n/g, "\n ") : id
      })
      .join("\n")
  }
}

export { TrueBaseFile, TrueBaseFolder, TrueBaseSettingsObject }
