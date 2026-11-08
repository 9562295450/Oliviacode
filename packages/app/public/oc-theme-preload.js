;(function () {
  var key = "opencode-theme-id"
  var themeId = localStorage.getItem(key) || "owl"

  var scheme = localStorage.getItem("opencode-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode
  document.documentElement.style.backgroundColor = isDark ? "#0b0a10" : "#f6f4ef"
  // The boot splash paints before any theme stylesheet exists, so it resolves its
  // canvas from this property instead of a theme token that is not defined yet.
  document.documentElement.style.setProperty("--oc-boot-bg", isDark ? "#0b0a10" : "#f6f4ef")

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? "#0b0a10" : "#f6f4ef")

  if (themeId === "owl") return

  var css = localStorage.getItem("opencode-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "oc-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
