const fs = require("fs")
const path = require("path")
const lodash = require("lodash")
const numeral = require("numeral")
const morgan = require("morgan")
const https = require("https")
const express = require("express")
const compression = require("compression")
const nodemailer = require("nodemailer")
const bodyParser = require("body-parser")
const simpleGit = require("simple-git")

const { Disk } = require("jtree/products/Disk.node.js")
const { Utils } = require("jtree/products/Utils.js")
const { TreeNode } = require("jtree/products/TreeNode.js")
const { GrammarCompiler } = require("jtree/products/GrammarCompiler.js")
const grammarParser = require("jtree/products/grammar.nodejs.js")
const { ScrollCli, ScrollFile, ScrollFileSystem } = require("scroll-cli")

const genericTqlParser = require("../tql/tql.nodejs.js")
let nodeModulesFolder = path.join(__dirname, "..", "node_modules")
if (!Disk.exists(nodeModulesFolder)) nodeModulesFolder = path.join(__dirname, "..", "..") // Hacky. Todo: cleanup
const jtreeFolder = path.join(nodeModulesFolder, "jtree")
const zlib = require("zlib")

const browserAppFolder = path.join(__dirname, "..", "browser")

const delimitedEscapeFunction = (value: any) => (value.includes("\n") ? value.split("\n")[0] : value)
const delimiter = " DeLiM "

import { UserFacingErrorMessages } from "./ErrorMessages"
import { TrueBaseFolder, TrueBaseFile } from "./TrueBase"

import { TrueBaseServerSettingsObject } from "./TrueBaseSettings"

declare type stringMap = { [firstWord: string]: string }

const resolvePath = (folder: string, baseDir: string) => (path.isAbsolute(folder) ? path.normalize(folder) : path.resolve(path.join(baseDir, folder)))

class TrueBaseServer {
  _folder: TrueBaseFolder
  _app: any
  searchServer: SearchServer
  editLogPath: string
  settings: TrueBaseServerSettingsObject

  constructor(settingsFilepath: string, folder?: TrueBaseFolder) {
    const settings = TreeNode.fromDisk(settingsFilepath).toObject()
    const dirname = path.dirname(settingsFilepath)
    settings.grammarFolder = resolvePath(settings.grammarFolder, dirname)
    settings.thingsFolder = resolvePath(settings.thingsFolder, dirname)
    settings.ignoreFolder = resolvePath(settings.ignoreFolder, dirname)
    settings.siteFolder = resolvePath(settings.siteFolder, dirname)
    this.settings = settings
    this._folder = folder ? folder : new TrueBaseFolder().setSettings(settings)
    this.editLogPath = path.join(settings.ignoreFolder, "trueBaseServerLog.tree")
  }

  get folder() {
    return this._folder.loadFolder()
  }

  get app() {
    if (this._app) return this._app

    const app = express()
    app.use(compression())
    this._app = app
    const { ignoreFolder, siteFolder, grammarFolder, thingsFolder } = this.settings
    if (!Disk.exists(ignoreFolder)) Disk.mkdir(ignoreFolder)

    const requestLog = path.join(ignoreFolder, "access.log")
    Disk.touch(requestLog)
    app.use(morgan("combined", { stream: fs.createWriteStream(requestLog, { flags: "a" }) }))

    const requestTimesLog = path.join(ignoreFolder, "requestTimes.log")
    Disk.touch(requestTimesLog)
    app.use(morgan("tiny", { stream: fs.createWriteStream(requestTimesLog, { flags: "a" }) }))

    app.use(bodyParser.urlencoded({ extended: false, limit: "10mb" }))
    app.use(bodyParser.json({ limit: "10mb" }))
    app.use((req: any, res: any, next: any) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE")
      res.setHeader("Access-Control-Allow-Headers", "X-Requested-With,content-type")
      res.setHeader("Access-Control-Allow-Credentials", true)
      next()
    })
    const mimeTypes: stringMap = {
      json: "application/json",
      css: "text/css",
      js: "text/javascript"
    }
    const plainTypes = `csv tsv tree scroll grammar ${this.folder.fileExtension}`.split(" ")
    plainTypes.forEach(type => (mimeTypes[type] = "text/plain"))
    app.use((req: any, res: any, next: any) => {
      const mimeType = mimeTypes[req.path.split(".").pop()]
      if (mimeType) res.setHeader("content-type", mimeType)
      next()
    })
    this.serveFolder(browserAppFolder)
    this.serveFolder(siteFolder)
    this.serveFolderNested("/grammar/", grammarFolder)
    this.serveFolderNested("/things/", thingsFolder)
    this._initSearch()
    this._initUserAccounts()

