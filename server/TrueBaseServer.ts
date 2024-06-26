const fs = require("fs")
const fse = require("fs-extra")
const path = require("path")
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
const { ScrollFile, ScrollFileSystem } = require("scroll-cli")

const jtreeProductsFolder = path.dirname(require.resolve("jtree"))
const zlib = require("zlib")

const browserAppFolder = path.join(__dirname, "..", "browser")

import { UserFacingErrorMessages } from "./ErrorMessages"
import { TrueBaseFolder, TrueBaseFile, SearchServer } from "./TrueBase"

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
    settings.measuresFolder = resolvePath(settings.measuresFolder, dirname)
    settings.conceptsFolder = resolvePath(settings.conceptsFolder, dirname)
    settings.queriesFolder = resolvePath(settings.queriesFolder, dirname)
    settings.ignoreFolder = resolvePath(settings.ignoreFolder, dirname)
    settings.siteFolder = resolvePath(settings.siteFolder, dirname)
    this.settings = settings
    this._folder = folder ? folder : new TrueBaseFolder().setSettings(settings)
    this.editLogPath = path.join(settings.ignoreFolder, "trueBaseServerLog.tree")
  }

  get folder() {
    return this._folder.loadFolder()
  }

  get staticFolders() {
    const { siteFolder, measuresFolder, conceptsFolder, queriesFolder } = this.settings
    return [{ folder: browserAppFolder }, { folder: siteFolder }, { folder: measuresFolder, nested: "/measures/" }, { folder: conceptsFolder, nested: "/concepts/" }, { folder: queriesFolder, nested: "/queries/" }]
  }

  get app() {
    if (this._app) return this._app

    const app = express()
    app.use(compression())
    this._app = app
    const { ignoreFolder, siteFolder, measuresFolder, conceptsFolder, queriesFolder } = this.settings
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
    this.staticFolders.forEach(folder => this.serveFolder(folder.folder, folder.nested))

    this._addSearchRoutes()
    this._initUserAccounts()

    app.get("/edit.json", (req: any, res: any) => {
      const { id } = req.query
      const file = this.folder.getFile(id)
      if (!file) return res.send(JSON.stringify({ error: "Not found" }))
      res.send(
        JSON.stringify({
          content: file.childrenToString(),
          topMissingMeasurements: file.topMissingMeasurements,
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

    app.post("/publishQuery", async (req: any, res: any) => {
      try {
        const { permalink, hash } = await this.saveQuery(req.body.query, req.body.author)
        res.send(JSON.stringify({ permalink, hash }, null, 2))
      } catch (error) {
        console.error(error)
        res.status(500).redirect(`/error.html?error=${encodeURIComponent(error)}`)
      }
    })

    // Short urls:
    app.get("/:id", (req: any, res: any, next: any) => (this.folder.getFile(req.params.id.toLowerCase()) ? res.status(302).redirect(`/concepts/${req.params.id.toLowerCase()}.html`) : next()))

    return this._app
  }

  async saveQuery(queryString: string, author: string) {
    const query = new TreeNode(Utils.removeReturnChars(queryString).trim())
    const permalink = Utils.titleToPermalink(query.get("title"))
    const filepath = path.join(this.settings.queriesFolder, permalink + ".tql")
    const { authorName, authorEmail } = this.parseGitAuthor(author)
    Disk.write(filepath, queryString)
    const hash = await this.saveCommitAndPush([filepath], authorName, authorEmail)
    delete this.folder._queriesTree // todo: cleanup
    delete this.queryCache[permalink + ".html"]
    return { hash, permalink }
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

  serveFolder(folder: string, nested?: string) {
    if (nested) this.app.use(nested, express.static(folder))
    else this.app.use(express.static(folder))
    return this
  }

  gitOn = false
  GIT_DEFAULT_USERNAME = "TrueBaseWebUI"
  GIT_DEFAULT_EMAIL = "truebasewebui@treenotation.org"

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
    if (!this.extendedTqlParser) throw new Error("Extended TQL needs to be built first.") // Todo: cleanup
    this.searchServer = new SearchServer(this.folder, this.settings.ignoreFolder, this.extendedTqlParser)
  }

  searchCommand() {
    // todo: cleanup
    this.warmGrammarFiles()
    this._initSearch()
    console.log(this.searchServer.csv(process.argv.slice(3).join(" ")))
  }

  _addSearchRoutes() {
    const { app, searchServer } = this
    this._initSearch()
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

    // The version 17 -> 18 change breaks "/questions/" links.
    // Add this redirect for a certain time to mitigate that.
    app.get("/questions/:question", (req: any, res: any) => res.redirect(`/queries/${req.params.question}`))
    app.get("/questions.html", (req: any, res: any) => res.redirect(`/queries.html`))

    app.get("/fullTextSearch", (req: any, res: any) => res.redirect(`/search.html?q=includes+${req.query.q}`))

    return this
  }

  parseScroll(scrollCode: string, virtualFilePath = `${this.settings.siteFolder}/random-${Utils.getRandomCharacters(24)}.scroll`) {
    // todo: eliminate need for virtualFilePath?
    // I believe we have that because we need import paths to work correctly. And perhaps to mix default files with overrides.
    this.virtualFiles[virtualFilePath] = scrollCode
    return new ScrollFile(scrollCode, virtualFilePath, this.scrollFileSystem)
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
  async dumpStaticSiteCommand(destinationPath = path.join(this.settings.ignoreFolder, "static")) {
    const { virtualFiles } = this
    const { siteFolder } = this.settings
    this.warmAll()

    this.folder.forEach((file: any) => (virtualFiles[siteFolder + `/concepts/${file.id}.scroll`] = file.toScroll()))

    this._initSearch()
    this.folder.queriesTree.forEach((query: any) => (virtualFiles[`/queries/${query.getLine().replace(".tql", "")}.html`] = this.searchToHtml(query.childrenToString())))

    Object.keys(virtualFiles)
      .filter(key => key.endsWith(".scroll"))
      .filter(key => !virtualFiles[key].match(/^importOnly/))
      .forEach(key => this.compileScrollFile(key))
    Disk.mkdir(destinationPath)
    const flatMap: any = {}

    this.staticFolders.forEach(async staticFolder => {
      // Copy all the files in the folder to the destination folder.
      const { folder, nested } = staticFolder
      // Use the fs module or the best possible npm package for this kind of job
      try {
        await fse.copy(folder, destinationPath + (nested ? nested : ""), { overwrite: true })
      } catch (err) {
        console.log(err)
      }
    })

    Object.keys(virtualFiles).forEach(key => (flatMap[key.replace(siteFolder, "")] = virtualFiles[key]))
    Disk.writeObjectToDisk(destinationPath, flatMap)
  }

  warmAll() {
    this.warmGrammarFiles()
    this.warmJsAndCss()
    this.warmSiteFolder()

    const { virtualFiles } = this

    virtualFiles["/visData.json"] = JSON.stringify(this.folder.sparsityVectors, undefined, 2)
    virtualFiles[`/${this.settings.trueBaseId}.json`] = this.folder.typedMapJson
  }

  beforeListen() {
    const { siteFolder } = this.settings
    process.title = this.settings.trueBaseId
    this.warmAll()

    const { virtualFiles } = this

    let notFoundPage = ""
    if (virtualFiles[siteFolder + "/404.scroll"]) notFoundPage = this.compileScrollFile(siteFolder + "/404.scroll")
    else notFoundPage = this.compileScrollFile(browserAppFolder + "/404.scroll")

    // Rows used to have the "/truebase" prefix until version 17. Keep this redirect in for a bit to not break external links.
    this.app.get("/truebase/:id", (req: any, res: any, next: any) => res.status(302).redirect(`/concepts/${req.params.id}`))

    // Do not convert the file to a Scroll until requested
    this.app.get("/concepts/:filename", (req: any, res: any, next: any) => {
      const virtualPath = siteFolder + "/" + req.params.filename
      if (virtualFiles[virtualPath]) return res.send(virtualFiles[virtualPath])

      const id = req.params.filename.replace(".html", "")
      const file = this.folder.getFile(id)
      if (file) virtualFiles[siteFolder + `/concepts/${file.id}.scroll`] = file.toScroll()
      next()
    })

    this.app.get("/queries/:filename", (req: any, res: any, next: any) => {
      if (this.queryCache[req.params.filename]) return res.send(this.queryCache[req.params.filename])

      const query = this.folder.queriesTree.getNode(req.params.filename.replace(".html", ""))
      if (query) {
        this.queryCache[req.params.filename] = this.searchToHtml(query.childrenToString(), `${req.protocol}://${req.get("host")}${req.originalUrl}`)
        return res.send(this.queryCache[req.params.filename])
      }

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

  queryCache: any = {}

  searchToHtml(originalQuery: string, canonicalLink = "") {
    return this.parseScroll(this.searchServer.searchToScroll(originalQuery, canonicalLink)).html
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
    return `${jtreeProductsFolder}/Utils.browser.js
${jtreeProductsFolder}/TreeNode.browser.js
${jtreeProductsFolder}/GrammarLanguage.browser.js
${jtreeProductsFolder}/GrammarCodeMirrorMode.browser.js
${jtreeProductsFolder}/../sandbox/lib/codemirror.js
${jtreeProductsFolder}/../sandbox/lib/show-hint.js
${grammarIgnoreFolder}/${grammarId}.browser.js
${grammarIgnoreFolder}/tql.browser.js
${browserAppFolder}/libs.js
${browserAppFolder}/autocompleter.js
${browserAppFolder}/TrueBaseBrowserApp.js`.split("\n")
  }

  get cssFiles() {
    return [path.join(jtreeProductsFolder, "../sandbox/lib/codemirror.css"), path.join(jtreeProductsFolder, "../sandbox/lib/codemirror.show-hint.css"), path.join(browserAppFolder, "TrueBaseTheme.css")]
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
          url: `/concepts/${file.id}.html`
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
    this.warmQueriesPage()

    virtualFiles[`${siteFolder}/stats.scroll`] = this.statusPage

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
    // Todo: cleanup
    if (this.extendedTqlParser) return

    const { ignoreFolder } = this.settings
    const { folder, virtualFiles, grammarIgnoreFolder, grammarId } = this
    if (!Disk.exists(grammarIgnoreFolder)) Disk.mkdir(grammarIgnoreFolder)
    const ids = folder.map((file: TrueBaseFile) => file.id).join(" ")
    const tqlPath = path.join(__dirname, "..", "tql", "tql.grammar")
    const extendedTqlGrammar = new TreeNode(Disk.read(tqlPath))
    extendedTqlGrammar.getNode("columnNameCell").set("enum", folder.colNamesForCsv.join(" "))
    extendedTqlGrammar.getNode("trueBaseIdCell").set("enum", ids)
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

startColumns 1
# SITE_NAME Visualized
<center>
<div id="modelVis"></div>
</center>
The image above has a pixel for each concept and measure in the database. The top left pixel represents the measure with the most measurements. The pixels then flow left to right, then top down, showing the measurement count for the measure with the next most measurements. After the pixels for measures comes a pixel for each concept.
endColumns

<script>document.addEventListener("DOMContentLoaded", () => TrueBaseBrowserApp.getApp().fetchAndVisualizeDb())</script>

import footer.scroll`
  }

  warmQueriesPage() {
    const { trueBaseId, siteFolder } = this.settings
    const mapQuery = (query: any) => `${query.get("title")}
 class query
 link /queries/${query.getLine().replace(".tql", "")}.html`

    this.virtualFiles[siteFolder + "/newQueries.scroll"] = `importOnly

${this.folder.queriesTree.map(mapQuery).join("\n")}`

    this.virtualFiles[siteFolder + "/queries.scroll"] = `import header.scroll
title SITE_NAME Queries

import newQueries.scroll

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
title SITE_NAME Measures

css
 .scrollTableComponent td {
   max-width: 30ch;
 }
 .scrollTableComponent td:nth-child(5) {
   max-width: 20ch;
   white-space: nowrap;
   text-overflow: ellipsis;
 }

Download TRUEBASE_ID.csv. 
 link TRUEBASE_ID.csv Download TRUEBASE_ID.csv

SITE_NAME contains ${folder.colNamesForCsv.length} measures on ${folder.length} concepts with ${folder.measurements} total measurements and builds one main CSV file. \`TRUEBASE_ID.csv\` is ${numeral(mainCsvContent.length).format(
      "0.0b"
    )} uncompressed (${numeral(compressedContent.length).format(
      "0.0b"
    )} <a href="${compressedLink}">compressed</a>). Every row is one concept and every concept is one row. Every measure is one column and every column is one measure. Every measurement is one non-empty cell and every non-empty cell is one measurement (excluding cells in the header row which contain the measure names). You can also download the typed tree structured data as JSON.
 link TRUEBASE_ID.json JSON

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

  get testTree() {
    const { siteFolder } = this.settings
    const testTree: any = {}

    testTree.ensureNoErrorsInGrammar = (areEqual: any) => {
      const grammar = new grammarParser(this.folder.grammarCode)
      const grammarErrors = grammar.getAllErrors().map((err: any) => err.toObject())
      if (grammarErrors.length) console.log(grammarErrors)
      areEqual(grammarErrors.length, 0, `no errors in ${this.grammarId} grammar`)
    }

    testTree.ensureGoodFilenames = (areEqual: any) => {
      areEqual(this.folder.filesWithInvalidFilenames.length, 0, `all ${this.folder.length} filenames are valid`)
    }

    testTree.ensureNoScrollErrors = (areEqual: any) => {
      this.beforeListen()
      Object.keys(this.virtualFiles)
        .filter(file => file.endsWith(".scroll"))
        .forEach(key => {
          const scrollFile = this.parseScroll(this.virtualFiles[key], key)
          const errors = scrollFile.scrollProgram.getAllErrors().map((err: any) => {
            return { filename: scrollFile.filename, ...err.toObject() }
          })
          if (errors.length) console.error(errors)
          areEqual(errors.length, 0)
        })
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

export { SearchServer, TrueBaseServer }
