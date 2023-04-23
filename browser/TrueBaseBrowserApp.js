class TrueBaseBrowserApp {
  constructor() {
    window.app = this
  }

  localStorageKeys = {
    email: "email",
    password: "password",
    staged: "staged",
    author: "author"
  }

  get store() {
    return window.localStorage
  }

  get loggedInUser() {
    return this.store.getItem(this.localStorageKeys.email)
  }

  get author() {
    try {
      return this.store.getItem(this.localStorageKeys.author) || this.defaultAuthor
    } catch (err) {
      console.error(err)
    }

    return this.defaultAuthor
  }

  defaultAuthor = this.genDefaultAuthor()
  genDefaultAuthor() {
    let user = "region.platform.vendor"
    try {
      const region = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
      const platform = navigator.userAgentData?.platform ?? navigator.platform ?? ""
      const vendor = navigator.vendor ?? ""
      // make sure email address is not too long. i think 64 is the limit.
      // so here length is max 45 + 7 + 4 + 4.
      user = [region, platform, vendor].map(str => str.replace(/[^a-zA-Z]/g, "").substr(0, 15)).join(".")
    } catch (err) {
      console.error(err)
    }
    const hash = Utils.getRandomCharacters(7)
    return `Anon <${`anon.${user}.${hash}`}@${window.location.host}.com>`
  }

  render() {
    this.initAutocomplete("trueBaseThemeHeaderSearch")
    return this
  }

  // This method is currently used to enable autocomplete on: the header search, front page search, 404 page search
  initAutocomplete(elementId) {
    const autocompleteSearchIndex = window.autocompleteJs || [] // todo: cleanup?
    const input = document.getElementById(elementId)
    const urlParams = new URLSearchParams(window.location.search)
    const query = urlParams.get("q")
    if (query) input.value = query
    autocomplete({
      input,
      minLength: 1,
      emptyMsg: "No matching entities found",
      preventSubmit: true,
      fetch: async (query, update) => {
        const text = query.toLowerCase()
        const suggestions = autocompleteSearchIndex.filter(entity => entity.label.toLowerCase().startsWith(text))

        const htmlEncodedQuery = query.replace(/</g, "&lt;")

        suggestions.push({
          label: `Full text search for "${htmlEncodedQuery}"`,
          id: "",
          url: `/fullTextSearch?q=${htmlEncodedQuery}`
        })
        update(suggestions)
      },
      onSelect: item => {
        const { url, id } = item
        if (id) window.location = url
        else window.location = "/fullTextSearch?q=" + encodeURIComponent(input.value)
      }
    })
  }

  hideUserAccountsButtons() {
    jQuery(".loggedIn,.notLoggedIn").hide()
  }

  revealUserAccountButtons() {
    if (this.loggedInUser) jQuery("#logoutButton").attr("title", `Logout of ${this.store.getItem(this.localStorageKeys.email)}`)
    else {
      jQuery(".loggedIn").hide()
      jQuery(".notLoggedIn").show()
    }
  }

  logoutCommand() {
    this.store.clear()
    jQuery(".loginMessage").show()
    jQuery(".loginMessage").html(`You are now logged out.`)
    this.hideUserAccountsButtons()
    this.revealUserAccountButtons()
  }

  async attemptLoginCommand() {
    const params = new URLSearchParams(window.location.search)
    const email = params.get("email")
    const password = params.get("password")
    window.history.replaceState({}, null, "login.html")
    if (this.loggedInUser) {
      jQuery("#loginResult").html(`You are already logged in as ${this.loggedInUser}`)
      return
    }
    if (!email || !password) {
      jQuery("#loginResult").html(`Email and password not in url. Try clicking your link again? If you think this is a bug please email us.`)
      return
    }

    const response = await fetch("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    })

    const el = document.querySelector("#loginResult")
    if (response.status === 200) {
      el.innerHTML = `You are logged in as ${email}`
      this.store.setItem(this.localStorageKeys.email, email)
      this.store.setItem(this.localStorageKeys.password, password)
      this.hideUserAccountsButtons()
      this.revealUserAccountButtons()
      this.shootConfettiCommand()
    } else {
      console.error(response)
      el.innerHTML = `Sorry. Something went wrong. If you think this is a bug please email us.`
    }
  }

  get loginMessageElement() {
    return document.querySelector("#loginMessage")
  }

  get loginEmailElement() {
    return document.querySelector("#loginEmail")
  }

  async verifyEmailAndSendLoginLinkCommand() {
    const { loginEmailElement, loginMessageElement } = this
    const email = loginEmailElement.value
    const htmlEscapedEmail = Utils.htmlEscaped(email)
    loginMessageElement.style.display = "inline-block"
    if (!Utils.isValidEmail(email)) {
      loginMessageElement.innerHTML = `<span class="error">'${htmlEscapedEmail}' is not a valid email.</span>`
      return
    }
    jQuery(".notLoggedIn").hide()

    let elapsed = 0
    const interval = setInterval(() => (loginMessageElement.innerHTML = `Sending login link... ${++elapsed / 10}s`), 100)

    const response = await fetch("/sendLoginLink", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    })
    clearInterval(interval)
    const text = await response.text()

    if (response.status === 200) loginMessageElement.innerHTML = `Login link sent to '${htmlEscapedEmail}'.`
    else loginMessageElement.innerHTML = `<span class="error">Error: ${text}</span>`
  }

  renderSearchPage() {
    this.startTQLCodeMirror()
  }

  async startTQLCodeMirror() {
    this.fileParser = tqlParser
    this.codeMirrorInstance = new GrammarCodeMirrorMode("custom", () => tqlParser, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("tqlInput"), {
      lineWrapping: false,
      lineNumbers: false
    })

    this.codeMirrorInstance.setSize(400, 100)
    this.codeMirrorInstance.setValue((new URLSearchParams(window.location.search).get("q") || "").replace(/\r/g, ""))
    this.codeMirrorInstance.on("keyup", () => this._onCodeKeyUp())
  }

  _onCodeKeyUp() {
    const code = this.value
    if (this._code === code) return
    this._code = code
    this.program = new this.fileParser(code)
    const errs = this.program.scopeErrors.concat(this.program.getAllErrors())

    const errMessage = errs.length ? errs.map(err => err.message).join(" ") : "&nbsp;"
    document.getElementById("tqlErrors").innerHTML = errMessage
  }

  get value() {
    return this.codeMirrorInstance.getValue()
  }

  async renderEditPage() {
    this.renderCodeEditorStuff()
    await this.initEditData()
  }

  renderCreatePage() {
    this.renderCodeEditorStuff()
    try {
      // todo: there's gotta be a better way
      const example = new this.fileParser().root.definition.filter(node => node.has("root"))[0].examples[0].childrenToString()
      document.getElementById("exampleSection").innerHTML = `Example:<br><pre>${example}</pre>`
    } catch (err) {
      console.log(err)
    }
  }

  renderCodeEditorStuff() {
    this.renderForm()
    this.startCodeMirrorEditor()
    this.bindStageButton()
    this.updateStagedStatus()
    this.updateAuthor()
  }

  async initEditData() {
    const { filename, currentFileId } = this
    const localValue = this.stagedFiles.getNode(filename)
    let response = await fetch(`/edit.json?id=${currentFileId}`)
    const data = await response.json()

    if (data.error) return (document.getElementById("formHolder").innerHTML = data.error)

    document.getElementById("pageTitle").innerHTML = `Editing file <i>${filename}</i>`

    this.codeMirrorInstance.setValue(localValue ? localValue.childrenToString() : data.content)
    document.getElementById("missingRecommendedColumnNames").innerHTML = `<br><b>Missing recommended columns:</b><br>${data.missingRecommendedColumnNames.join("<br>")}`

    document.getElementById("helpfulResearchLinks").innerHTML = data.helpfulResearchLinks
  }

  updateStagedStatus() {
    const el = document.getElementById("stagedStatus")
    const { stagedFiles } = this
    el.style.display = "none"
    if (!stagedFiles.length) return
    document.getElementById("patch").value = stagedFiles.asString
    el.style.display = "block"
  }

  bindStageButton() {
    const el = document.getElementById("stageButton")
    el.onclick = () => {
      const tree = this.stagedFiles
      tree.touchNode(this.filename).setChildren(this.value)
      this.setStage(tree.asString)
      this.updateStagedStatus()
    }

    Mousetrap.bind("mod+s", evt => {
      el.click()
      evt.preventDefault()
      return false
    })
  }

  setStage(str) {
    this.store.setItem(this.localStorageKeys.staged, str)
    document.getElementById("patch").value = str
  }

  get stagedFiles() {
    const str = this.store.getItem(this.localStorageKeys.staged)
    return str ? new TreeNode(str) : new TreeNode()
  }

  renderForm() {
    document.getElementById("formHolder").innerHTML = `<form method="POST" action="/saveCommitAndPush" id="stagedStatus" style="display: none;">
 <div>You have a patch ready to submit. Author is set as: <span id="authorLabel" class="linkButton" onClick="app.changeAuthor()"></span></div>
 <textarea id="patch" name="patch" readonly></textarea><br>
 <input type="hidden" name="author" id="author" />
 <input type="submit" value="Commit and push" id="saveCommitAndPushButton" onClick="app.saveAuthorIfUnsaved()"/> <a class="linkButton" onClick="app.clearChanges()">Clear local changes</a>
</form>
<div id="editForm">
 <div class="cell" id="leftCell">
   <textarea id="fileContent"></textarea>
   <div id="tqlErrors"></div> <!-- todo: cleanup. -->
 </div>
 <div class="cell">
   <div id="helpfulResearchLinks"></div>
   <div id="missingRecommendedColumnNames"></div>
   <div id="exampleSection"></div>
 </div>
 <div>
   <button id="stageButton">Stage</button>
 </div>
</div>`
  }

  clearChanges() {
    if (confirm("Are you sure you want to delete all local changes? This cannot be undone.")) this.setStage("")
    this.updateStagedStatus()
  }

  async startCodeMirrorEditor() {
    this.fileParser = SERVER_TIME_PARSER_NAME // replaced at server time.
    this.codeMirrorInstance = new GrammarCodeMirrorMode("custom", () => SERVER_TIME_PARSER_NAME, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("fileContent"), {
      lineWrapping: false,
      lineNumbers: true
    })

    this.codeMirrorInstance.setSize(this.codeMirrorWidth, 500)
    this.codeMirrorInstance.on("keyup", () => this._onCodeKeyUp())
  }

  get currentFileId() {
    return new URLSearchParams(window.location.search).get("id")
  }

  get fileExtension() {
    return new this.fileParser().fileExtension
  }

  get filename() {
    if (location.pathname.includes("create.html")) return "create"
    return this.currentFileId + "." + this.fileExtension
  }

  get codeMirrorWidth() {
    return document.getElementById("leftCell").width
  }

  updateAuthor() {
    document.getElementById("authorLabel").innerHTML = Utils.htmlEscaped(this.author)
    document.getElementById("author").value = this.author
  }

  get store() {
    return window.localStorage
  }

  saveAuthorIfUnsaved() {
    try {
      if (!this.store.getItem(this.localStorageKeys.author)) this.saveAuthor(this.defaultAuthor)
    } catch (err) {
      console.error(err)
    }
  }

  saveAuthor(name) {
    try {
      this.store.setItem(this.localStorageKeys.author, name)
    } catch (err) {
      console.error(err)
    }
  }

  changeAuthor() {
    const newValue = prompt(`Enter author name and email formatted like "Breck Yunits <by@breckyunits.com>". This information is recorded in the public Git log.`, this.author)
    if (newValue === "") this.saveAuthor(this.defaultAuthor)
    if (newValue) this.saveAuthor(newValue)
    this.updateAuthor()
  }

  get route() {
    return location.pathname.split("/")[1]
  }

  shootConfettiCommand(duration = 500) {
    var count = 200
    var defaults = {
      origin: { y: 0.7 }
    }

    function fire(particleRatio, opts) {
      confetti(
        Object.assign({}, defaults, opts, {
          particleCount: Math.floor(count * particleRatio)
        })
      )
    }

    fire(0.25, {
      spread: 26,
      startVelocity: 55
    })
    fire(0.2, {
      spread: 60
    })
    fire(0.35, {
      spread: 100,
      decay: 0.91,
      scalar: 0.8
    })
    fire(0.1, {
      spread: 120,
      startVelocity: 25,
      decay: 0.92,
      scalar: 1.2
    })
    fire(0.1, {
      spread: 120,
      startVelocity: 45
    })
    return this
  }
}