    app.get("/edit.json", (req: any, res: any) => {
      const { id } = req.query
      const file = this.folder.getFile(id)
      if (!file) return res.send(JSON.stringify({ error: "Not found" }))
      res.send(
        JSON.stringify({
          content: file.childrenToString(),
          topUnansweredQuestions: file.topUnansweredQuestions,
          helpfulResearchLinks: file.helpfulResearchLinks
        })
      )
    })

    // Have some fast keyboard shortcuts for editing and QA'ing the edit experience.
    app.get("/editNext/:id", (req: any, res: any, next: any) => {
      const file = this.folder.getFile(req.params.id)
      if (!file) return next()
      res.redirect(`/edit.html?id=${file.next.id}`)
    })

    app.get("/editPrevious/:id", (req: any, res: any, next: any) => {
      const file = this.folder.getFile(req.params.id)
      if (!file) return next()
      res.redirect(`/edit.html?id=${file.previous.id}`)
    })

    app.post("/saveCommitAndPush", async (req: any, res: any) => {
      const { author } = req.body
      const patch = Utils.removeReturnChars(req.body.patch).trim()
      this.appendToPostLog(author, patch)
      try {
        const hash = await this.applyPatchCommitAndPush(patch, author)
        res.redirect(`/thankYou.html?commit=${hash}`)
      } catch (error) {
        console.error(error)
        res.status(500).redirect(`/error.html?error=${encodeURIComponent(error)}`)
      }
    })

    app.get("/stats.html", (req: any, res: any, next: any) => res.send(this.scrollToHtml(this.statusPage)))

    // Short urls:
    app.get("/:id", (req: any, res: any, next: any) => (this.folder.getFile(req.params.id.toLowerCase()) ? res.status(302).redirect(`/truebase/${req.params.id.toLowerCase()}.html`) : next()))

