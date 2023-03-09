class TrueBaseBrowserApp {
  constructor() {
    window.app = this
  }

  localStorageKeys = {
    email: "email",
    password: "password"
  }

  domainName = "truebase.pub"

  get store() {
    return window.localStorage
  }

  get loggedInUser() {
    return this.store.getItem(this.localStorageKeys.email)
  }

  searchIndex = false
  searchIndexRequestMade = false

  render() {
    this.initAutocomplete("trueBaseThemeHeaderSearch")
    return this
  }

  // This method is currently used to enable autocomplete on: the header search, front page search, 404 page search
  initAutocomplete(elementId) {
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
        // you can also use AJAX requests instead of preloaded data
        if (!this.searchIndexRequestMade) {
          this.searchIndexRequestMade = true
          let response = await fetch("/dist/autocomplete.json")
          if (response.ok) this.searchIndex = await response.json()
        }

        const suggestions = this.searchIndex.filter(entity => entity.label.toLowerCase().startsWith(text))

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
    if (this.loggedInUser) {
      jQuery(".loggedIn").show()
      jQuery("#logoutButton").attr("title", `Logout of ${this.store.getItem(this.localStorageKeys.email)}`)
    } else jQuery(".notLoggedIn").show()
  }

  logoutCommand() {
    this.store.clear()
    jQuery(".loginMessage").show()
    jQuery(".loginMessage").html(`You are now logged out.`)
    this.hideUserAccountsButtons()
    this.revealUserAccountButtons()
  }

  attemptLoginCommand() {
    const params = new URLSearchParams(window.location.search)
    const email = params.get("email")
    const password = params.get("password")
    window.history.replaceState({}, null, "login.html")
    if (this.loggedInUser) {
      jQuery("#loginResult").html(`You are already logged in as ${this.loggedInUser}`)
      return
    }
    if (!email || !password) {
      jQuery("#loginResult").html(`Email and password not in url. Try clicking your link again? If you think this is a bug please email loginProblems@${domainName}`)
      return
    }
    jQuery.post("/login", { email, password }, data => {
      if (data === "OK") {
        jQuery("#loginResult").html(`You are logged in as ${email}`)
        this.store.setItem(this.localStorageKeys.email, email)
        this.store.setItem(this.localStorageKeys.password, password)
        this.hideUserAccountsButtons()
        this.revealUserAccountButtons()
      } else jQuery("#loginResult").html(`Sorry. Something went wrong. If you think this is a bug please email loginProblems@${domainName}`)
    })
  }

  verifyEmailAndSendLoginLinkCommand() {
    // send link
    const email = jQuery("#loginEmail").val()
    const htmlEscapedEmail = Utils.htmlEscaped(email)
    if (!Utils.isValidEmail(email)) {
      jQuery(".loginMessage").show()
      jQuery(".loginMessage").html(`'${htmlEscapedEmail}' is not a valid email.`)
      return
    }
    jQuery(".notLoggedIn").hide()
    jQuery.post("/sendLoginLink", { email }, data => {
      jQuery(".loginMessage").show()
      console.log(data)
      jQuery(".loginMessage").html(`Login link sent to '${htmlEscapedEmail}'.`)
    })
  }

  renderSearchPage() {
    this.startTQLCodeMirror()
  }

  async startTQLCodeMirror() {
    this.programCompiler = tqlNode
    this.codeMirrorInstance = new GrammarCodeMirrorMode("custom", () => tqlNode, undefined, CodeMirror).register().fromTextAreaWithAutocomplete(document.getElementById("tqlInput"), {
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
    this.program = new this.programCompiler(code)
    const errs = this.program.scopeErrors.concat(this.program.getAllErrors())

    const errMessage = errs.length ? errs.map(err => err.getMessage()).join(" ") : "&nbsp;"
    document.getElementById("tqlErrors").innerHTML = errMessage
  }

  get value() {
    return this.codeMirrorInstance.getValue()
  }
}
