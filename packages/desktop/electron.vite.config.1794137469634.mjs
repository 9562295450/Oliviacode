var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// electron.vite.config.ts
import { defineConfig } from "electron-vite";

// script/beta-notes.ts
var beta_notes_exports = {};
__export(beta_notes_exports, {
  BetaNotes: () => beta_notes_exports,
  describe: () => describe,
  embed: () => embed,
  enrich: () => enrich,
  parseSubject: () => parseSubject,
  visual: () => visual
});
import { execFileSync } from "node:child_process";
import { Option, Schema } from "effect";

// script/beta-visual.ts
var beta_visual_exports = {};
__export(beta_visual_exports, {
  BetaVisual: () => beta_visual_exports,
  sanitize: () => sanitize
});
import { DomUtils, parseDocument } from "htmlparser2";
var LIMIT = 8 * 1024;
var ELEMENTS = /* @__PURE__ */ new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "path",
  "text",
  "tspan",
  "title",
  "desc",
  "clipPath",
  "mask",
  "linearGradient",
  "radialGradient",
  "stop",
  "style",
  "animate",
  "animateTransform",
  "animateMotion",
  "set"
]);
var SMIL = /* @__PURE__ */ new Set(["animate", "animateTransform", "animateMotion", "set"]);
var ATTRIBUTES = /* @__PURE__ */ new Set([
  "id",
  "class",
  "style",
  "viewBox",
  "preserveAspectRatio",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "d",
  "points",
  "pathLength",
  "transform",
  "transform-origin",
  "href",
  "color",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "visibility",
  "display",
  "vector-effect",
  "paint-order",
  "clip-path",
  "clip-rule",
  "clipPathUnits",
  "mask",
  "maskUnits",
  "maskContentUnits",
  "offset",
  "stop-color",
  "stop-opacity",
  "gradientUnits",
  "gradientTransform",
  "spreadMethod",
  "font-size",
  "font-weight",
  "font-family",
  "letter-spacing",
  "text-anchor",
  "dominant-baseline",
  "attributeName",
  "attributeType",
  "values",
  "from",
  "to",
  "by",
  "dur",
  "begin",
  "end",
  "repeatCount",
  "repeatDur",
  "keyTimes",
  "keySplines",
  "keyPoints",
  "calcMode",
  "additive",
  "accumulate",
  "restart",
  "type",
  "rotate",
  "path"
]);
var TEXT = /* @__PURE__ */ new Set(["text", "tspan", "title", "desc", "style"]);
function sanitize(input) {
  if (input.length > LIMIT * 4 || /<!(doctype|entity|element|attlist)/i.test(input)) return void 0;
  const document = parseDocument(input.replace(/^\s*<\?xml[^>]*\?>/, ""), {
    xmlMode: true,
    recognizeCDATA: true,
    recognizeSelfClosing: true
  });
  const roots = document.children.filter(
    (node) => !DomUtils.isComment(node) && !(DomUtils.isText(node) && !node.data.trim())
  );
  const root = roots[0];
  if (roots.length !== 1 || !root || !DomUtils.isTag(root) || root.name !== "svg") return void 0;
  const animated = serialize(root, false);
  const still = serialize(root, true);
  if (animated === void 0 || still === void 0 || new TextEncoder().encode(animated).length > LIMIT)
    return void 0;
  return { animated, still };
}
function serialize(node, still) {
  if (!DomUtils.isTag(node) || !ELEMENTS.has(node.name)) return "";
  const name = node.name;
  if (SMIL.has(name) && (still || /href$/i.test(node.attribs.attributeName ?? ""))) return "";
  const attributes = Object.entries(node.attribs).flatMap(([key, value]) => {
    const attribute2 = key === "xlink:href" ? "href" : key;
    if (!ATTRIBUTES.has(attribute2)) return [];
    if (attribute2 === "href" && !/^#[\w-]+$/.test(value)) return [];
    if (attribute2 === "style") return [[attribute2, declarations(value, still)]];
    return [[attribute2, safe(value) ? value : void 0]];
  });
  if (attributes.some(([, value]) => value === void 0)) return void 0;
  const children = node.children.map((child) => {
    if (DomUtils.isTag(child)) return serialize(child, still);
    if (DomUtils.isCDATA(child) || DomUtils.isText(child)) return text(name, DomUtils.textContent(child), still);
    return "";
  });
  if (children.includes(void 0)) return void 0;
  const open = [
    name,
    ...name === "svg" ? [`xmlns="http://www.w3.org/2000/svg"`] : [],
    ...attributes.map(([key, value]) => `${key}="${escape(value)}"`)
  ].join(" ");
  const body = children.join("");
  return body ? `<${open}>${body}</${name}>` : `<${open}/>`;
}
function text(element, value, still) {
  if (!TEXT.has(element)) return "";
  if (element !== "style") return escape(value);
  const css = stylesheet(value, still);
  return css === void 0 ? void 0 : escape(css);
}
function stylesheet(value, still) {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!safe(css) || /@(?!(-webkit-)?keyframes\b|media\b)/i.test(css)) return void 0;
  if (!still) return css.trim();
  return withoutKeyframes(css).replace(/\{([^{}]*)\}/g, (_, body) => `{${declarations(body, true)}}`).trim();
}
function declarations(value, still) {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "");
  if (!safe(css)) return void 0;
  if (!still) return css.trim();
  return css.split(";").filter((declaration) => !/^\s*(-webkit-)?(animation|transition)(-[\w-]+)?\s*:/i.test(declaration)).join(";").trim();
}
function withoutKeyframes(css) {
  const start = css.search(/@(-webkit-)?keyframes\b/i);
  if (start === -1) return css;
  const open = css.indexOf("{", start);
  if (open === -1) return css.slice(0, start);
  const end = Array.from(css.slice(open)).reduce(
    (state, char, index) => {
      if (state.end !== -1) return state;
      const depth = state.depth + ({ "{": 1, "}": -1 }[char] ?? 0);
      return { depth, end: depth === 0 ? open + index + 1 : -1 };
    },
    { depth: 0, end: -1 }
  ).end;
  return css.slice(0, start) + (end === -1 ? "" : withoutKeyframes(css.slice(end)));
}
function safe(value) {
  return !value.includes("\\") && !/@import/i.test(value) && !/url\(\s*(?!['"]?#)/i.test(value);
}
function escape(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// script/beta-notes.ts
var LIMIT2 = 200;
var SHORT = 12;
var KEPT = /* @__PURE__ */ new Set(["feat", "fix", "perf"]);
var FIELD = "";
var RECORD = "";
var REPOSITORY = { owner: "anomalyco", name: "opencode" };
var BATCH = 100;
var DESCRIPTION = 240;
function embed(input = {}) {
  const git = (...args) => execFileSync("git", args, { cwd: input.cwd, encoding: "utf8" });
  const sha = git("rev-parse", input.head ?? process.env.GITHUB_SHA ?? "HEAD").trim();
  const log = git(
    "log",
    "--topo-order",
    `--max-count=${LIMIT2}`,
    `--format=%H${FIELD}%P${FIELD}%an${FIELD}%s${RECORD}`,
    sha
  );
  const records = log.split(RECORD).map((record) => record.trim().split(FIELD)).filter((fields) => fields.length === 4 && fields[0]);
  return {
    sha,
    commits: records.map(([commit]) => commit.slice(0, SHORT)),
    notes: records.flatMap(([commit, parents, author2, subject]) => {
      if (parents.trim().split(/\s+/).length > 1) return [];
      const note = parseSubject(subject);
      if (!note) return [];
      return [{ ...note, sha: commit.slice(0, SHORT), author: author2.trim() ? { name: author2.trim() } : void 0 }];
    })
  };
}
async function enrich(embedded, input) {
  const numbers = [...new Set(embedded.notes.flatMap((note) => note.pr ?? []))];
  const token = input.token;
  if (!token || numbers.length === 0) return embedded;
  const batches = Array.from(
    { length: Math.ceil(numbers.length / BATCH) },
    (_, i) => numbers.slice(i * BATCH, (i + 1) * BATCH)
  );
  const found = new Map(
    (await Promise.all(batches.map((batch) => pullRequests(batch, token, input.fetch ?? fetch)))).flat()
  );
  return {
    ...embedded,
    notes: embedded.notes.map((note) => {
      const pr = note.pr === void 0 ? void 0 : found.get(note.pr);
      if (!pr) return note;
      return {
        ...note,
        author: pr.author ? author(pr.author) : note.author,
        description: describe(pr.body, note.summary),
        visual: visual(pr.body)
      };
    })
  };
}
function describe(body, summary) {
  const heading = (line) => /^#{1,6}\s/.test(line) || /^\*\*[^*]+\*\*:?$/.test(line);
  const lines = body.replace(/<!--[\s\S]*?-->|```[\s\S]*?```/g, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => heading(line) || !BOILERPLATE.some((pattern) => pattern.test(line)));
  const until = (rest) => {
    const end = rest.findIndex(heading);
    return end === -1 ? rest : rest.slice(0, end);
  };
  const section = (title) => {
    const start = lines.findIndex((line) => heading(line) && title.test(line));
    return start === -1 ? [] : until(lines.slice(start + 1));
  };
  const words = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return [section(/what does this pr do|summary/i), until(lines), section(/^\W*(what )?chang|solution/i)].map((candidate) => {
    const paragraph = candidate.join("\n").split(/\n\s*\n/).map((block) => plain(block.split("\n").find((line) => /^([-*+]|\d+\.)\s/.test(line)) ?? block)).find(
      (text3) => text3 && !/^(\[.\]|(closes|fixes|resolves|stacked on|depends on|n\/a|please provide)\b)/i.test(text3)
    );
    const [first, second] = (paragraph ?? "").split(/(?<=[.!?])\s+(?=[A-Z0-9"'`(])/).filter((sentence) => sentence && !sentence.endsWith(":"));
    const text2 = first && second && `${first} ${second}`.length <= DESCRIPTION ? `${first} ${second}` : first;
    return text2 && /^[A-Z0-9"“]/.test(text2) && words(text2) !== words(summary) ? cap(text2) : void 0;
  }).find((text2) => text2 !== void 0);
}
function visual(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+visual\b/i.test(line.trim()));
  if (start === -1) return void 0;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line.trim()));
  const block = (end === -1 ? rest : rest.slice(0, end)).join("\n").match(/```svg[^\n]*\n([\s\S]*?)\n\s*```/)?.[1];
  return block ? beta_visual_exports.sanitize(block) : void 0;
}
var BOILERPLATE = [
  /^\W*(issue for this pr|type of change|how did you verify|screenshots|checklist)\b/i,
  /^[-*+]\s*\[[ x]\]/i,
  /^\W*(n\/a|none|tbd)\W*$/i,
  /^\W*((closes|fixes|resolves)\s*)?([\w.-]+\/[\w.-]+)?#\d*\W*$/i
];
function cap(text2) {
  if (text2.length <= DESCRIPTION) return text2;
  const cut = text2.slice(0, DESCRIPTION - 1).replace(/\s+\S*$/, "");
  return `${cut.replace(/[\s,;:—–-]+$/, "")}\u2026`;
}
function plain(markdown) {
  return markdown.replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s*\([^()]*`[^()]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, "").replace(/^\s*(?:[-*+]|\d+\.|>)\s+/gm, "").replace(/(\*\*|__|`)/g, "").replace(/\s+/g, " ").trim();
}
var Author = Schema.Struct({
  login: Schema.String,
  avatarUrl: Schema.optional(Schema.String),
  name: Schema.optional(Schema.NullOr(Schema.String))
});
var PullRequest = Schema.Struct({ number: Schema.Number, body: Schema.String, author: Schema.NullOr(Author) });
var Response = Schema.Struct({
  data: Schema.Struct({ repository: Schema.Record(Schema.String, Schema.NullOr(PullRequest)) })
});
var decodeResponse = Schema.decodeUnknownOption(Response);
async function pullRequests(numbers, token, request) {
  const fields = numbers.map(
    (n) => `pr${n}: pullRequest(number: ${n}) { number body author { login avatarUrl(size: 48) ... on User { name } } }`
  ).join("\n");
  const query = `query { repository(owner: "${REPOSITORY.owner}", name: "${REPOSITORY.name}") { ${fields} } }`;
  const response = await request("https://api.github.com/graphql", {
    method: "POST",
    headers: { authorization: `bearer ${token}`, "content-type": "application/json", "user-agent": "opencode-desktop" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(1e4)
  }).then((result) => result.ok ? result.json() : void 0).catch(() => void 0);
  return Option.match(decodeResponse(response), {
    onNone: () => [],
    onSome: (decoded) => Object.values(decoded.data.repository).flatMap((pr) => pr ? [[pr.number, pr]] : [])
  });
}
function author(input) {
  const avatar = input.avatarUrl?.startsWith("https://avatars.githubusercontent.com/") ? input.avatarUrl : void 0;
  return { name: input.name?.trim() || input.login, login: input.login, avatar };
}
function parseSubject(subject) {
  const match = subject.trim().match(/^(\w+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/);
  const type = match?.[1]?.toLowerCase();
  if (!match || !type || !isKept(type)) return void 0;
  const pr = match[4].match(/\s*\(#(\d+)\)\s*$/);
  const summary = (pr ? match[4].slice(0, pr.index) : match[4]).trim();
  if (!summary) return void 0;
  const note = { type, summary };
  const scope = match[2]?.trim();
  if (scope) note.scope = scope;
  if (match[3]) note.breaking = true;
  if (pr) note.pr = Number(pr[1]);
  return note;
}
function isKept(type) {
  return KEPT.has(type);
}
if (import.meta.main)
  console.log(
    JSON.stringify(await enrich(embed({ head: process.argv[2] }), { token: process.env.GITHUB_TOKEN }), null, 2)
  );

// script/picker.ts
import picker from "@brendonovich/vite-plugin-opencode";
import MagicString from "magic-string";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseSync, Visitor } from "vite";
var attribute = "data-opencode-picker-source";
function pickerPlugin() {
  const plugin = picker();
  const client = "/__vite_opencode_picker_client.js";
  let workspaceRoot = "";
  return {
    ...plugin,
    configResolved(config) {
      plugin.configResolved(config);
      workspaceRoot = gitRoot(config.root);
    },
    resolveId(id) {
      return plugin.resolveId(id === client ? "virtual:vite-opencode-picker/client" : id);
    },
    configureServer(server) {
      server.middlewares.use(client, (_request, response) => {
        response.setHeader("content-type", "text/javascript");
        response.end(plugin.load(plugin.resolveId("virtual:vite-opencode-picker/client")));
      });
      plugin.configureServer(server);
    },
    transformIndexHtml: {
      order: "pre",
      handler() {
        return [{ tag: "script", attrs: { type: "module", src: client }, injectTo: "body" }];
      }
    },
    // The package tags elements through a Babel parse and print of every component, a second Babel
    // pass on top of Solid's. Inserting the attribute where Oxc finds each element gives the same tags
    // at about a quarter of the cost, which the first renderer bundle waits on.
    transform(code, id) {
      const file = id.split("?", 1)[0];
      if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) return;
      const source = relative(workspaceRoot, file).replaceAll(sep, "/");
      if (source.startsWith("../")) return;
      const parsed = parseSync(file, code);
      if (parsed.errors.length) return;
      const lines = [0, ...Array.from(code.matchAll(/\n/g), (match) => match.index + 1)];
      const output = new MagicString(code);
      new Visitor({
        JSXOpeningElement(node) {
          if (node.name.type !== "JSXIdentifier" || !/^[a-z]/.test(node.name.name)) return;
          if (node.attributes.some((item) => item.type === "JSXAttribute" && item.name.name === attribute)) return;
          const line = lines.findLastIndex((start) => start <= node.start) + 1;
          output.appendLeft(node.selfClosing ? node.end - 2 : node.end - 1, ` ${attribute}="${source}:${line}"`);
        }
      }).visit(parsed.program);
      if (!output.hasChanged()) return;
      return { code: output.toString(), map: output.generateMap({ hires: "boundary", source: file }) };
    }
  };
}
function gitRoot(root) {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return resolve(root);
  }
}

// script/utils.ts
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname as dirname2, join as join2 } from "node:path";
import { Option as Option2, Schema as Schema2 } from "effect";
var Manifest = Schema2.fromJsonString(Schema2.Struct({ version: Schema2.NonEmptyString }));
var CLI_BINARIES = [
  {
    target: "darwin-arm64",
    package: "@opencode/cli-darwin-arm64",
    os: "darwin",
    cpu: "arm64"
  },
  {
    target: "darwin-x64",
    package: "@opencode/cli-darwin-x64-baseline",
    os: "darwin",
    cpu: "x64"
  },
  {
    target: "windows-arm64",
    package: "@opencode/cli-windows-arm64",
    os: "win32",
    cpu: "arm64"
  },
  {
    target: "windows-x64",
    package: "@opencode/cli-windows-x64-baseline",
    os: "win32",
    cpu: "x64"
  },
  {
    target: "linux-x64",
    package: "@opencode/cli-linux-x64-baseline",
    os: "linux",
    cpu: "x64"
  },
  {
    target: "linux-arm64",
    package: "@opencode/cli-linux-arm64",
    os: "linux",
    cpu: "arm64"
  }
];
function nativeTarget() {
  const { platform, arch } = process;
  if (platform === "darwin") return arch === "arm64" ? "darwin-arm64" : "darwin-x64";
  if (platform === "win32") return arch === "arm64" ? "windows-arm64" : "windows-x64";
  if (platform === "linux") return arch === "arm64" ? "linux-arm64" : "linux-x64";
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}
function getCurrentCli(target = process.env.OPENCODE_TARGET ?? nativeTarget()) {
  const binaryConfig = CLI_BINARIES.find((item) => item.target === target);
  if (!binaryConfig) throw new Error(`CLI configuration not available for target '${target}'`);
  return binaryConfig;
}
function nodePtyPackage(target) {
  const cli = getCurrentCli(target);
  return `@lydell/node-pty-${cli.os}-${cli.cpu}`;
}

// electron.vite.config.ts
function resolveChannel() {
  const raw = process.env.OPENCODE_CHANNEL;
  if (raw === "local" || raw === "dev" || raw === "beta" || raw === "prod") return raw;
  if (raw === "latest") return "prod";
  return "dev";
}
var appPlugin = (await import("@opencode/app/vite")).default;
var initialGraph = /* @__PURE__ */ new Set();
var initialChunk = {
  name: "opencode-desktop:initial-chunk",
  renderStart() {
    const entries = [...this.getModuleIds()].filter((id) => this.getModuleInfo(id)?.isEntry);
    initialGraph.clear();
    entries.forEach((id) => initialGraph.add(id));
    for (const id of initialGraph) this.getModuleInfo(id)?.importedIds.forEach((imported) => initialGraph.add(imported));
  }
};
var electron_vite_config_default = defineConfig(async ({ command }) => {
  const channel = resolveChannel();
  const nodePtyPkg = nodePtyPackage();
  const betaNotes = channel === "beta" ? await beta_notes_exports.enrich(beta_notes_exports.embed(), { token: process.env.GITHUB_TOKEN }) : command === "serve" ? beta_notes_exports.embed() : void 0;
  return {
    main: {
      resolve: {
        dedupe: ["effect"]
      },
      define: {
        // Local renderer/server mode still uses the dev application identity and updater policy.
        "import.meta.env.OPENCODE_CHANNEL": JSON.stringify(channel === "local" ? "dev" : channel)
      },
      build: {
        minify: command === "build",
        rolldownOptions: {
          input: { index: "src/main/index.ts" },
          output: {
            format: "es",
            // DesktopPaths resolves resources from the main output directory,
            // including when the lazy desktop entry shares it with other chunks.
            chunkFileNames: "[name]-[hash].js"
          }
        },
        externalizeDeps: {
          // Bundle the Effect family together.
          exclude: ["effect", "@effect/platform-node", "@effect/platform-node-shared", "drizzle-orm"],
          include: [nodePtyPkg]
        }
      },
      plugins: [
        {
          name: "opencode:node-pty-narrower",
          enforce: "pre",
          resolveId(s) {
            if (s === "@lydell/node-pty") return nodePtyPkg;
            return void 0;
          }
        },
        {
          // Rolldown emits its own scoped createRequire runtime for CommonJS dependencies.
          // electron-vite's post-bundle regex shim injects a top-level `const require` that collides
          // with bundled ESM modules declaring their own `require` (such as @effect/platform-node).
          name: "opencode:disable-esm-shim",
          configResolved(config) {
            const shim = config.plugins.find((plugin) => plugin.name === "vite:esm-shim");
            if (shim) delete shim.renderChunk;
          }
        }
      ]
    },
    preload: {
      build: {
        minify: command === "build",
        rolldownOptions: {
          input: { index: "src/preload/index.ts" },
          output: {
            format: "cjs",
            // The package is "type": "module". Under --no-sandbox Electron loads the preload
            // through Node's module loader, which treats a .js file as ESM and fails on
            // require("electron"). The sandboxed path ignores the extension.
            entryFileNames: "[name].cjs"
          }
        }
      }
    },
    renderer: {
      experimental: {
        bundledDev: true
      },
      define: {
        "import.meta.env.OPENCODE_VERSION": JSON.stringify(process.env.OPENCODE_VERSION),
        "import.meta.env.VITE_OPENCODE_CHANNEL": JSON.stringify(channel),
        "import.meta.env.OPENCODE_COMMIT": betaNotes ? JSON.stringify(betaNotes.sha) : "undefined",
        "import.meta.env.OPENCODE_BETA_NOTES": betaNotes ? JSON.stringify(JSON.stringify(betaNotes)) : "undefined",
        "import.meta.env.OPENCODE_TEST_ONBOARDING": JSON.stringify(
          command === "serve" && process.env.OPENCODE_TEST_ONBOARDING === "1"
        )
      },
      plugins: [pickerPlugin(), appPlugin, initialChunk],
      publicDir: "../../../app/public",
      root: "src/renderer",
      build: {
        minify: command === "build",
        sourcemap: true,
        rolldownOptions: {
          input: {
            main: "src/renderer/index.html"
          },
          output: {
            codeSplitting: {
              groups: [{ name: (id) => initialGraph.has(id) ? "app" : null, priority: 10 }]
            }
          }
        }
      }
    }
  };
});
export {
  electron_vite_config_default as default
};
