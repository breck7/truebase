const fs = require("fs")
const path = require("path")
const lodash = require("lodash")
const numeral = require("numeral")
const morgan = require("morgan")
const https = require("https")
const express = require("express")
const nodemailer = require("nodemailer")
const bodyParser = require("body-parser")

const { Disk } = require("jtree/products/Disk.node.js")
const { Utils } = require("jtree/products/Utils.js")
const { TreeNode } = require("jtree/products/TreeNode.js")
const { GrammarCompiler } = require("jtree/products/GrammarCompiler.js")
const { ScrollCli, ScrollFile } = require("scroll-cli")

const genericTqlNode = require("../tql/tql.nodejs.js")
const nodeModulesFolder = path.join(__dirname, "..", "node_modules")
const jtreeFolder = path.join(nodeModulesFolder, "jtree")
const browserAppFolder = path.join(__dirname, "..", "browser")

const delimitedEscapeFunction = (value: any) => (value.includes("\n") ? value.split("\n")[0] : value)
const delimiter = " DeLiM "

import { TrueBaseFolder, TrueBaseFile } from "./TrueBase"

class TrueBaseServer {
  _folder: TrueBaseFolder
  _app: any
  searchServer: SearchServer
  ignoreFolder = ""
  siteFolder: string
  distFolder: string
  trueBaseId = "truebase"
  siteName = "TrueBase"
  siteDomain = "truebase.pub"
  scrollFooter: string
  scrollHeader: string

  constructor(folder: TrueBaseFolder, ignoreFolder: string, siteFolder: string) {
    this._folder = folder
    this.siteFolder = siteFolder
    this.distFolder = path.join(this.siteFolder, "dist")
    this.ignoreFolder = ignoreFolder
  }

  get folder() {
    return this._folder.loadFolder()
  }

