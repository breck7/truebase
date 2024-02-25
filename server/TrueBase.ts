const path = require("path")
const fs = require("fs")
const lodash = require("lodash")
const numeral = require("numeral")

const { TreeNode, TreeEvents } = require("jtree/products/TreeNode.js")
const { HandGrammarProgram, GrammarConstants } = require("jtree/products/GrammarLanguage.js")
const { Disk } = require("jtree/products/Disk.node.js")
const { Utils } = require("jtree/products/Utils.js")
import { UserFacingErrorMessages, UserFacingWarningMessages } from "./ErrorMessages"
import { TrueBaseSettingsObject } from "./TrueBaseSettings"
const grammarParser = require("jtree/products/grammar.nodejs.js")
const genericTqlParser = require("../tql/tql.nodejs.js")

declare type stringMap = { [firstWord: string]: any }
declare type fileName = string
declare type filepath = string
declare type treeNode = any
declare type parserDef = treeNode

interface ColumnInterface {
  Column: string
  NameLink: string
  Type: string
  Source: string
  SourceLink: string
  Description: string
  Definition: string
  DefinitionLink: string
  Recommended: boolean
  Computed: boolean
}

interface ColumnInterfaceWithStats extends ColumnInterface {
  Values: number
  Missing: number
  Coverage: string
  Example: string
}

enum SQLiteTypes {
  integer = "INTEGER",
  float = "FLOAT",
  text = "TEXT"
}

const resolvePath = (folder: string, baseDir: string) => (path.isAbsolute(folder) ? path.normalize(folder) : path.resolve(path.join(baseDir, folder)))

class TrueBaseFile extends TreeNode {
  id = this.getWord(0)

  get sourceUrl() {
    return this.parent.conceptsViewSourcePath + this.filename
  }