    app.get(`/${this.settings.trueBaseId}.json`, (req: any, res: any) => res.send(this.folder.typedMapJson))
    return this._app
  }

  async applyPatchCommitAndPush(patch: string, author: string) {
    const { authorName, authorEmail } = this.parseGitAuthor(author)
    if (!Utils.isValidEmail(authorEmail)) throw new Error(UserFacingErrorMessages.invalidEmail(authorEmail))

    const changedFiles = this.applyPatch(patch)
    const hash = await this.saveCommitAndPush(
      changedFiles.map(file => file.filename),
      authorName,
      authorEmail
    )
    return hash
  }

  serveFolder(folder: string) {
    this.app.use(express.static(folder))
    return this
  }

  serveFolderNested(nestedPath: string, folder: string) {
    this.app.use(nestedPath, express.static(folder))
  }

  gitOn = false
  GIT_DEFAULT_USERNAME = "TrueBaseWebUI"
  GIT_DEFAULT_EMAIL = "webui@truebase.pub"

  parseGitAuthor(field = `${this.GIT_DEFAULT_USERNAME} <${this.GIT_DEFAULT_EMAIL}>`) {
    const authorName = field
      .split("<")[0]
      .trim()
      .replace(/[^a-zA-Z \.]/g, "")
      .substr(0, 32)
    const authorEmail = field.split("<")[1].replace(">", "").trim()
    return {
      authorName,
      authorEmail
    }
  }

  async saveCommitAndPush(filenames: string[], authorName: string, authorEmail: string) {
    const commitResult = await this.commitFilesPullAndPush(filenames, authorName, authorEmail)

    return commitResult.commitHash
  }

  _git: any
  get git() {
    if (!this._git)
      this._git = simpleGit({
        baseDir: this.folder.dir,
        binary: "git",
        maxConcurrentProcesses: 1,
        // Needed since git won't let you commit if there's no user name config present (i.e. CI), even if you always
        // specify `author=` in every command. See https://stackoverflow.com/q/29685337/10670163 for example.
        config: [`user.name='${this.GIT_DEFAULT_USERNAME}'`, `user.email='${this.GIT_DEFAULT_EMAIL}'`]
      })
    return this._git
  }

  async commitFilesPullAndPush(filenames: string[], authorName: string, authorEmail: string) {
    const commitMessage = filenames.join(" ")
    if (!this.gitOn) {
      console.log(`Would commit "${commitMessage}" with author "${authorName} <${authorEmail}>"`)
      return {
        success: true,
        commitHash: `pretendCommitHash`
      }
    }
    const { git } = this
    try {
      // git add
      // git commit
      // git pull --rebase
      // git push

      if (!Utils.isValidEmail(authorEmail)) throw new Error(UserFacingErrorMessages.invalidEmail(authorEmail))

      for (const filename of filenames) {
        await git.add(filename)
      }

      const commitResult = await git.commit(commitMessage, filenames, {
        "--author": `${authorName} <${authorEmail}>`
      })

      await this.pullAndPush()

      return {
        success: true,
        commitHash: this.lastCommitHash // todo: verify that this is the users commit
      }
    } catch (error) {
      console.error(error)
      return {
        success: false,
        error
      }
    }
  }

  pushOnCommit = true

  async pullAndPush() {
    if (!this.pushOnCommit) return true
    await this.git.pull("origin", "main")
    await this.git.push()
  }

  get lastCommitHash() {
    return require("child_process")
      .execSync("git rev-parse HEAD", {
        cwd: this.settings.siteFolder
      })
      .toString()
      .trim()
  }

  appendToPostLog(author = "", content = "") {
    // Write to log for backup in case something goes wrong.
    Disk.append(
      this.editLogPath,
      `post
 time ${new Date().toString()}
 author ${author.replace(/\n/g, " ")}
 content
  ${content.replace(/\n/g, "\n  ")}\n`
    )
  }

  async createTestEmailConfig() {
    // Generate test SMTP service account from ethereal.email
    // Only needed if you don't have a real mail account for testing
    let testAccount = await nodemailer.createTestAccount()
    Disk.write(this.emailConfigPath, `port 587\nhost smtp.ethereal.email\nsecure false\nuser ${testAccount.user}\npass ${testAccount.pass}`)
  }

  emailConfigPath: string
  emailConfig: any
  async sendEmail(to: string, from: string, subject: string, link: string) {
    if (!this.emailConfig) {
      this.emailConfigPath = path.join(this.settings.ignoreFolder, "emailConfig.tree")
      if (!Disk.exists(this.emailConfigPath)) await this.createTestEmailConfig()
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

    console.log(`Sending email using '${host}'.`)

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
      const protocol = this.port === 443 ? "https" : "http"
      const loginLink = `${protocol}://${this.settings.domain}/login.html?email=${email}&password=${password}`
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
  _initUserAccounts() {
    const { ignoreFolder, name, domain } = this.settings
    this.userPasswordPath = path.join(ignoreFolder, "trueBaseUsers.tree")
    Disk.touch(this.userPasswordPath)
    this.loginLogPath = path.join(ignoreFolder, "trueBaseLogins.log")
    Disk.touch(this.loginLogPath)

    this.trueBaseUsers = new TreeNode(Disk.read(this.userPasswordPath))
    const { app } = this
    app.post("/sendLoginLink", async (req: any, res: any) => {
      try {
        const email = req.body.email
        if (!Utils.isValidEmail(email)) throw new Error(UserFacingErrorMessages.invalidEmail(email))

        const link = this.getOrCreateLoginLink(email)
        const from = `"${name}" <feedback@${domain}>`
        await this.sendEmail(email, from, `Your ${name} login link`, link)
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

  _initSearch() {
    const { app } = this
    const searchServer = new SearchServer(this.folder, this.settings.ignoreFolder)
    this.searchServer = searchServer
    app.get("/search.json", (req: any, res: any) => res.send(searchServer.logAndRunSearch(req.query.q, "json", req.ip)))
    app.get("/search.csv", (req: any, res: any) => res.send(searchServer.logAndRunSearch(req.query.q, "csv", req.ip)))
    app.get("/search.tsv", (req: any, res: any) => res.send(searchServer.logAndRunSearch(req.query.q, "tsv", req.ip)))
    app.get("/search.tree", (req: any, res: any) => res.send(searchServer.logAndRunSearch(req.query.q, "tree", req.ip)))

    const searchCache: any = {}
    app.get("/search.html", (req: any, res: any) => {
      const { searchServer } = this
      const query = req.query.q ?? ""
      searchServer.logQuery(query, req.ip, "scroll")
      const canonicalLink = `${req.protocol}://${req.get("host")}${req.originalUrl}`
      if (!searchCache[query]) searchCache[query] = this.searchToHtml(query, canonicalLink)

      res.send(searchCache[query])
    })

    app.get("/s/:query", (req: any, res: any) => res.redirect(`/search.html?q=includes+${req.params.query}`))

    app.get("/fullTextSearch", (req: any, res: any) => res.redirect(`/search.html?q=includes+${req.query.q}`))

    return this
  }

  // todo: cleanup
  searchToHtml(originalQuery: string, canonicalLink = "") {
    const { hits, queryTime, columnNames, errors, title, description } = this.searchServer.search(decodeURIComponent(originalQuery).replace(/\r/g, ""), this.extendedTqlParser)
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

html <form method="get" action="search.html" class="tqlForm"><textarea id="tqlInput" name="q"></textarea><input type="submit" value="Search"></form>
html <div id="tqlErrors"></div>

Searched ${numeral(folder.length).format("0,0")} files and found ${hits.length} matches in ${queryTime}s.
 class trueBaseThemeSearchResultsHeader

${title ? `# ${encodedTitle}` : ""}
${description ? `* ${encodedDescription}` : ""}

table ${delimiter}
 ${results.replace(/\n/g, "\n ")}

Results as JSON, CSV, TSV or Tree
 link search.json?q=${encodedQuery} JSON
 link search.csv?q=${encodedQuery} CSV
 link search.tsv?q=${encodedQuery} TSV
 link search.tree?q=${encodedQuery} Tree

html <script>document.addEventListener("DOMContentLoaded", () => new TrueBaseBrowserApp().render().renderSearchPage())</script>

import footer.scroll`

    return this.scrollToHtml(scrollCode)
  }

  scrollToHtml(scrollCode: string, virtualFilePath = `${this.settings.siteFolder}/random-${Utils.getRandomCharacters(24)}.scroll`) {
    // todo: eliminate need for virtualFilePath?
    // I believe we have that because we need import paths to work correctly. And perhaps to mix default files with overrides.
    this.virtualFiles[virtualFilePath] = scrollCode
    return new ScrollFile(scrollCode, virtualFilePath, this.scrollFileSystem).html
  }

  extendedTqlParser: any

  applyPatch(patch: string) {
    const { folder } = this
    const tree = new TreeNode(patch)

    const createFiles = tree.findNodes("create")
    const changedFiles: TrueBaseFile[] = []
    createFiles.forEach((create: any) => {
      const data = create.childrenToString()

      // todo: audit
      const validateSubmissionResults = this.validateSubmission(data)
      const newFile = folder.createFile(validateSubmissionResults.content)

      changedFiles.push(newFile)
    })

    tree.delete("create")

    tree.forEach((node: any) => {
      const id = Utils.removeFileExtension(node.getWord(0))
      const file = folder.getFile(id)
      if (!file) throw new Error(UserFacingErrorMessages.fileNotFound(id))

      const validateSubmissionResults = this.validateSubmission(node.childrenToString())
      file.setChildren(validateSubmissionResults.content)
      file.prettifyAndSave()
      changedFiles.push(file)
    })

    folder.clearQuickCache()
    return changedFiles
  }

  get minimumNewFacts() {
    return 3
  }

  get maximumAllowedErrors() {
    return 3
  }

  get patchSizeLimit() {
    return 200000
  }

  validateSubmission(content: string) {
    const { minimumNewFacts, maximumAllowedErrors, patchSizeLimit } = this
    // Run some simple sanity checks.
    if (content.length > patchSizeLimit) throw new Error(UserFacingErrorMessages.patchSizeTooLarge(content.length, patchSizeLimit))

    // Remove all return characters
    content = Utils.removeEmptyLines(Utils.removeReturnChars(content))

    const rootParser = this.folder.rootParser
    const parsed = new rootParser(content)

    const errs = parsed.getAllErrors().concat(parsed.scopeErrors)

    if (errs.length > maximumAllowedErrors) throw new Error(UserFacingErrorMessages.tooManyErrors(errs.length, maximumAllowedErrors, errs))

    if (parsed.length < minimumNewFacts) throw new Error(UserFacingErrorMessages.notEnoughFacts(parsed.length, minimumNewFacts))

    return {
      content: parsed.sortFromSortTemplate().asString
    }
  }

  virtualFiles: { [firstWord: string]: string } = {}
  scrollFileSystem = new ScrollFileSystem(this.virtualFiles)
  dumpStaticSiteCommand(destinationPath = path.join(this.settings.ignoreFolder, "staticSite")) {
    this.warmAll()
    Disk.mkdir(destinationPath)
    Disk.writeObjectToDisk(destinationPath, this.virtualFiles)
  }

  warmAll() {
    this.warmGrammarFiles()
    this.warmJsAndCss()
    this.warmSiteFolder()
  }

  beforeListen() {
    const { siteFolder } = this.settings
    process.title = this.settings.trueBaseId
    this.warmAll()

    const { virtualFiles } = this

    let notFoundPage = ""
    if (virtualFiles[siteFolder + "/custom_404.scroll"]) notFoundPage = this.compileScrollFile(siteFolder + "/custom_404.scroll")
    else notFoundPage = this.compileScrollFile(browserAppFolder + "/custom_404.scroll")

    // Do not convert the file to a Scroll until requested
    this.app.get("/truebase/:filename", (req: any, res: any, next: any) => {
      const virtualPath = siteFolder + "/" + req.params.filename
      if (virtualFiles[virtualPath]) return res.send(virtualFiles[virtualPath])

      const id = req.params.filename.replace(".html", "")
      const file = this.folder.getFile(id)
      if (file) virtualFiles[siteFolder + `/truebase/${file.id}.scroll`] = file.toScroll()
      next()
    })

    //The 404 Route (ALWAYS Keep this as the last route)
    this.app.get("*", (req: any, res: any) => {
      const url = req.path.endsWith("/") ? req.path + "index.html" : req.path
      if (virtualFiles[siteFolder + url]) return res.send(virtualFiles[siteFolder + url])
      if (virtualFiles[url]) return res.send(virtualFiles[url])

      // Compile scroll files only when first requested
      const scrollPath = url.replace(".html", ".scroll")
      if (virtualFiles[scrollPath]) return res.send(this.compileScrollFile(scrollPath))
      if (virtualFiles[siteFolder + scrollPath]) return res.send(this.compileScrollFile(siteFolder + scrollPath))

      // If the requested url ends in .csv, .grammar, et cetera, but is not found, set the content/type
      // back to HTML before sending the 404 page.
      res.setHeader("content-type", "text/html")
      res.status(404).send(notFoundPage)
    })
  }

  compileScrollFile(filepath: string) {
    const file = this.scrollFileSystem.getScrollFile(filepath)
    const destinationPath = Utils.ensureFolderEndsInSlash(file.folderPath) + file.permalink
    this.scrollFileSystem.write(destinationPath, file.html)
    return this.virtualFiles[destinationPath]
  }

  stopListening() {
    if (this.httpServer) this.httpServer.close()
    if (this.httpsServer) this.httpServer.close()
  }

  httpServer: any
  httpsServer: any
  listen(port: number) {
    this.beforeListen()
    this.httpServer = this.app.listen(port, () => console.log(`TrueBase server running: \ncmd+dblclick: http://localhost:${port}/`))
    return this
  }

  listenProd() {
    this.gitOn = true
    this.port = 443
    this.beforeListen()
    const { ignoreFolder } = this.settings
    const key = fs.readFileSync(path.join(ignoreFolder, "privkey.pem"))
    const cert = fs.readFileSync(path.join(ignoreFolder, "fullchain.pem"))
    this.httpsServer = https
      .createServer(
        {
          key,
          cert
        },
        this.app
      )
      .listen(this.port)

    const redirectApp = express()
    redirectApp.use((req: any, res: any) => res.redirect(301, `https://${req.headers.host}${req.url}`))
    this.httpServer = redirectApp.listen(80, () => console.log(`Running redirect app`))
    return this
  }

  testPerfCommand() {
    this.startDevServerCommand()
    this.stopListening()
  }

  port?: number
  startDevServerCommand(port = this.settings.devPort) {
    port = port
    this.listen(port)
  }

  startProdServerCommand() {
    this.listenProd()
  }

  get jsFiles() {
    const { grammarIgnoreFolder, grammarId } = this
    return `${jtreeFolder}/products/Utils.browser.js
${jtreeFolder}/products/TreeNode.browser.js
${jtreeFolder}/products/GrammarLanguage.browser.js
${jtreeFolder}/products/GrammarCodeMirrorMode.browser.js
${jtreeFolder}/sandbox/lib/codemirror.js
${jtreeFolder}/sandbox/lib/show-hint.js
${grammarIgnoreFolder}/${grammarId}.browser.js
${grammarIgnoreFolder}/tql.browser.js
${browserAppFolder}/libs.js
${browserAppFolder}/autocompleter.js
${browserAppFolder}/TrueBaseBrowserApp.js`.split("\n")
  }

  get cssFiles() {
    return [path.join(jtreeFolder, "sandbox/lib/codemirror.css"), path.join(jtreeFolder, "sandbox/lib/codemirror.show-hint.css"), path.join(browserAppFolder, "TrueBaseTheme.css")]
  }

  get combinedCss() {
    return new ScrollFile(`gazetteCss\n tags false`).html + "\n" + this.cssFiles.map(Disk.read).join(`\n\n`)
  }

  get autocompleteJs() {
    const json = JSON.stringify(
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
    return `var autocompleteJs = ` + json + "\n\n"
  }

  get combinedJs() {
    return (
      this.autocompleteJs +
      this.jsFiles
        .map(filename => Disk.read(filename))
        .join(`;\n\n`)
        .replace(/SERVER_TIME_PARSER_NAME/g, `${this.grammarId}Parser`)
    )
  }

  warmJsAndCss() {
    const { virtualFiles } = this
    virtualFiles["/combined.js"] = this.combinedJs
    virtualFiles["/combined.css"] = this.combinedCss
  }

  warmSiteFolder() {
    // todo: turn scroll files into html files
    const { virtualFiles } = this
    const { siteFolder } = this.settings
    const defaultScrollFiles = Disk.getFiles(browserAppFolder).filter((file: string) => file.endsWith(".scroll"))
    defaultScrollFiles.forEach((file: string) => (virtualFiles[siteFolder + "/" + path.basename(file)] = Disk.read(file)))
    this.warmCsvFiles()

    Disk.recursiveReaddirSync(siteFolder, (filename: string) => {
      if (!filename.endsWith(".scroll")) return
      virtualFiles[filename] = Disk.read(filename)
    })
  }

  get grammarIgnoreFolder() {
    return path.join(this.settings.ignoreFolder, "grammar")
  }

  get grammarId() {
    return this.settings.trueBaseId
  }

  // todo: this still builds files to ignore folder. cleanup.
  warmGrammarFiles() {
    const { ignoreFolder } = this.settings
    const { folder, virtualFiles, grammarIgnoreFolder, grammarId } = this
    if (!Disk.exists(grammarIgnoreFolder)) Disk.mkdir(grammarIgnoreFolder)
    const tqlPath = path.join(__dirname, "..", "tql", "tql.grammar")
    const extendedTqlGrammar = new TreeNode(Disk.read(tqlPath))
    extendedTqlGrammar.getNode("columnNameCell").set("enum", folder.colNamesForCsv.join(" "))
    const extendedTqlName = `${grammarId}Tql`
    extendedTqlGrammar.getNode("tqlParser").setWord(`${extendedTqlName}Parser`)
    const extendedTqlFileName = `${extendedTqlName}.grammar`
    const extendedTqlPath = path.join(grammarIgnoreFolder, extendedTqlFileName)
    virtualFiles["/" + extendedTqlFileName] = extendedTqlGrammar.asString

    // todo
    Disk.write(extendedTqlPath, virtualFiles["/" + extendedTqlFileName])
    GrammarCompiler.compileGrammarForBrowser(extendedTqlPath, grammarIgnoreFolder + "/", false)
    const jsPath = GrammarCompiler.compileGrammarForNodeJs(extendedTqlPath, grammarIgnoreFolder + "/", true)
    this.extendedTqlParser = require(jsPath)

    const ids = folder.map((file: TrueBaseFile) => file.id).join(" ")
    const grammar = new TreeNode(folder.grammarCode)
    grammar.getNode("trueBaseIdCell").set("enum", ids)
    const grammarFileName = `${grammarId}.grammar`

    virtualFiles["/" + grammarFileName] = grammar.asString
    // todo
    const browserFileName = `${grammarId}.browser.js`
    const grammarPath = path.join(grammarIgnoreFolder, grammarFileName)
    Disk.write(grammarPath, virtualFiles["/" + grammarFileName])
    GrammarCompiler.compileGrammarForBrowser(grammarPath, grammarIgnoreFolder + "/", false)
    virtualFiles["/" + browserFileName] = Disk.read(path.join(grammarIgnoreFolder, browserFileName))
  }

  get statusPage() {
    const { folder } = this
    return `import header.scroll
title SITE_NAME Stats

${this.folder.dashboard}

import footer.scroll`
  }

  warmCsvFiles() {
    const { trueBaseId, siteFolder } = this.settings
    const { folder, virtualFiles } = this
    const { columnsCsvOutput } = folder
    const mainCsvFilename = `${trueBaseId}.csv`
    const mainCsvContent = folder.makeCsv(mainCsvFilename)
    virtualFiles["/" + mainCsvFilename] = mainCsvContent
    const compressedContent = zlib.gzipSync(Buffer.from(mainCsvContent))
    const compressedLink = "/" + mainCsvFilename + ".zip"
    virtualFiles[compressedLink] = compressedContent
    virtualFiles["/columns.csv"] = this.columnsCsv
    const delimiter = `!~DELIM~!`

    const csvTemplate = `import header.scroll
title SITE_NAME CSV File Documentation

css
 .scrollTableComponent td {
   max-width: 30ch;
 }
 .scrollTableComponent td:nth-child(5) {
   max-width: 20ch;
   white-space: nowrap;
   text-overflow: ellipsis;
 }

Download TRUEBASE_ID.csv
 link TRUEBASE_ID.csv

SITE_NAME builds one main CSV file. \`TRUEBASE_ID.csv\` contains ${folder.length} rows and ${folder.colNamesForCsv.length} columns and is ${numeral(mainCsvContent.length).format("0.0b")} uncompressed (${numeral(
      compressedContent.length
    ).format("0.0b")} <a href="${compressedLink}">compressed</a>). Every row is an entity and every entity is one row. You can also download the typed tree structured data as JSON.
 link TRUEBASE_ID.json JSON

# Column Documentation

table ${delimiter}
 ${columnsCsvOutput.columnsMetadataTree.toDelimited(delimiter, columnsCsvOutput.columnMetadataColumnNames, false).replace(/\n/g, "\n  ")}

The table above is also available as csv.
 link BASE_URL/columns.csv csv

import footer.scroll`

    this.virtualFiles[siteFolder + "/csv.scroll"] = csvTemplate
  }

  get columnsCsv() {
    return this.folder.columnsCsvOutput.columnsCsv
  }

  formatCommand() {
    this.folder.forEach((file: TrueBaseFile) => file.prettifyAndSave())
  }

  createFromTreeCommand() {
    TreeNode.fromDisk(path.join(this.settings.ignoreFolder, "create.tree")).forEach((node: any) => this.folder.createFile(node.childrenToString()))
  }

  createFromCsvCommand() {
    TreeNode.fromCsv(Disk.read(path.join(this.settings.ignoreFolder, "create.csv"))).forEach((node: any) => this.folder.createFile(node.childrenToString()))
  }

  createFromTsvCommand() {
    TreeNode.fromTsv(Disk.read(path.join(this.settings.ignoreFolder, "create.tsv"))).forEach((node: any) => this.folder.createFile(node.childrenToString()))
  }
  // Example: new PlanetsDB().changeListDelimiterCommand("originCommunity", " && ")
  changeListDelimiterCommand(field: string, newDelimiter: string) {
    this.folder.forEach((file: any) => {
      const hit = file.getNode(field)
      if (hit) {
        const parsed = file.parsed.getNode(field)
        hit.setContent(parsed.list.join(newDelimiter))
        file.save()
      }
    })
  }

  // Example: new PlanetsDB().replaceListItems("originCommunity", { "Apple Inc": "Apple" })
  replaceListItems(field: string, replacementMap: any) {
    const keys = Object.keys(replacementMap)
    const delimiter = " && "
    this.folder.forEach((file: any) => {
      const value = file.get(field)
      if (!value) return

      const values = value.split(delimiter).map((value: any) => (replacementMap[value] ? replacementMap[value] : value))

      const joined = values.join(delimiter)
      if (joined === value) return

      file.set(field, joined)
      file.prettifyAndSave()
    })
  }

  searchCommand() {
    console.log(new SearchServer(this.folder, this.settings.ignoreFolder).csv(process.argv.slice(3).join(" ")))
  }

  get testTree() {
    const { siteFolder } = this.settings
    const testTree: any = {}

    testTree.ensureNoErrorsInGrammar = (areEqual: any) => {
      const grammar = new grammarParser(this.folder.grammarCode)
      const grammarErrors = grammar.getAllErrors().map((err: any) => err.toObject())
      if (grammarErrors.length) console.log(grammarErrors)
      areEqual(grammarErrors.length, 0, `no errors in ${this.grammarId} grammar`)
    }

    testTree.ensureNoErrorsInScrollExtensions = (areEqual: any) => {
      const { grammarErrors } = new ScrollCli().getErrorsInFolder(siteFolder)
      if (grammarErrors.length) console.log(grammarErrors)
      areEqual(grammarErrors.length, 0, "no errors in scroll extensions")
    }

    testTree.ensureGoodFilenames = (areEqual: any) => {
      areEqual(this.folder.filesWithInvalidFilenames.length, 0, `all ${this.folder.length} filenames are valid`)
    }

    testTree.ensureNoErrorsInBlog = (areEqual: any) => {
      const checkScroll = (folderPath: string) => {
        // Do not check all ~5K generated scroll files for errors b/c redundant and wastes time.
        // Just check the Javascript one below.
        if (folderPath.includes("truebase")) return
        const { grammarErrors, scrollErrors } = new ScrollCli().getErrorsInFolder(folderPath)
        areEqual(grammarErrors.length + scrollErrors.length, 0, `no scroll errors in ${folderPath}`)
        //areEqual(folder.errors.length, 0, `no errors in ${folderPath}`)
      }

      const cli = new ScrollCli().silence()
      Object.keys(cli.findScrollsInDirRecursive(siteFolder)).map(checkScroll)
    }

    testTree.ensureNoErrorsInDb = (areEqual: any) => {
      const { errors } = this.folder
      if (errors.length) errors.forEach(err => console.log(err._node.root.get("title"), err._node.getFirstWordPath(), err))
      areEqual(errors.length, 0, "no errors in db")
    }

    // todo:
    // testTree.ensureFieldsAreTrimmed = (areEqual: any) => {
    // }
    return testTree
  }

  async testCommand() {
    const tap = require("tap")
    const { TestRacer } = require("jtree/products/TestRacer.js")
    const { trueBaseId } = this.settings

    const testAll = async () => {
      const fileTree: any = {}
      fileTree[`${trueBaseId}.truebase`] = this.testTree
      const runner = new TestRacer(fileTree)
      await runner.execute()
      runner.finish()
    }
    testAll()
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

    fs.appendFile(this.searchRequestLog, tree, function () {})
    return this
  }

  logAndRunSearch(originalQuery = "", format = "object", ip = "") {
    this.logQuery(originalQuery, ip, format)
    return (<any>this)[format](decodeURIComponent(originalQuery).replace(/\r/g, ""))
  }

  search(treeQLCode: string, tqlParser: any = genericTqlParser) {
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
      if (programErrors.length) throw new Error(programErrors.map((err: any) => err.message).join(" "))
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

export { SearchServer, TrueBaseServer }