  get app() {
    if (this._app) return this._app

    const app = express()
    this._app = app
    if (!Disk.exists(this.ignoreFolder)) Disk.mkdir(this.ignoreFolder)

    this._initLogs()

    app.use(bodyParser.urlencoded({ extended: false }))
    app.use(bodyParser.json())
    app.use((req: any, res: any, next: any) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE")
      res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type")
      res.setHeader("Access-Control-Allow-Credentials", true)
      next()
    })
    this.serveFolder(this.siteFolder)
    this.initSearch()
    return this._app
  }

  _initLogs() {
    const { ignoreFolder, app } = this
    const requestLog = path.join(ignoreFolder, "access.log")
    Disk.touch(requestLog)
    app.use(morgan("combined", { stream: fs.createWriteStream(requestLog, { flags: "a" }) }))

    const requestTimesLog = path.join(ignoreFolder, "requestTimes.log")
    Disk.touch(requestTimesLog)
    app.use(morgan("tiny", { stream: fs.createWriteStream(requestTimesLog, { flags: "a" }) }))
  }

  _addNotFoundRoute() {
    this.scrollFooter = Disk.read(path.join(this.siteFolder, "footer.scroll"))
    this.scrollHeader = new ScrollFile(undefined, path.join(this.siteFolder, "header.scroll")).importResults.code
    const notFoundPage = Disk.read(path.join(this.siteFolder, "custom_404.html"))
    //The 404 Route (ALWAYS Keep this as the last route)
    this.app.get("*", (req: any, res: any) => res.status(404).send(notFoundPage))
  }

  serveFolder(folder: string) {
    this.app.use(express.static(folder))
    return this
  }

  async createEmailConfig() {
    // Generate test SMTP service account from ethereal.email
    // Only needed if you don't have a real mail account for testing
    let testAccount = await nodemailer.createTestAccount()
    Disk.write(this.emailConfigPath, `port 587\nhost smtp.ethereal.email\nsecure false\nuser ${testAccount.user}\npass ${testAccount.pass}`)
  }

  emailConfigPath: string
  emailConfig: any
  async sendEmail(to: string, from: string, subject: string, link: string) {
    const { siteName } = this
    if (!this.emailConfig) {
      this.emailConfigPath = path.join(this.ignoreFolder, "emailConfig.tree")
      if (!Disk.exists(this.emailConfigPath)) await this.createEmailConfig()
      this.emailConfig = new TreeNode(Disk.read(this.emailConfigPath)).toObject()
    }

    const { user, pass, host, port, secure } = this.emailConfig
    let transporter = nodemailer.createTransport({
      host,
      port: parseInt(port),
      secure: secure === "true",
      auth: {
        user,
        pass
      }
    })

    // send mail with defined transport object
    let info = await transporter.sendMail({
      from,
      to,
      subject,
      text: link,
      html: `<a href="${link}">${link}</a>`
    })

    console.log("Message sent: %s", info.messageId)
    if (host === "smtp.ethereal.email") console.log("Preview URL: %s", nodemailer.getTestMessageUrl(info))
  }

  getOrCreateLoginLink(email: string) {
    if (!this.trueBaseUsers.has(email)) {
      const password = Utils.getRandomCharacters(16)
      const created = new Date().toString()
      const loginLink = `https://${this.siteDomain}/login.html?email=${email}&password=${password}`
      Disk.append(this.userPasswordPath, `${email}\n password ${password}\n created ${created}\n loginLink ${loginLink}\n`)
      this.trueBaseUsers.appendLineAndChildren(email, {
        password,
        created,
        loginLink
      })
    }
    return this.trueBaseUsers.get(`${email} loginLink`)
  }

  userPasswordPath: string
  loginLogPath: string
  trueBaseUsers: any
  initUserAccounts() {
    this.userPasswordPath = path.join(this.ignoreFolder, "trueBaseUsers.tree")
    Disk.touch(this.userPasswordPath)
    this.loginLogPath = path.join(this.ignoreFolder, "trueBaseLogins.log")
    Disk.touch(this.loginLogPath)

    this.trueBaseUsers = new TreeNode(Disk.read(this.userPasswordPath))
    const { app } = this
    app.post("/sendLoginLink", async (req: any, res: any) => {
      try {
        const email = req.body.email
        if (!Utils.isValidEmail(email)) throw new Error(`"${email}" is not a valid email.`)

        const link = this.getOrCreateLoginLink(email)
        const { siteName, siteDomain } = this
        const from = `"${siteName}" <feedbackwelcome@${siteDomain}>`
        await this.sendEmail(email, from, `Your ${siteName} login link`, link)
        return res.send("OK")
      } catch (err) {
        console.error(err)
        return res.status(500).send(err)
      }
    })

    app.post("/login", (req: any, res: any) => {
      const { email, password } = req.body
      if (Utils.isValidEmail(email) && this.trueBaseUsers.has(email) && this.trueBaseUsers.get(`${email} password`) === password) {
        Disk.append(this.loginLogPath, `${email} ${new Date()}\n`)
        return res.send("OK")
      }
      return res.send("FAIL")
    })
  }

  initSearch() {
    const { app } = this
    const searchServer = new SearchServer(this.folder, this.ignoreFolder)
    this.searchServer = searchServer
    app.get("/search.json", (req: any, res: any) => res.setHeader("content-type", "application/json").send(searchServer.logAndRunSearch(req.query.q, "json", req.ip)))
    app.get("/search.csv", (req: any, res: any) => res.setHeader("content-type", "text/plain").send(searchServer.logAndRunSearch(req.query.q, "csv", req.ip)))
    app.get("/search.tsv", (req: any, res: any) => res.setHeader("content-type", "text/plain").send(searchServer.logAndRunSearch(req.query.q, "tsv", req.ip)))
    app.get("/search.tree", (req: any, res: any) => res.setHeader("content-type", "text/plain").send(searchServer.logAndRunSearch(req.query.q, "tree", req.ip)))

    const searchCache: any = {}
    app.get("/search.html", (req: any, res: any) => {
      const { searchServer } = this
      const query = req.query.q ?? ""
      searchServer.logQuery(query, req.ip, "scroll")
      if (!searchCache[query]) searchCache[query] = this.searchToHtml(query)

      res.send(searchCache[query])
    })

    app.get("/s/:query", (req: any, res: any) => res.redirect(`/search.html?q=includes+${req.params.query}`))

    app.get("/fullTextSearch", (req: any, res: any) => res.redirect(`/search.html?q=includes+${req.query.q}`))

    return this
  }

  // todo: cleanup
  searchToHtml(originalQuery: string) {
    const { hits, queryTime, columnNames, errors, title, description } = this.searchServer.search(decodeURIComponent(originalQuery).replace(/\r/g, ""), this.extendedTqlParser)
    const { folder } = this
    const results = new TreeNode(hits)._toDelimited(delimiter, columnNames, delimitedEscapeFunction)
    const encodedTitle = Utils.escapeScrollAndHtml(title)
    const encodedDescription = Utils.escapeScrollAndHtml(description)
    const encodedQuery = encodeURIComponent(originalQuery)

    return new ScrollFile(
      `${this.scrollHeader}

title Search Results
 hidden

html <form method="get" action="search.html" class="tqlForm"><textarea id="tqlInput" name="q"></textarea><input type="submit" value="Search"></form>
html <div id="tqlErrors"></div>

* Searched ${numeral(folder.length).format("0,0")} files and found ${hits.length} matches in ${queryTime}s.
 class trueBaseThemeSearchResultsHeader

${title ? `# ${encodedTitle}` : ""}
${description ? `* ${encodedDescription}` : ""}

table ${delimiter}
 ${results.replace(/\n/g, "\n ")}

* Results as JSON, CSV, TSV or Tree
 link search.json?q=${encodedQuery} JSON
 link search.csv?q=${encodedQuery} CSV
 link search.tsv?q=${encodedQuery} TSV
 link search.tree?q=${encodedQuery} Tree

html <script>document.addEventListener("DOMContentLoaded", () => new TrueBaseBrowserApp().render().renderSearchPage())</script>

${this.scrollFooter}`
    ).html
  }

  extendedTqlParser: any

  async applyPatch(patch: string) {
    const { folder } = this
    const tree = new TreeNode(patch)

    const create = tree.getNode("create")
    const changedFiles = []
    if (create) {
      const data = create.childrenToString()

      // todo: audit
      const validateSubmissionResults = this.validateSubmission(data)
      const newFile = folder.createFile(validateSubmissionResults.content)

      changedFiles.push(newFile)
    }

    tree.delete("create")

    tree.forEach((node: any) => {
      const id = Utils.removeFileExtension(node.getWord(0))
      const file = folder.getFile(id)
      if (!file) throw new Error(`File '${id}' not found.`)

      const validateSubmissionResults = this.validateSubmission(node.childrenToString())
      file.setChildren(validateSubmissionResults.content)
      file.prettifyAndSave()
      changedFiles.push(file)
    })

    folder.clearQuickCache()
    return changedFiles
  }

  validateSubmission(content: string) {
    // Run some simple sanity checks.
    if (content.length > 200000) throw new Error(`Submission too large`)

    // Remove all return characters
    content = Utils.removeEmptyLines(Utils.removeReturnChars(content))

    const programParser = this.folder.grammarProgramConstructor
    const parsed = new programParser(content)

    const errs = parsed.getAllErrors()

    if (errs.length > 3) throw new Error(`Too many errors detected in submission: ${JSON.stringify(errs.map((err: any) => err.toObject()))}`)

    const { scopeErrors } = parsed
    if (scopeErrors.length > 3) throw new Error(`Too many scope errors detected in submission: ${JSON.stringify(scopeErrors.map((err: any) => err.toObject()))}`)

    if (parsed.length < 3) throw new Error(`Must provide at least 3 facts about the language.`)

    return {
      content: parsed.sortFromSortTemplate().toString()
    }
  }

  beforeListen() {
    // A hook for subclasses to override
  }

  listen(port = 4444) {
    this.beforeListen()
    this._addNotFoundRoute()
    this.app.listen(port, () => console.log(`TrueBase server running: \ncmd+dblclick: http://localhost:${port}/`))
    return this
  }

  listenProd() {
    this.beforeListen()
    this._addNotFoundRoute()
    const key = fs.readFileSync(path.join(this.ignoreFolder, "privkey.pem"))
    const cert = fs.readFileSync(path.join(this.ignoreFolder, "fullchain.pem"))
    https
      .createServer(
        {
          key,
          cert
        },
        this.app
      )
      .listen(443)

    const redirectApp = express()
    redirectApp.use((req: any, res: any) => res.redirect(301, `https://${req.headers.host}${req.url}`))
    redirectApp.listen(80, () => console.log(`Running redirect app`))
    return this
  }

  startDevServerCommand(port: number) {
    this.listen(port)
  }

  startProdServerCommand() {
    this.listenProd()
  }

  get jsFiles() {
    return `${jtreeFolder}/products/Utils.browser.js
${jtreeFolder}/products/TreeNode.browser.js
${jtreeFolder}/products/GrammarLanguage.browser.js
${jtreeFolder}/products/GrammarCodeMirrorMode.browser.js
${jtreeFolder}/sandbox/lib/codemirror.js
${jtreeFolder}/sandbox/lib/show-hint.js
${this.distFolder}/${this.folder.fileExtension}.browser.js
${this.distFolder}/tql.browser.js
${browserAppFolder}/libs.js
${browserAppFolder}/TrueBaseBrowserApp.js`.split("\n")
  }

  get cssFiles() {
    return [path.join(jtreeFolder, "sandbox/lib/codemirror.css"), path.join(jtreeFolder, "sandbox/lib/codemirror.show-hint.css"), path.join(this.siteFolder, "scroll.css"), path.join(browserAppFolder, "TrueBaseTheme.css")]
  }

  get combinedCss() {
    return this.cssFiles.map(Disk.read).join(`\n\n`)
  }

  get combinedJs() {
    return this.jsFiles.map(filename => Disk.read(filename)).join(`;\n\n`)
  }

  buildScrollsCommand() {
    const scrolls = new ScrollCli().findScrollsInDirRecursive(this.siteFolder)
    Object.keys(scrolls).forEach(key => new ScrollCli().buildCommand(key))
  }

  buildDistFolderCommand() {
    const { distFolder, folder, trueBaseId } = this
    if (!Disk.exists(distFolder)) Disk.mkdir(distFolder)
    const tqlPath = path.join(__dirname, "..", "tql", "tql.grammar")
    const extendedTqlGrammar = new TreeNode(Disk.read(tqlPath))
    extendedTqlGrammar.getNode("columnNameCell").set("enum", folder.colNamesForCsv.join(" "))
    const extendedTqlName = `${trueBaseId}Tql`
    extendedTqlGrammar.getNode("tqlNode").setWord(`${extendedTqlName}Node`)
    const extendedTqlPath = path.join(distFolder, `${extendedTqlName}.grammar`)
    Disk.write(extendedTqlPath, extendedTqlGrammar.toString())
    GrammarCompiler.compileGrammarForBrowser(extendedTqlPath, distFolder + "/", false)
    const jsPath = GrammarCompiler.compileGrammarForNodeJs(extendedTqlPath, distFolder + "/", true)
    this.extendedTqlParser = require(jsPath)

    const ids = folder.map((file: TrueBaseFile) => file.id).join(" ")
    const grammar = new TreeNode(folder.grammarCode)
    grammar.getNode("trueBaseIdCell").set("enum", ids)
    const grammarFileName = `${trueBaseId}.grammar`
    Disk.write(path.join(distFolder, grammarFileName), grammar.toString())
    GrammarCompiler.compileGrammarForBrowser(path.join(distFolder, grammarFileName), distFolder + "/", false)

    Disk.write(path.join(this.distFolder, "combined.js"), this.combinedJs)
    Disk.write(path.join(this.distFolder, "combined.css"), this.combinedCss)
    Disk.write(path.join(this.distFolder, "autocomplete.json"), this.autocompleteJson)
  }

  get autocompleteJson() {
    return JSON.stringify(
      this.folder.map((file: any) => {
        return {
          label: file.get("title"),
          id: file.id,
          url: `/truebase/${file.id}.html`
        }
      }),
      undefined,
      2
    )
  }

  buildCsvFilesCommand() {
    const { folder, trueBaseId } = this
    const mainCsvFilename = `${trueBaseId}.csv`
    Disk.writeIfChanged(path.join(this.siteFolder, mainCsvFilename), folder.makeCsv(mainCsvFilename))
    Disk.writeIfChanged(path.join(this.siteFolder, "columns.csv"), folder.columnsCsvOutput.columnsCsv)
  }

  formatCommand() {
    this.folder.forEach((file: TrueBaseFile) => file.prettifyAndSave())
  }

  createFromTreeCommand() {
    TreeNode.fromDisk(path.join(this.ignoreFolder, "create.tree")).forEach((node: any) => this.folder.createFile(node.childrenToString()))
  }

  createFromCsvCommand() {
    TreeNode.fromCsv(Disk.read(path.join(this.ignoreFolder, "create.csv"))).forEach((node: any) => this.folder.createFile(node.childrenToString()))
  }

  createFromTsvCommand() {
    TreeNode.fromTsv(Disk.read(path.join(this.ignoreFolder, "create.tsv"))).forEach((node: any) => this.folder.createFile(node.childrenToString()))
  }
}