  get helpfulResearchLinks() {
    return ``
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

Edit
 link /edit.html?id=${this.id}

code
 ${this.childrenToString().replace(/\n/g, "\n ")}

import ../footer.scroll`
  }

  get missingRootColumns() {
    return (this.parent.columnDocumentation as ColumnInterfaceWithStats[])
      .filter(col => col.Computed === false)
      .filter(col => !col.Column.includes("_"))
      .filter(col => !this.has(col.Column))
  }

  get webPermalink() {
    return `/concepts/${this.permalink}`
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

  get diskVersion() {
    return this._diskVersion
  }

  getDoc(terms: string[]) {
    return terms
      .map(term => {
        const nodes = this.findNodes(this.filepath + " " + term)
        return nodes.map((node: treeNode) => node.childrenToString()).join("\n")
      })
      .filter(identity => identity)
      .join("\n")
  }

  set(keywordPath: any, content: any) {
    return typeof keywordPath === "object" ? this.setProperties(keywordPath) : super.set(keywordPath, content)
  }

  get hasChanges() {
    return this.diskVersion !== this.childrenToString()
  }

  save() {
    if (!this.hasChanges) return this

    Disk.write(this.filepath, this.childrenToString())
    this.setDiskVersion()
    return this
  }

  appendUniqueLine(line: string) {
    const file = this.asString
    if (file.match(new RegExp("^" + Disk.escape(line), "m"))) return true
    const prefix = !file || file.endsWith("\n") ? "" : "\n"
    return this.appendLine(prefix + line + "\n")
  }

  get filepath() {
    return this.parent.makeFilePath(this.id)
  }

  get filename() {
    return Disk.getFileName(this.filepath)
  }

  createParserCombinator() {
    return new TreeNode.ParserCombinator(TreeNode)
  }

  get factCount() {
    return this.parsed.topDownArray.filter((node: any) => node.shouldSerialize !== false).length
  }

  get similarFiles() {
    if (!this.has("type"))
      // todo: add another similarity metric
      return this.parent.getChildren()
    const type = this.get("type")
    return this.parent.where("type", "includes", type)
  }

  get topMissingMeasurements() {
    const types = this.get("type")
    if (types) return this.parent.getTopMeasuresForTypes(types).filter((entry: any) => !this.has(entry.column))

    return this.parent.computeColumnStats(this.parent.getChildren()).filter((entry: any) => !this.has(entry.column))
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
    if (this.parent.isComputedColumn(dotPath)) return this[dotPath]

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

  get filledColumnNames() {
    return Object.keys(this.asObject)
  }

  // For CSV export
  get asObject() {
    if (this.quickCache.asObject) return this.quickCache.asObject
    const { computedColumnNames } = this.parent
    const obj: any = {}
    this.parsed.topDownArray.forEach((col: any) => {
      if (col.isColumn) obj[col.columnName] = col.columnValue
    })
    // Currently computed columns are an advanced features only used in PLDB. They require extending
    // the TrueBase File class and defining a Parser Definition in Grammar with the same column name
    // as the getter in the extended File class.
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
  conceptsViewSourcePath = `/concepts/`
  measuresViewSourcePath = `/measures/`

  settings: TrueBaseSettingsObject
  setSettings(settings: TrueBaseSettingsObject) {
    this.settings = settings
    this.dir = settings.conceptsFolder
    this.queriesFolder = settings.queriesFolder
    this.grammarDir = settings.measuresFolder
    const rawCode = this.grammarFilePaths.map(Disk.read).join("\n")
    this.grammarCode = new grammarParser(rawCode).format().asString
    this.grammarProgram = new HandGrammarProgram(this.grammarCode)
    this.rootParser = this.grammarProgram.compileAndReturnRootParser()
    this.fileExtension = new this.rootParser().fileExtension
    return this
  }

  setSettingsFromPath(settingsFilepath: string) {
    const settings = TreeNode.fromDisk(settingsFilepath).toObject()
    const dirname = path.dirname(settingsFilepath)
    settings.measuresFolder = resolvePath(settings.measuresFolder, dirname)
    settings.conceptsFolder = resolvePath(settings.conceptsFolder, dirname)
    settings.queriesFolder = resolvePath(settings.queriesFolder, dirname)
    return this.setSettings(settings)
  }

  _queriesTree: any
  get queriesTree() {
    if (this._queriesTree) return this._queriesTree

    const allFiles = Disk.getFiles(this.queriesFolder)
    if (!allFiles.length) this.warn(UserFacingWarningMessages.noFiles(this.queriesFolder))

    const files = Disk.getFiles(this.queriesFolder).filter((file: string) => file.endsWith(".tql"))
    if (!files.length) this.warn(UserFacingWarningMessages.noFilesWithRightExtension(".tql"))

    this._queriesTree = new TreeNode(this._readFiles(files))
    return this._queriesTree
  }

  computeColumnStats(files: TrueBaseFile[]) {
    const columnsToFill: any = {}
    const columnsInSimilarFiles = files.map((file: TrueBaseFile) => {
      file
        .getFirstWords()
        .filter((i: string) => i)
        .forEach((columnName: string) => {
          if (!columnsToFill[columnName]) columnsToFill[columnName] = { columnName, count: 0, parserDef: this.getParserDefFromColumnName(columnName) }
          columnsToFill[columnName].count++
        })
    })

    return lodash.sortBy(Object.values(columnsToFill), "count").map((entry: any) => {
      return {
        column: entry.columnName,
        question: entry.parserDef.description
      }
    })
  }

  getTopMeasuresForTypes(types: string) {
    if (!this.quickCache.measuresForType) this.quickCache.measuresForType = {}
    if (!this.quickCache.measuresForType[types]) this.quickCache.measuresForType[types] = this.computeColumnStats(this.where("type", "=", types))
    return this.quickCache.measuresForType[types]
  }

  get filesWithInvalidFilenames() {
    return this.filter((file: TrueBaseFile) => file.id !== Utils.titleToPermalink(file.id))
  }

  get searchIndex() {
    if (!this.quickCache.searchIndex) this.quickCache.searchIndex = this.makeNameSearchIndex(this)
    return this.quickCache.searchIndex
  }

  get hasChanges() {
    return this.getChildren().some((file: TrueBaseFile) => file.hasChanges)
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
    const urlCells = this.cellIndex["urlCell"] ? this.cellIndex["urlCell"].length : 0
    return `dashboard
 ${numeral(this.length).format("0,0")} Concepts
 ${this.colNamesForCsv.length} Measures
 ${numeral(complete).format("0,0")} Filled
 ${numeral(missing).format("0,0")} Missing
 ${numeral(linksToOtherFiles).format("0,0")} Concept links
 ${numeral(urlCells).format("0,0")} URLs
 ${numeral(this.queriesTree.length).format("0,0")} Queries
 ${numeral(this.bytes).format("0,0")} Bytes
 ${numeral(this.numberOfLines).format("0,0")} Lines
 ${numeral(this.numberOfWords).format("0,0")} Words`
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
      const { colNamesForCsv } = this
      objects.forEach((obj: any) => {
        colNamesForCsv.forEach((colName: string) => {
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

  isComputedColumn(name: string) {
    if (!this.quickCache.computedColumnNamesMap) this.quickCache.computedColumnNamesMap = new Set(this.computedColumnNames)
    return this.quickCache.computedColumnNamesMap.has(name)
  }

  get computedColumnNames() {
    if (this.quickCache.computedColumnNames) return this.quickCache.computedColumnNames
    this.quickCache.computedColumnNames = this.basicColumnDocumentation.filter(col => col.Computed).map(col => col.Column)
    return this.quickCache.computedColumnNames
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
    const columnMetadataColumnNames = ["Index", "Name", "NameLink", "Question", "Example", "Values", "Coverage", "Type", "Source", "SourceLink", "Definition", "DefinitionLink"]

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

  get basicColumnDocumentation(): ColumnInterface[] {
    if (this.quickCache.basicColumnDocumentation) return this.quickCache.basicColumnDocumentation

    const { colNameToParserDefMap, measuresViewSourcePath } = this
    const columnOrder = this.settings.columnOrder ? this.settings.columnOrder.split(" ") : ["title"]
    const cols = this.colNamesForCsv.map((Column: string) => {
      const parserDef = colNameToParserDefMap.get(Column)
      const Computed = parserDef.constantsObject.isComputed === true
      const colDefId = parserDef.getLine()
      const Description = parserDef.description
      const Source = parserDef.getFrom("string sourceDomain")
      const Type = parserDef.constantsObject.typeForCsvDocs
      const columnsToSelect = Column.includes("_") ? [Column, Column.split("_")[0]].join("+") : Column
      const NameLink = `search.html?q=select+${columnsToSelect}%0D%0AnotMissing+${Column}%0D%0AsortBy+${Column}%0D%0Areverse`
      const sourceLocation = this.getFilePathAndLineNumberWhereParserIsDefined(colDefId)
      if (!sourceLocation.filePath) throw new Error(UserFacingErrorMessages.missingColumnSourceFile(sourceLocation.filePath))

      const Definition = path.basename(sourceLocation.filePath)
      const DefinitionLink = `${measuresViewSourcePath}${Definition}#L${sourceLocation.lineNumber + 1}`
      const SourceLink = Source ? `https://${Source}` : ""
      return {
        Column,
        Name: Column,
        NameLink,
        Type,
        Source,
        SourceLink,
        Description,
        Definition,
        Question: Description,
        DefinitionLink,
        Computed,
        Recommended: parserDef && parserDef.getFrom("boolean alwaysRecommended") === "true"
      }
    })
    this.quickCache.basicColumnDocumentation = cols
    return cols
  }

  get sparsityVectors() {
    const columns = lodash.sortBy(this.columnDocumentation.map(col => col.Values)).reverse()
    const rows = lodash.sortBy(this.map((file: TrueBaseFile) => file.filledColumnNames.length)).reverse()
    return {
      columns,
      rows
    }
  }

  get columnDocumentation(): ColumnInterfaceWithStats[] {
    if (this.quickCache.columnDocumentation) return this.quickCache.columnDocumentation

    const columnOrder = this.settings.columnOrder ? this.settings.columnOrder.split(" ") : ["title"]
    const objectsForCsv = this.objectsForCsv // todo: we are doing this to warm cache. cleanup
    const colStats = this.quickCache.colStats
    const fileCount = this.length
    const cols = this.basicColumnDocumentation.map((col: ColumnInterface) => {
      const Column = col.Column
      const stats = colStats[Column]
      const Missing = stats.missingCount
      const Values = fileCount - Missing
      const Example = stats.example !== undefined ? stats.example.toString().replace(/\n/g, " ").substr(0, 30) : ""
      return {
        ...col,
        Values,
        Missing,
        Coverage: Math.round((100 * Values) / (Values + Missing)) + "%",
        Example
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
    return this.concreteColumnDefinitions
      .filter((def: parserDef) => !def.constantsObject.isComputed)
      .map((def: parserDef) => {
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
    if (!allFiles.length) this.warn(UserFacingWarningMessages.noFiles(this.conceptsFolder))

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

const delimitedEscapeFunction = (value: any) => (value.includes("\n") ? value.split("\n")[0] : value)
const escapeHtml = (str: string) => str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;")
const delimiter = " DeLiM "

const transposeArray = (arrayOfObjects: any[]) => {
  let transposed: any = {}

  arrayOfObjects.forEach(obj => {
    for (let property in obj) {
      if (property !== "id") {
        if (!transposed[property]) transposed[property] = { Column: property }
        transposed[property][obj.id] = obj[property]
      }
    }
  })

  return Object.values(transposed)
}

class SearchServer {
  constructor(trueBaseFolder: TrueBaseFolder, ignoreFolder: string, tqlParser = genericTqlParser) {
    this.folder = trueBaseFolder
    this.ignoreFolder = ignoreFolder
    this.searchRequestLog = path.join(this.ignoreFolder, "searchLog.tree")
    this.tqlParser = tqlParser
  }

  searchRequestLog: any
  searchCache: any = {}
  ignoreFolder: string
  folder: TrueBaseFolder
  tqlParser: any

  _touchedLog = false
  logQuery(originalQuery: string, ip: string, format = "html") {
    const tree = `search
 time ${Date.now()}
 ip ${ip}
 format ${format}
 query
  ${originalQuery.replace(/\n/g, "\n  ")} 
`

    if (!this._touchedLog) {
      Disk.touch(this.searchRequestLog)
      this._touchedLog = true
    }

    fs.appendFile(this.searchRequestLog, tree, function () {})
    return this
  }

  logAndRunSearch(originalQuery = "", format = "object", ip = "") {
    this.logQuery(originalQuery, ip, format)
    return (<any>this)[format](decodeURIComponent(originalQuery).replace(/\r/g, ""))
  }

  columnsToCompare(files: TrueBaseFile[]) {
    // Todo: return the most interesting columns to compare first.
    return lodash.uniq(lodash.flatten(files.map(file => file.filledColumnNames)))
  }

  // todo: cleanup
  searchToScroll(originalQuery: string, canonicalLink = "") {
    const { hits, queryTime, columnNames, errors, title, description } = this.search(decodeURIComponent(originalQuery).replace(/\r/g, ""))
    const { folder } = this
    const results = new TreeNode(hits)._toDelimited(delimiter, columnNames, delimitedEscapeFunction)
    const encodedTitle = Utils.escapeScrollAndHtml(title)
    const encodedDescription = Utils.escapeScrollAndHtml(description)
    const encodedQuery = encodeURIComponent(originalQuery)
    const scrollCode = `import header.scroll

canonicalLink ${canonicalLink}

title ${encodedTitle ? encodedTitle : "Search Results"}
 hidden

${encodedDescription ? `description ${encodedDescription}` : ""}

html
 <form method="get" action="/search.html" class="tqlForm">
 <textarea id="tqlInput" name="q">${escapeHtml(originalQuery.replace(/\r/g, "").replace(/\n/g, "\n "))}</textarea>
 <input type="submit" value="Search"></form>

<div id="tqlErrors"></div>

Searched ${numeral(folder.length).format("0,0")} files and found ${hits.length} matches in ${queryTime}s. <span id="publishQuery"></span>
 class trueBaseThemeSearchResultsHeader

${title ? `# ${encodedTitle}` : ""}
${description ? `* ${encodedDescription}` : ""}

table ${delimiter}
 ${results.replace(/\n/g, "\n ")}

Results as JSON, CSV, TSV or Tree
 link /search.json?q=${encodedQuery} JSON
 link /search.csv?q=${encodedQuery} CSV
 link /search.tsv?q=${encodedQuery} TSV
 link /search.tree?q=${encodedQuery} Tree

<script>document.addEventListener("DOMContentLoaded", () => TrueBaseBrowserApp.getApp().render().renderSearchPage())</script>

import footer.scroll`

    return scrollCode
  }

  search(treeQLCode: string) {
    const { searchCache, tqlParser } = this
    if (searchCache[treeQLCode]) return searchCache[treeQLCode]

    const queryAsTree = new TreeNode(treeQLCode)
    const startTime = Date.now()
    let hits = []
    let errors = ""
    let columnNames: string[] = []
    try {
      const isCompareQuery = queryAsTree.has("compare")
      const adjustedQuery = isCompareQuery ? treeQLCode + `\nwhere id oneOf ${queryAsTree.get("compare")}` : treeQLCode
      const treeQLProgram = new tqlParser(adjustedQuery)
      const programErrors = treeQLProgram.scopeErrors.concat(treeQLProgram.getAllErrors())
      if (programErrors.length) throw new Error(programErrors.map((err: any) => err.message).join(" "))
      const sortBy = treeQLProgram.get("sortBy")
      let rawHits = treeQLProgram.filterFolder(this.folder)
      if (sortBy) {
        const sortByFns = sortBy.split(" ").map((columnName: string) => (file: any) => file.getTypedValue(columnName))
        rawHits = lodash.sortBy(rawHits, sortByFns)
      }
      if (treeQLProgram.has("reverse")) rawHits.reverse()

      // By default right now we basically add: select title titleLink
      // We will probably ditch that in the future and make it explicit.
      if (treeQLProgram.has("selectAll")) columnNames = treeQLProgram.rootGrammarTree.get("columnNameCell enum")?.split(" ") ?? Object.keys(rawHits[0]?.typed || undefined) ?? ["title"]
      else if (isCompareQuery) columnNames = this.columnsToCompare(rawHits)
      else columnNames = ["title", "titleLink"].concat((treeQLProgram.get("select") || "").split(" ").filter((i: string) => i))

      let matchingFilesAsObjectsWithSelectedColumns = rawHits.map((file: any) => {
        const obj = file.selectAsObject(columnNames)
        obj.titleLink = file.webPermalink
        return obj
      })

      const limit = treeQLProgram.get("limit")
      if (limit) matchingFilesAsObjectsWithSelectedColumns = matchingFilesAsObjectsWithSelectedColumns.slice(0, parseInt(limit))

      treeQLProgram.findNodes("addColumn").forEach((node: any) => {
        const newName = node.getWord(1)
        const code = node.getWordsFrom(2).join(" ")
        matchingFilesAsObjectsWithSelectedColumns.forEach((row: any, index: number) => (row[newName] = eval(`\`${code}\``)))
        columnNames.push(newName)
      })

      treeQLProgram.findNodes("rename").forEach((node: any) => {
        const oldName = node.getWord(1)
        const newName = node.getWord(2)
        matchingFilesAsObjectsWithSelectedColumns.forEach((obj: any) => {
          obj[newName] = obj[oldName]
          delete obj[oldName]
          columnNames = columnNames.map(columnName => (oldName === columnName ? newName : columnName))
        })
      })

      hits = matchingFilesAsObjectsWithSelectedColumns

      if (isCompareQuery) {
        columnNames = hits.map((obj: any) => obj.id)
        columnNames.unshift("Column")
        hits = transposeArray(hits)
      }
    } catch (err) {
      errors = err.toString()
      console.error(err)
    }

    searchCache[treeQLCode] = { hits, queryTime: numeral((Date.now() - startTime) / 1000).format("0.00"), columnNames, errors, title: queryAsTree.get("title"), description: queryAsTree.get("description") }
    return searchCache[treeQLCode]
  }

  json(treeQLCode: string) {
    return JSON.stringify(this.search(treeQLCode).hits, undefined, 2)
  }

  tree(treeQLCode: string) {
    return new TreeNode(this.search(treeQLCode).hits).asString
  }

  csv(treeQLCode: string) {
    const { hits, columnNames } = this.search(treeQLCode)
    return new TreeNode(hits).toDelimited(",", columnNames, delimitedEscapeFunction)
  }

  tsv(treeQLCode: string) {
    const { hits, columnNames } = this.search(treeQLCode)
    return new TreeNode(hits).toDelimited("\t", columnNames, delimitedEscapeFunction)
  }
}

export { TrueBaseFile, TrueBaseFolder, TrueBaseSettingsObject, SearchServer }