class SearchServer {
  constructor(trueBaseFolder: TrueBaseFolder, ignoreFolder: string) {
    this.folder = trueBaseFolder
    this.ignoreFolder = ignoreFolder
    this.searchRequestLog = path.join(this.ignoreFolder, "searchLog.tree")
  }

  searchRequestLog: any
  searchCache: any = {}
  ignoreFolder: string
  folder: TrueBaseFolder

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

    fs.appendFile(this.searchRequestLog, tree, function() {})
    return this
  }

  logAndRunSearch(originalQuery = "", format = "object", ip = "") {
    this.logQuery(originalQuery, ip, format)
    return (<any>this)[format](decodeURIComponent(originalQuery).replace(/\r/g, ""))
  }

  search(treeQLCode: string, tqlParser: any = genericTqlNode) {
    const { searchCache } = this
    if (searchCache[treeQLCode]) return searchCache[treeQLCode]

    const startTime = Date.now()
    let hits = []
    let errors = ""
    let columnNames: string[] = []
    let title = ""
    let description = ""
    try {
      const treeQLProgram = new tqlParser(treeQLCode)
      const programErrors = treeQLProgram.scopeErrors.concat(treeQLProgram.getAllErrors())
      if (programErrors.length) throw new Error(programErrors.map((err: any) => err.getMessage()).join(" "))
      const sortBy = treeQLProgram.get("sortBy")
      title = treeQLProgram.get("title")
      description = treeQLProgram.get("description")
      let rawHits = treeQLProgram.filterFolder(this.folder)
      if (sortBy) {
        const sortByFns = sortBy.split(" ").map((columnName: string) => (file: any) => file.getTypedValue(columnName))
        rawHits = lodash.sortBy(rawHits, sortByFns)
      }
      if (treeQLProgram.has("reverse")) rawHits.reverse()

      // By default right now we basically add: select title titleLink
      // We will probably ditch that in the future and make it explicit.
      if (treeQLProgram.has("selectAll")) columnNames = treeQLProgram.rootGrammarTree.get("columnNameCell enum")?.split(" ") ?? Object.keys(rawHits[0]?.typed || undefined) ?? ["title"]
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
    } catch (err) {
      errors = err.toString()
      console.error(err)
    }

    searchCache[treeQLCode] = { hits, queryTime: numeral((Date.now() - startTime) / 1000).format("0.00"), columnNames, errors, title, description }
    return searchCache[treeQLCode]
  }

  json(treeQLCode: string) {
    return JSON.stringify(this.search(treeQLCode).hits, undefined, 2)
  }

  tree(treeQLCode: string) {
    return new TreeNode(this.search(treeQLCode).hits).toString()
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

export { SearchServer, TrueBaseServer }
