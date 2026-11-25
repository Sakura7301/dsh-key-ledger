/**
 * dsh-key-ledger — 密钥保险库（Host 半侧）
 * ---------------------------------------------------------------------------
 * 一个「看得见、管得住」的凭据总账：把 DSH 里散落在各处的密钥与凭据收拢到
 * 一处登记，显示每一条被哪些插件 / 技能 / 会话引用过，并支持修改与删除。
 *
 * 设计取舍（重要，别改错方向）：
 *
 * 1) **不复制秘密**。凭据的「值」永远留在它原本的权威位置：
 *      · credential store 的 refs / records  → 走 ctx.credentials 读写
 *      · 环境变量 / .env                     → 只读，可「收归仓储」（set 进 store）
 *      · 文件型（ssh 私钥 / PEM / api-key）  → 原地读写，改动前自动留 .bak
 *      · JSON 里的 token 字段                → 原地写回字段，改动前自动留 .bak
 *    本插件只持久化「登记信息 + 注记 + 访问日志 + 引用索引」，从不落一份秘密副本。
 *    这样避免了两份值各说各话，也避免了 vault.json 变成第二个泄漏面。
 *
 * 2) **值是宿主侧的**。列表接口只下发掩码（前 6 … 后 4）；完整值只有显式
 *    reveal 动作才下发，且每次 reveal 都记访问日志。浏览器不会「顺手」拿到秘密。
 *
 * 3) **使用痕迹分两类，分别如实标注**：
 *      · 引用索引（扫描）：插件包 / 技能文档 / 配置文件里出现该凭据标识的位置
 *        —— 这是「谁依赖它」的静态证据，带 file:line。
 *      · 访问日志（运行时）：经本保险库取用/修改/删除的记录，带会话与理由。
 *    两者都不假装是「所有 LLM 调用都记下来了」——适配器解析密钥的瞬间没有事件，
 *    这一点写在 UI 与文档里，不粉饰。
 *
 * 依赖只有 node 内建模块：注入即用，不需要构建，也不跟 dsh 版本耦合。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

export const name = 'dsh-key-ledger'
/** 只要求 HTTP 载体与凭据服务；tools / systemPrompt 用 ctx.get 取，缺失也不炸。 */
export const inject = ['webServer', 'credentials']

const NS = 'dsh-key-ledger'
/** 插件版本：读自己的 package.json，页面标题旁显示。 */
const PLUGIN_VERSION = (() => {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname)
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
})()
const ROUTE_BASE = '/dsh-key-ledger/api'
const STATE_VERSION = 1
/** 会话扫描缓存版本：字段变化时 +1，强制重扫（否则老缓存没有 title）。 */
const SESSION_CACHE_VERSION = 2

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const PROFILE_DIR = process.env.DSH_PROFILE_DIR || path.join(DSH_HOME, 'profiles', process.env.DSH_PROFILE || 'web')
const VAULT_DIR = path.join(DSH_HOME, 'key-ledger')
/** 旧目录（改名前的 @sakura/dsh-vault）——只在迁移时读一次。 */
const LEGACY_DIR = path.join(DSH_HOME, 'vault')
const STATE_FILE = path.join(VAULT_DIR, 'state.json')
const CRED_FILE = path.join(DSH_HOME, '.credentials.yaml')
/** 归档会话的权威清单：workspace 注册表里的 global.archivedSessionIds。 */
const WORKSPACE_STORE = path.join(DSH_HOME, 'storages', 'workspace.json')

/** 拒绝进入扫描的名字：这些目录要么是海量二进制，要么是别人的缓存。 */
const SKIP_DIRS = new Set([
  'sessions', 'storages', 'profiles', 'backups', 'logs', 'cache', 'node_modules',
  'attachments', 'certs', 'ssh', '.pnpm-store', 'drawai-assets', 'drawai-ffmpeg',
  'drawai-video-runtime', 'dsgs', 'channel-pack', 'whale-bubble-imgs', 'whale-roles',
])

/** 环境变量/字段名里出现这些词，才当作密钥候选。 */
const SECRET_NAME_RE = /(^|_)(API_?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CRED|AUTH|COOKIE|PRIVATE_?KEY)(_|$)/i
/** 已知的厂商前缀：即便没在配置里被引用，也值得列出来。 */
const KNOWN_KEY_PREFIX_RE = /^(DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|GOOGLE|MOONSHOT|DASHSCOPE|QWEN|ZHIPU|SILICONFLOW|OPENROUTER|GROQ|MISTRAL|REPLICATE|HF|HUGGINGFACE|AWS|ALIYUN|TENCENT|VOLC|VOLCENGINE|GITHUB|GITLAB|FIGMA|NOTION|BILI)_/i
/** harness 自己的运行时变量，名字里带 KEY/TOKEN 也不是凭据。 */
const ENV_DENYLIST = new Set([
  'DSH_HOME', 'DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_AGENTS_HOME', 'DSH_SESSION_ID',
  'DSH_CHECKOUT', 'DSH_LOG', 'DSH_DEBUG', 'DSH_VERSION',
])
/** JSON 里值算作秘密的字段名。 */
const SECRET_FIELD_RE = /(token|secret|password|passwd|api_?key|apikey|access_?key|private_?key|sessdata|bili_jct|cookie|credential)$/i
/** 太常见的串不能当检索串（否则每个包都会「引用」它）。 */
const STOP_NEEDLES = new Set([
  'token', 'tokens', 'secret', 'secrets', 'key', 'keys', 'apikey', 'api_key', 'password',
  'passwd', 'auth', 'cookie', 'session', 'credential', 'credentials', 'state.json',
  'config.json', 'settings.json', 'package.json', 'index.js', 'client.js', 'api-key', 'api_key.txt',
  'default', 'device', 'config', 'main', 'index', 'lib', 'src', 'app', 'home', 'user', 'admin',
])
/** 看起来像「引用名」而不是值：全大写标识符。 */
const REF_SHAPE_RE = /^[A-Z][A-Z0-9_]{2,}$/
/** 配置文件里显式的引用键。 */
const CONFIG_REF_RE = /^\s*(apiKeyEnv|tokenRef|envRef|tokenEnv|keyEnv|credentialRef|apiKeyRef)\s*:\s*(.+?)\s*$/
/** 配置文件里显式的字面量秘密键（值的形态再判一次）。 */
const CONFIG_LITERAL_RE = /^\s*(apiKey|token|secret|password|passwd|accessKey|accessKeyId|secretKey|apiToken|botToken|appSecret|accessToken|refreshToken|clientSecret|privateKey|appKey)\s*:\s*(.+?)\s*$/
/** 文件名里含这些词，才当作「可能装着秘密的文件」。 */
const SECRET_FILE_RE = /(credential|token|secret|passw|api[-_]?key|apikey|auth|cookie)/i
/** 这些目录里的 json 一定翻一遍（插件自己的凭据/账号存储）。 */
const JSON_HINT_DIRS = ['integrations', 'dsh-im-connect', 'im', 'our-free-model', 'whale-audio', 'whale-roles', 'openai-gateway']

// ── 小工具 ───────────────────────────────────────────────────────────────────

function home(p) {
  if (typeof p !== 'string') return ''
  return p.startsWith(DSH_HOME) ? '~/.dsh' + p.slice(DSH_HOME.length) : p
}

function readTextSafe(file, maxBytes = 512 * 1024) {
  try {
    const st = fs.statSync(file)
    if (!st.isFile() || st.size > maxBytes) return undefined
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

function readJsonSafe(file, maxBytes = 512 * 1024) {
  const text = readTextSafe(file, maxBytes)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function writeFileAtomic(file, text, mode) {
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = path.join(dir, '.' + path.basename(file) + '.' + process.pid + '.' + Date.now() + '.tmp')
  fs.writeFileSync(tmp, text, mode === undefined ? undefined : { mode })
  fs.renameSync(tmp, file)
}

/** 留一份同目录备份（.bak-时间戳），返回备份路径；改文件型凭据前必须调用。 */
function backupFile(file) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const target = file + '.bak-' + stamp
  fs.copyFileSync(file, target)
  try {
    fs.chmodSync(target, fs.statSync(file).mode & 0o777)
  } catch { /* 权限复制失败不影响主流程 */ }
  return target
}

/** 掩码：只留前 6 / 后 4，短值全遮。秘密值只在宿主侧经过这里。 */
function maskSecret(value) {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (s === '') return ''
  const chars = Array.from(s)
  if (chars.length <= 8) return '•'.repeat(Math.max(6, chars.length))
  return chars.slice(0, 6).join('') + '…' + chars.slice(-4).join('')
}

function fmtBytes(n) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/** 文件型凭据的预览：私钥/证书给类型与大小（露出 base64 头没有信息量，也没必要）。 */
function previewForFile(text, subtype) {
  const trimmed = String(text || '').trim()
  const header = /^-----BEGIN ([A-Z0-9 ]+)-----/.exec(trimmed)
  if (subtype === 'ssh-private-key' || subtype === 'certificate') {
    return (header ? header[1] : subtype === 'certificate' ? 'CERTIFICATE' : 'PRIVATE KEY') + ' · ' + fmtBytes(Buffer.byteLength(text))
  }
  return maskSecret(trimmed)
}

function yieldNow() {
  return new Promise((resolve) => setImmediate(resolve))
}

function nowIso() {
  return new Date().toISOString()
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function parseJsonPointer(doc, pointer) {
  if (!pointer) return undefined
  let cur = doc
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

function setJsonPointer(doc, pointer, value) {
  const parts = pointer.split('/').slice(1).map((raw) => raw.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (parts.length === 0) throw new Error('不能替换整个文档')
  let cur = doc
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (cur[key] === null || typeof cur[key] !== 'object') cur[key] = {}
    cur = cur[key]
  }
  cur[parts[parts.length - 1]] = value
  return doc
}

function deleteJsonPointer(doc, pointer) {
  const parts = pointer.split('/').slice(1).map((raw) => raw.replace(/~1/g, '/').replace(/~0/g, '~'))
  if (parts.length === 0) throw new Error('不能删除整个文档')
  let cur = doc
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    if (cur === null || typeof cur !== 'object') return false
    cur = cur[key]
  }
  if (cur === null || typeof cur !== 'object') return false
  const last = parts[parts.length - 1]
  if (!(last in cur)) return false
  delete cur[last]
  return true
}

/** 行号（1 起）——引用证据要能让人点开文件就找到。 */
function lineOf(text, index) {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

/**
 * 持久化自检：容器部署时最怕「数据写在临时层，重建就没了」。
 * 判据：/.dockerenv 存在（说明在容器里）且 DSH_HOME 与 / 是同一个设备号
 * （同一个 overlay 层）→ 没挂卷，重建即丢。
 */
function persistenceInfo() {
  const info = {
    container: false,
    home: home(DSH_HOME),
    stateFile: home(STATE_FILE),
    onVolume: null,
    ephemeral: false,
    note: '',
  }
  try {
    info.container = fs.existsSync('/.dockerenv')
  } catch { /* ignore */ }
  try {
    const rootDev = fs.statSync('/').dev
    const homeDev = fs.statSync(DSH_HOME).dev
    info.onVolume = homeDev !== rootDev
    info.ephemeral = info.container && !info.onVolume
    info.note = info.ephemeral
      ? '当前 DSH_HOME 与容器根目录在同一个可写层，容器重建/更新会丢失保险库数据。请把宿主机目录挂载到 /root/.dsh（例如 -v /your/host/dsh-data:/root/.dsh）。'
      : info.container
        ? 'DSH_HOME 位于挂载卷上，容器重建/更新不会丢失。'
        : '非容器环境，数据写在本地磁盘。'
  } catch {
    info.note = '无法判断持久化状态'
  }
  return info
}

/**
 * 读归档会话 id 集合。
 * 归档不是磁盘标记，而是 workspace 注册表里的一个数组；读不到就当没有归档
 * （宁可多扫几个，也不要因为解析失败把归档会话当成活跃的）。
 */
function readArchivedSessionIds() {
  try {
    const raw = readJsonSafe(WORKSPACE_STORE, 8 * 1024 * 1024)
    const ids = raw && raw.global && Array.isArray(raw.global.archivedSessionIds)
      ? raw.global.archivedSessionIds
      : []
    const set = new Set()
    for (const id of ids) if (typeof id === 'string' && id) set.add(id)
    return set
  } catch {
    return new Set()
  }
}

// ── 持久化：只存注记、访问日志、索引，不存秘密 ────────────────────────────

function emptyState() {
  return {
    version: STATE_VERSION,
    entries: {},          // id -> { label, note, tags, pinned, hidden, createdAt, updatedAt }
    access: [],           // [{ at, id, action, actor, reason }]
    index: null,          // { at, needle: { plugins, skills, sessions } }
    fileIndex: {},        // 会话扫描结果缓存（按文件指纹）
    configRefs: [],       // 配置文件里的引用（每次扫描重算）
    tombstones: {},       // id -> { at, name, kind, reason }：删过的凭据，来源再现也不自动复活
    meta: {},             // { firstScanAt, lastScan: { at, sessions, archivedSkipped, durationMs } }
  }
}

function loadState() {
  // 从旧插件目录迁移一次（保留用户的注记/墓碑/访问日志）
  try {
    if (!fs.existsSync(STATE_FILE) && fs.existsSync(path.join(LEGACY_DIR, 'state.json'))) {
      fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 })
      fs.copyFileSync(path.join(LEGACY_DIR, 'state.json'), STATE_FILE)
      try { fs.chmodSync(STATE_FILE, 0o600) } catch { /* ignore */ }
    }
  } catch { /* 迁移失败就按空状态起步 */ }
  const j = readJsonSafe(STATE_FILE, 4 * 1024 * 1024)
  if (!j || typeof j !== 'object') return emptyState()
  const s = emptyState()
  if (j.entries && typeof j.entries === 'object') s.entries = j.entries
  if (Array.isArray(j.access)) s.access = j.access.slice(-2000)
  if (j.index && typeof j.index === 'object') s.index = j.index
  if (j.fileIndex && typeof j.fileIndex === 'object') s.fileIndex = j.fileIndex
  if (Array.isArray(j.configRefs)) s.configRefs = j.configRefs
  if (j.tombstones && typeof j.tombstones === 'object') s.tombstones = j.tombstones
  if (j.meta && typeof j.meta === 'object') s.meta = j.meta
  return s
}

function saveState(state) {
  const payload = {
    version: STATE_VERSION,
    entries: state.entries,
    access: state.access.slice(-2000),
    index: state.index,
    // fileIndex 可能不小，但仍只有 id/cwd/needle，不含秘密
    fileIndex: state.fileIndex,
    configRefs: state.configRefs,
    tombstones: state.tombstones,
    meta: state.meta,
  }
  writeFileAtomic(STATE_FILE, JSON.stringify(payload, null, 2), 0o600)
}

// ── 发现：把所有现存凭据找出来 ─────────────────────────────────────────────

/** 从 credential store 的 YAML 里只取 refs 段的键名（值不解析，避免半吊子 YAML 解析器）。 */
function readRefNames() {
  const candidates = [CRED_FILE]
  const text = candidates.map((f) => readTextSafe(f)).find((t) => typeof t === 'string')
  if (!text) return []
  const names = []
  let section = ''
  for (const line of text.split(/\r?\n/)) {
    const top = /^([A-Za-z_][\w-]*):\s*$/.exec(line)
    if (top) {
      section = top[1]
      continue
    }
    if (section !== 'refs') continue
    const m = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (m && m[2].trim() !== '') names.push(m[1])
  }
  return [...new Set(names)]
}

/** .env 解析：KEY=VALUE，支持引号与行尾注释。 */
function parseEnvFile(file) {
  const text = readTextSafe(file, 256 * 1024)
  if (!text) return []
  const out = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '')
    if (value === '') continue
    out.push({ name: m[1], value, file })
  }
  return out
}

/** 递归走目录，返回文件路径（带深度/数量上限）。 */
function walkFiles(root, opts = {}) {
  const { maxDepth = 3, maxFiles = 400, filter = () => true } = opts
  const out = []
  const stack = [{ dir: root, depth: 0 }]
  while (stack.length > 0 && out.length < maxFiles) {
    const { dir, depth } = stack.pop()
    for (const ent of listDir(dir)) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (depth + 1 > maxDepth) continue
        if (SKIP_DIRS.has(ent.name)) continue
        if (ent.name.startsWith('.')) continue
        stack.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!ent.isFile()) continue
      if (!filter(full, ent.name)) continue
      out.push(full)
      if (out.length >= maxFiles) break
    }
  }
  return out
}

/** 从 JSON 文档里挑出秘密字段：[{ pointer, keyPath, value }] */
function collectJsonSecrets(doc, opts = {}) {
  const { maxDepth = 4, maxEntries = 40 } = opts
  const out = []
  const walk = (node, pointer, depth) => {
    if (out.length >= maxEntries || node === null || typeof node !== 'object' || depth > maxDepth) return
    for (const [k, v] of Object.entries(node)) {
      const ptr = pointer + '/' + String(k).replace(/~/g, '~0').replace(/\//g, '~1')
      if (v !== null && typeof v === 'object') {
        walk(v, ptr, depth + 1)
        continue
      }
      if (typeof v !== 'string') continue
      const trimmed = v.trim()
      if (trimmed.length < 6) continue
      if (REF_SHAPE_RE.test(trimmed)) continue          // 这是引用名，不是秘密
      if (/Ref$/i.test(k)) continue                     // tokenRef 之类
      if (!SECRET_FIELD_RE.test(k)) continue
      out.push({ pointer: ptr, keyPath: ptr.split('/').slice(1).join('.'), value: v })
    }
  }
  walk(doc, '', 0)
  return out
}

/** 扫描配置文件（profile patch + cordis.yml），抽出引用与字面量秘密。 */
function scanConfigFiles() {
  const refs = []
  const literals = []
  const files = []
  // 进程环境里未必有 DSH_PROFILE_DIR，所以直接按磁盘上真实的 profile 目录找
  const profileDirs = new Set()
  if (PROFILE_DIR) profileDirs.add(PROFILE_DIR)
  for (const ent of listDir(path.join(DSH_HOME, 'profiles'))) {
    if (ent.isDirectory()) profileDirs.add(path.join(DSH_HOME, 'profiles', ent.name))
  }
  for (const dir of profileDirs) {
    files.push(path.join(dir, 'cordis.patch.yml'))
    files.push(path.join(dir, 'cordis.yml'))
  }
  for (const file of files) {
    const text = readTextSafe(file, 2 * 1024 * 1024)
    if (!text) continue
    let currentId = ''
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const idm = /^\s*-?\s*id:\s*['"]?([^\s'"]+)/.exec(line)
      if (idm) {
        currentId = idm[1]
        continue
      }
      const namem = /^\s*-?\s*name:\s*['"]?([^\s'"]+)/.exec(line)
      if (namem && !currentId) currentId = namem[1]
      const rm = CONFIG_REF_RE.exec(line)
      if (rm) {
        const value = rm[2].replace(/^['"]|['"]$/g, '').trim()
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
          refs.push({ name: value, entryId: currentId, file, line: i + 1 })
        }
        continue
      }
      const lm = CONFIG_LITERAL_RE.exec(line)
      if (lm) {
        const value = lm[2].replace(/^['"]|['"]$/g, '').trim()
        if (value === '') continue
        if (/^\$\{?/.test(value)) continue                 // 变量插值，不是字面量
        if (REF_SHAPE_RE.test(value)) {
          refs.push({ name: value, entryId: currentId, file, line: i + 1 })
          continue
        }
        literals.push({ entryId: currentId, key: lm[1], value, file, line: i + 1 })
      }
    }
  }
  return { refs, literals }
}

/**
 * 一次完整发现：返回条目数组（不含秘密值，只有掩码）。
 * 每条都带 needles —— 之后扫描「谁引用过它」时用的检索串。
 */
async function discover(ctx, state) {
  const entries = []
  const configScan = scanConfigFiles()
  state.configRefs = configScan.refs

  // ① credential store 的 refs
  const refNames = readRefNames()
  for (const envName of refNames) {
    let info = {}
    try {
      info = (await ctx.credentials.describe(envName)) || {}
    } catch { /* 非法引用名或 provider 异常：降级为未配置 */ }
    let masked = ''
    try {
      const hit = await ctx.credentials.resolve(envName)
      if (hit && typeof hit.value === 'string') masked = maskSecret(hit.value)
    } catch { /* ignore */ }
    if (!masked) masked = info.masked || ''
    entries.push({
      id: 'ref:' + envName,
      kind: 'ref',
      name: envName,
      configured: info.configured !== false,
      writable: info.writable !== false,
      source: info.source || 'stored',
      origin: home(CRED_FILE),
      masked,
      meta: {},
      needles: [envName],
    })
  }

  // ② credential store 的 records（授权/环境值，按 <owner>/<id> 登记）
  try {
    const records = (await ctx.credentials.listRecords()) || []
    for (const rec of records) {
      const key = String(rec && rec.key ? rec.key : '')
      if (!key) continue
      const scope = key.includes('/') ? key.slice(0, key.indexOf('/')) : key
      const rid = key.includes('/') ? key.slice(key.indexOf('/') + 1) : ''
      let masked = ''
      let detail = {}
      try {
        const hit = await ctx.credentials.readRecord(key)
        if (hit) {
          detail = { kind: hit.kind || rec.kind || '' }
          if (hit.payload && typeof hit.payload === 'object') {
            const secretish = Object.entries(hit.payload).find(([k]) => SECRET_FIELD_RE.test(k) || /token|secret|refresh|access/i.test(k))
            if (secretish && typeof secretish[1] === 'string') masked = maskSecret(secretish[1])
            detail.fields = Object.keys(hit.payload)
          }
          if (hit.env && typeof hit.env === 'object') detail.envKeys = Object.keys(hit.env)
        }
      } catch { /* ignore */ }
      entries.push({
        id: 'record:' + key,
        kind: 'record',
        name: key,
        configured: true,
        writable: false,
        deletable: true,
        source: 'stored-record',
        origin: home(CRED_FILE),
        masked,
        meta: { scope, id: rid, ...detail, kindTag: rec.kind || detail.kind || '' },
        needles: [key, rid.length >= 8 ? rid : ''].filter(Boolean),
      })
    }
  } catch { /* 无 provider：忽略 */ }

  // ③ 环境变量（启动时快照）
  const referencedNames = new Set(configScan.refs.map((r) => r.name))
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < 6) continue
    if (!SECRET_NAME_RE.test(key) && !KNOWN_KEY_PREFIX_RE.test(key)) continue
    if (!SECRET_NAME_RE.test(key) && !referencedNames.has(key)) continue
    if (refNames.includes(key)) continue
    entries.push({
      id: 'env:' + key,
      kind: 'env',
      name: key,
      configured: true,
      writable: false,
      promotable: true,
      source: 'environment',
      origin: '启动环境快照',
      masked: maskSecret(value),
      meta: {},
      needles: [key],
    })
  }

  // ④ .env 文件
  const envFiles = [path.join(DSH_HOME, '.env')]
  try {
    envFiles.push(path.join(process.cwd(), '.env'))
  } catch { /* ignore */ }
  const seenEnv = new Set()
  for (const file of envFiles) {
    for (const item of parseEnvFile(file)) {
      if (refNames.includes(item.name) || seenEnv.has(item.name)) continue
      if (!SECRET_NAME_RE.test(item.name)) continue
      seenEnv.add(item.name)
      entries.push({
        id: 'envfile:' + file + '#' + item.name,
        kind: 'envfile',
        name: item.name,
        configured: true,
        writable: false,
        deletable: true,
        promotable: true,
        source: 'env-file',
        origin: home(file),
        masked: maskSecret(item.value),
        meta: { file: home(file) },
        needles: [item.name],
      })
    }
  }

  // ⑤ 文件型凭据：ssh 私钥 / 证书 / 名字像密钥的文件
  const seenFiles = new Set()
  const addFile = (file, subtype, extra) => {
    if (seenFiles.has(file)) return
    const base = path.basename(file)
    // 点文件（.credentials.yaml / .env）由 refs 与 envfile 条目表示，不再重复登记
    if (base.startsWith('.') || base === 'known_hosts') return
    // 自己留下的备份/临时文件不是凭据
    if (/\.bak-\d{8,}/.test(base) || /\.tmp$/.test(base) || /\.old-\d{8,}/.test(base)) return
    const text = readTextSafe(file, 512 * 1024)
    if (text === undefined) return
    seenFiles.add(file)
    entries.push({
      id: 'file:' + file,
      kind: 'file',
      name: path.basename(file),
      configured: true,
      writable: true,
      deletable: true,
      source: 'file',
      origin: home(file),
      masked: previewForFile(text, subtype),
      meta: { file: home(file), absPath: file, subtype, bytes: Buffer.byteLength(text), ...extra },
      needles: [home(file), path.basename(file).length >= 10 ? path.basename(file) : ''].filter(Boolean),
    })
  }

  for (const ent of listDir(path.join(DSH_HOME, 'ssh'))) {
    if (!ent.isFile()) continue
    if (!/^id_/.test(ent.name) || /\.pub$/.test(ent.name) || /\.old/.test(ent.name)) continue
    addFile(path.join(DSH_HOME, 'ssh', ent.name), 'ssh-private-key')
  }
  for (const ent of listDir(path.join(DSH_HOME, 'certs'))) {
    if (!ent.isFile() || !/\.(pem|crt|key)$/i.test(ent.name)) continue
    addFile(path.join(DSH_HOME, 'certs', ent.name), 'certificate')
  }
  // 名字像密钥的文件（深度 3，跳过已知噪音目录）
  for (const file of walkFiles(DSH_HOME, {
    maxDepth: 3,
    maxFiles: 200,
    filter: (full, base) => !base.startsWith('.') && !/\.bak-\d{8,}/.test(base) && !/\.old-\d{8,}/.test(base) &&
      SECRET_FILE_RE.test(base) && !/\.(log|lock|map)$/i.test(base) && !base.endsWith('.json'),
  })) {
    addFile(file, /api[-_]?key/i.test(path.basename(file)) ? 'api-key-file' : 'secret-file')
  }

  // ⑥ JSON 里嵌着的 token 字段（插件账号/授权存储）
  const jsonFiles = []
  for (const dir of JSON_HINT_DIRS) {
    const base = path.join(DSH_HOME, dir)
    for (const file of walkFiles(base, {
      maxDepth: 3,
      maxFiles: 60,
      filter: (_full, b) => b.endsWith('.json') && !/package(-lock)?\.json$/i.test(b),
    })) jsonFiles.push(file)
  }
  for (const file of walkFiles(DSH_HOME, {
    maxDepth: 3,
    maxFiles: 120,
    filter: (_full, b) => b.endsWith('.json') && SECRET_FILE_RE.test(b),
  })) if (!jsonFiles.includes(file)) jsonFiles.push(file)

  for (const file of jsonFiles) {
    const doc = readJsonSafe(file, 512 * 1024)
    if (!doc) continue
    for (const hit of collectJsonSecrets(doc)) {
      entries.push({
        id: 'json:' + file + '#' + hit.pointer,
        kind: 'json',
        name: hit.keyPath.split('.').pop() + ' @ ' + path.basename(file),
        configured: true,
        writable: true,
        deletable: true,
        source: 'file-json',
        origin: home(file),
        masked: maskSecret(hit.value),
        meta: { file: home(file), absPath: file, pointer: hit.pointer, keyPath: hit.keyPath },
        needles: [home(file), hit.keyPath.length >= 12 ? hit.keyPath : ''].filter(Boolean),
      })
    }
  }

  // ⑦ 配置文件里写死的字面量秘密（危险项：标红提示收归仓储）
  for (const lit of configScan.literals) {
    entries.push({
      id: 'config:' + lit.file + '#' + lit.line,
      kind: 'config',
      name: lit.key + ' @ ' + (lit.entryId || path.basename(lit.file)),
      configured: true,
      writable: false,
      promotable: true,
      source: 'config-literal',
      origin: home(lit.file) + ':' + lit.line,
      masked: maskSecret(lit.value),
      meta: { file: home(lit.file), absPath: lit.file, line: lit.line, key: lit.key, entryId: lit.entryId },
      needles: [],
      risk: ['plaintext-in-config'],
    })
  }

  // 注记 + 统计
  for (const e of entries) {
    const ann = state.entries[e.id]
    if (ann) {
      e.label = ann.label || ''
      e.note = ann.note || ''
      e.tags = Array.isArray(ann.tags) ? ann.tags : []
      e.pinned = ann.pinned === true
      if (ann.hidden === true) e.hidden = true
    } else {
      e.label = ''
      e.note = ''
      e.tags = []
      e.pinned = false
    }
    if (!e.label) e.label = defaultLabel(e)
    // 删过的凭据：即使来源（文件/配置）又出现了，也不当作活跃凭据，只以「已删除」形态存在
    const stone = state.tombstones && state.tombstones[e.id]
    if (stone) {
      e.tombstoned = true
      e.hidden = true
      if (!e.deletedAt) e.deletedAt = stone.at
    }
  }

  return entries
}

/** 字段名 → 人话。默认名不再直接甩 accessToken 这种原始键名。 */
const KEY_LABEL_HINTS = {
  accessToken: '访问令牌', refreshtoken: '刷新令牌', refreshtoken2: '刷新令牌',
  token: '令牌', botToken: '机器人令牌', apiToken: 'API 令牌',
  apiKey: 'API Key', apikey: 'API Key', key: '密钥',
  secret: '密钥', secretKey: '密钥', clientSecret: '客户端密钥', appSecret: '应用密钥',
  accessKey: '访问密钥', accessKeyId: '访问密钥 ID', privateKey: '私钥',
  password: '密码', passwd: '密码',
  sessdata: '登录 cookie（SESSDATA）', bili_jct: 'CSRF token（bili_jct）',
}

function keyHint(key) {
  if (typeof key !== 'string' || key === '') return ''
  return KEY_LABEL_HINTS[key] || KEY_LABEL_HINTS[key.toLowerCase()] || ''
}

/** 没人工起名时给个还行的默认名。 */
function defaultLabel(entry) {
  const pretty = (s) => String(s || '').toLowerCase().split(/[_\-\s.]/).filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1))).join(' ')
  switch (entry.kind) {
    case 'ref':
      return pretty(entry.name)
    case 'record':
      return 'Record · ' + entry.name
    case 'env':
      return pretty(entry.name) + ' (环境)'
    case 'envfile':
      return pretty(entry.name) + ' (.env)'
    case 'file':
      return entry.name + ' · ' + (entry.meta && entry.meta.subtype ? entry.meta.subtype : '文件')
    case 'json': {
      const keyPath = entry.meta && entry.meta.keyPath ? String(entry.meta.keyPath) : ''
      const last = keyPath ? keyPath.split('.').pop() : ''
      return keyHint(last) || last || entry.name
    }
    case 'config': {
      const rawKey = entry.meta && entry.meta.key ? String(entry.meta.key) : ''
      const owner = entry.meta && entry.meta.entryId ? String(entry.meta.entryId) : ''
      return (owner ? owner + ' 的' : '') + (keyHint(rawKey) || rawKey || '配置项') + '（明文）'
    }
    default:
      return entry.name
  }
}

// ── 引用索引：谁在用它 ─────────────────────────────────────────────────────

/** 找出 DSH 安装里的 @deepseek-ai 包根：随版本绑定的插件（LLM 适配器等）都在这里。 */
function dshInstallRoots() {
  const roots = []
  const seen = new Set()
  const add = (p) => {
    if (!p || seen.has(p)) return
    try {
      if (fs.existsSync(p)) {
        seen.add(p)
        roots.push(p)
      }
    } catch { /* ignore */ }
  }
  // 从宿主入口往上找 node_modules/@deepseek-ai（最可靠，不写死安装路径）
  const argMain = process.argv && process.argv[1]
  if (typeof argMain === 'string' && argMain.indexOf('@deepseek-ai') >= 0) {
    let dir = path.dirname(argMain)
    for (let i = 0; i < 5; i++) {
      const cand = path.join(dir, 'node_modules', '@deepseek-ai')
      if (fs.existsSync(cand)) {
        add(cand)
        break
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  if (process.env.DSH_CHECKOUT) add(path.join(process.env.DSH_CHECKOUT, 'packages'))
  add('/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai')
  add(path.join(DSH_HOME, 'node_modules', '@deepseek-ai'))
  return roots
}

/** 收集「消费方」：profile 装的插件包 + DSH 自带的插件包（按包名去重）。 */
function listConsumerPackages() {
  const pkgs = new Map()
  const push = (name, dir) => {
    if (!name || pkgs.has(name)) return
    pkgs.set(name, { name, dir })
  }
  const nm = PROFILE_DIR ? path.join(PROFILE_DIR, 'node_modules') : ''
  if (nm) {
    for (const ent of listDir(nm)) {
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue
      if (ent.name.startsWith('.')) continue
      if (!ent.name.startsWith('@')) {
        push(ent.name, path.join(nm, ent.name))
        continue
      }
      for (const sub of listDir(path.join(nm, ent.name))) {
        if (!sub.isDirectory() && !sub.isSymbolicLink()) continue
        push(ent.name + '/' + sub.name, path.join(nm, ent.name, sub.name))
      }
    }
  }
  for (const root of dshInstallRoots()) {
    for (const ent of listDir(root)) {
      if (!ent.isDirectory()) continue
      const dir = path.join(root, ent.name)
      if (!fs.existsSync(path.join(dir, 'package.json'))) continue
      push(root.endsWith('packages') ? ent.name : '@deepseek-ai/' + ent.name, dir)
    }
  }
  return [...pkgs.values()]
}

/** 在一个文本里找 needle，返回首处 file:line 证据。 */
function findInFile(file, text, needles, budget) {
  const hits = []
  for (const needle of needles) {
    if (!needle || needle.length < 3) continue
    if (budget.bytes <= 0 || Date.now() > budget.until) return hits
    const idx = text.indexOf(needle)
    if (idx < 0) continue
    budget.hits++
    hits.push({ needle, file: home(file), line: lineOf(text, idx) })
  }
  return hits
}

async function scanPluginPackages(needles, state) {
  const budget = { bytes: 160 * 1024 * 1024, until: Date.now() + 15000, hits: 0 }
  const byPackage = new Map()
  const packages = listConsumerPackages()
  let seen = 0
  for (const pkg of packages) {
    if (Date.now() > budget.until || budget.bytes <= 0) break
    if (++seen % 12 === 0) await yieldNow()
    const files = []
    const manifest = readTextSafe(path.join(pkg.dir, 'package.json'), 64 * 1024)
    if (manifest !== undefined) files.push({ file: path.join(pkg.dir, 'package.json'), text: manifest })
    for (const sub of ['lib', 'src', 'rc']) {
      if (Date.now() > budget.until || budget.bytes <= 0) break
      const base = path.join(pkg.dir, sub)
      for (const file of walkFiles(base, { maxDepth: 2, maxFiles: 40, filter: (_f, b) => /\.(js|mjs|cjs|json|ts)$/.test(b) && !/\.map$/.test(b) })) {
        if (Date.now() > budget.until || budget.bytes <= 0) break
        const text = readTextSafe(file, 512 * 1024)
        if (text === undefined) continue
        budget.bytes -= text.length
        files.push({ file, text })
      }
    }
    for (const item of files) {
      const hits = findInFile(item.file, item.text, needles, budget)
      if (hits.length === 0) continue
      const key = pkg.name
      const bucket = byPackage.get(key) || { name: pkg.name, dir: home(pkg.dir), hits: [] }
      bucket.hits.push(...hits)
      byPackage.set(key, bucket)
      if (Date.now() > budget.until) break
    }
  }
  return [...byPackage.values()]
}

async function scanSkills(needles, state) {
  const roots = [path.join(DSH_HOME, 'skills')]
  const budget = { bytes: 24 * 1024 * 1024, until: Date.now() + 4000, hits: 0 }
  const bySkill = new Map()
  let seen = 0
  for (const root of roots) {
    for (const ent of listDir(root)) {
      if (!ent.isDirectory()) continue
      if (++seen % 8 === 0) await yieldNow()
      const skillDir = path.join(root, ent.name)
      for (const file of walkFiles(skillDir, { maxDepth: 4, maxFiles: 60, filter: (_f, b) => /\.(md|json|js|mjs|ts|txt|ya?ml)$/.test(b) })) {
        if (Date.now() > budget.until || budget.bytes <= 0) break
        const text = readTextSafe(file, 256 * 1024)
        if (text === undefined) continue
        budget.bytes -= text.length
        const hits = findInFile(file, text, needles, budget)
        if (hits.length === 0) continue
        const bucket = bySkill.get(ent.name) || { name: ent.name, dir: home(skillDir), hits: [] }
        bucket.hits.push(...hits)
        bySkill.set(ent.name, bucket)
      }
    }
  }
  return [...bySkill.values()]
}

/**
 * 从会话记录里取标题：session/title 事件可能多次出现，取最后一条。
 * 只解析命中那一行，不整文件 JSON.parse（几百 KB 的记录上省一个数量级）。
 */
function extractSessionTitle(text) {
  const marker = '"type":"session/title"'
  const idx = text.lastIndexOf(marker)
  if (idx < 0) return ''
  const start = text.lastIndexOf('\n', idx) + 1
  const end = text.indexOf('\n', idx)
  const line = text.slice(start, end < 0 ? undefined : end)
  try {
    const j = JSON.parse(line)
    const title = j && j.data && typeof j.data.title === 'string' ? j.data.title.trim() : ''
    return title.length > 80 ? title.slice(0, 79) + '…' : title
  } catch {
    return ''
  }
}

async function scanSessions(needles, state) {
  const root = path.join(DSH_HOME, 'sessions')
  const cache = state.fileIndex && typeof state.fileIndex === 'object' ? state.fileIndex : {}
  const nextCache = {}
  const byNeedle = new Map()
  const budget = { bytes: 360 * 1024 * 1024, until: Date.now() + 25000 }
  const archived = readArchivedSessionIds()
  const sessionsDirs = []
  let archivedSkipped = 0
  for (const workspace of listDir(root)) {
    if (!workspace.isDirectory()) continue
    const wsDir = path.join(root, workspace.name)
    for (const sess of listDir(wsDir)) {
      if (!sess.isDirectory()) continue
      const file = path.join(wsDir, sess.name, 'session.v4.jsonl.zstd')
      if (!fs.existsSync(file)) continue
      // 归档会话不进索引：用户明确只看「没归档」的会话
      if (archived.has(sess.name)) {
        archivedSkipped++
        continue
      }
      sessionsDirs.push({ file, sessionId: sess.name })
    }
  }
  state.meta = state.meta || {}
  state.meta.lastScan = {
    ...(state.meta.lastScan || {}),
    at: nowIso(),
    sessions: sessionsDirs.length,
    archivedSkipped,
  }
  let seen = 0
  for (const item of sessionsDirs) {
    if (Date.now() > budget.until || budget.bytes <= 0) break
    if (++seen % 10 === 0) await yieldNow()
    let st
    try {
      st = fs.statSync(item.file)
    } catch {
      continue
    }
    if (!st.isFile() || st.size > 24 * 1024 * 1024) continue
    const fingerprint = st.size + ':' + Math.round(st.mtimeMs)
    const cached = cache[item.file]
    // 缓存命中要求：文件没变，且上次扫描覆盖了本次全部检索串
    const complete = cached && cached.v === SESSION_CACHE_VERSION && cached.fp === fingerprint &&
      Array.isArray(cached.scanned) && needles.every((n) => cached.scanned.indexOf(n) >= 0)
    if (complete) {
      nextCache[item.file] = cached
      for (const needle of cached.found || []) {
        const list = byNeedle.get(needle) || []
        list.push({ id: cached.id, cwd: cached.cwd, title: cached.title || '', at: cached.at, hits: (cached.hits || {})[needle] })
        byNeedle.set(needle, list)
      }
      continue
    }
    let text
    try {
      const buf = fs.readFileSync(item.file)
      text = zlib.zstdDecompressSync(buf).toString('utf8')
    } catch {
      continue
    }
    budget.bytes -= text.length
    const record = {
      v: SESSION_CACHE_VERSION,
      fp: fingerprint,
      id: item.sessionId,
      cwd: '',
      title: '',
      at: new Date(st.mtimeMs).toISOString(),
      scanned: needles.slice(),
      found: [],
      hits: {},
    }
    const firstLine = text.slice(0, text.indexOf('\n') < 0 ? 2048 : text.indexOf('\n'))
    try {
      const head = JSON.parse(firstLine)
      if (head && typeof head.id === 'string') record.id = head.id
      if (head && typeof head.cwd === 'string') record.cwd = head.cwd
    } catch { /* 首行解析失败就用目录名 */ }
    record.title = extractSessionTitle(text)
    for (const needle of needles) {
      if (!needle || needle.length < 3) continue
      let count = 0
      let idx = text.indexOf(needle)
      while (idx >= 0 && count < 50) {
        count++
        idx = text.indexOf(needle, idx + needle.length)
      }
      if (count === 0) continue
      record.found.push(needle)
      record.hits[needle] = count
      const list = byNeedle.get(needle) || []
      list.push({ id: record.id, cwd: record.cwd, title: record.title, at: record.at, hits: count })
      byNeedle.set(needle, list)
    }
    nextCache[item.file] = record
  }
  state.fileIndex = nextCache
  return byNeedle
}

function collectNeedles(entries) {
  const set = new Set()
  for (const e of entries) {
    for (const n of e.needles || []) {
      if (typeof n !== 'string' || n.length < 6) continue
      if (STOP_NEEDLES.has(n.toLowerCase())) continue
      set.add(n)
    }
  }
  return [...set]
}

/** 全量扫描并写入索引。 */
async function rebuildIndex(ctx, state, entries) {
  const started = Date.now()
  const needles = collectNeedles(entries)
  await yieldNow()
  const packages = await scanPluginPackages(needles, state)
  const skills = await scanSkills(needles, state)
  const sessionsByNeedle = await scanSessions(needles, state)

  const byNeedle = {}
  const ensure = (needle) => {
    if (!byNeedle[needle]) byNeedle[needle] = { plugins: [], skills: [], sessions: [], configs: [] }
    return byNeedle[needle]
  }
  for (const pkg of packages) {
    for (const hit of pkg.hits) {
      const slot = ensure(hit.needle)
      let owner = slot.plugins.find((p) => p.name === pkg.name)
      if (!owner) {
        owner = { name: pkg.name, dir: pkg.dir, evidence: [] }
        slot.plugins.push(owner)
      }
      if (owner.evidence.length < 5) owner.evidence.push({ file: hit.file, line: hit.line })
    }
  }
  for (const skill of skills) {
    for (const hit of skill.hits) {
      const slot = ensure(hit.needle)
      let owner = slot.skills.find((s) => s.name === skill.name)
      if (!owner) {
        owner = { name: skill.name, dir: skill.dir, evidence: [] }
        slot.skills.push(owner)
      }
      if (owner.evidence.length < 5) owner.evidence.push({ file: hit.file, line: hit.line })
    }
  }
  for (const [needle, list] of sessionsByNeedle) {
    const slot = ensure(needle)
    slot.sessions = list
      .slice()
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, 30)
      .map((s) => ({ id: s.id, cwd: s.cwd, title: s.title || '', at: s.at, hits: s.hits }))
  }
  for (const ref of state.configRefs || []) {
    const slot = ensure(ref.name)
    slot.configs.push({ entryId: ref.entryId, file: home(ref.file), line: ref.line })
  }
  state.index = { at: nowIso(), durationMs: Date.now() - started, needle: byNeedle }
  if (state.meta && state.meta.lastScan) state.meta.lastScan.durationMs = state.index.durationMs
  saveState(state)
  return state.index
}

/** 把索引按条目汇总成「使用方」视图。 */
function usageFor(entry, index) {
  const empty = { plugins: [], skills: [], sessions: [], configs: [] }
  if (!index || !index.needle) return empty
  const merged = { plugins: [], skills: [], sessions: [], configs: [] }
  for (const needle of entry.needles || []) {
    const slot = index.needle[needle]
    if (!slot) continue
    for (const p of slot.plugins || []) {
      const hit = merged.plugins.find((x) => x.name === p.name)
      if (hit) hit.evidence.push(...(p.evidence || []).slice(0, 2))
      else merged.plugins.push({ name: p.name, dir: p.dir, evidence: (p.evidence || []).slice(0, 4) })
    }
    for (const s of slot.skills || []) {
      const hit = merged.skills.find((x) => x.name === s.name)
      if (hit) hit.evidence.push(...(s.evidence || []).slice(0, 2))
      else merged.skills.push({ name: s.name, dir: s.dir, evidence: (s.evidence || []).slice(0, 4) })
    }
    for (const s of slot.sessions || []) {
      const hit = merged.sessions.find((x) => x.id === s.id)
      if (hit) hit.hits += s.hits || 0
      else merged.sessions.push({ ...s })
    }
    for (const c of slot.configs || []) {
      if (!merged.configs.find((x) => x.entryId === c.entryId && x.line === c.line)) merged.configs.push({ ...c })
    }
  }
  merged.sessions.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  merged.sessions = merged.sessions.slice(0, 30)
  return merged
}

// ── 值访问（只有显式动作会走到这里） ──────────────────────────────────────

async function readEntryValue(ctx, entry) {
  switch (entry.kind) {
    case 'ref': {
      const hit = await ctx.credentials.resolve(entry.name)
      if (!hit || typeof hit.value !== 'string') throw new Error('这条凭据当前没有值（可能来自环境变量且未设置）')
      return { value: hit.value, extra: { source: hit.source } }
    }
    case 'env': {
      const v = process.env[entry.name]
      if (!v) throw new Error('环境变量为空')
      return { value: v, extra: { source: 'environment' } }
    }
    case 'envfile': {
      const abs = entry.meta && entry.meta.file ? path.join(DSH_HOME, entry.meta.file.replace(/^~\/\.dsh\/?/, '')) : ''
      const found = parseEnvFile(abs).find((x) => x.name === entry.name)
      if (!found) throw new Error('.env 里已找不到这个变量')
      return { value: found.value, extra: { source: 'env-file' } }
    }
    case 'file': {
      const text = readTextSafe(entry.meta.absPath, 1024 * 1024)
      if (text === undefined) throw new Error('文件不可读')
      return { value: text, extra: { source: 'file', bytes: text.length } }
    }
    case 'json': {
      const doc = readJsonSafe(entry.meta.absPath, 1024 * 1024)
      if (!doc) throw new Error('JSON 不可读')
      const v = parseJsonPointer(doc, entry.meta.pointer)
      if (typeof v !== 'string') throw new Error('JSON 里该字段已不存在')
      return { value: v, extra: { source: 'file-json' } }
    }
    case 'record': {
      const key = entry.name
      const rec = await ctx.credentials.readRecord(key)
      if (!rec) throw new Error('记录不存在')
      return { value: JSON.stringify(rec.payload ?? rec.env ?? rec, null, 2), extra: { source: 'stored-record', kind: rec.kind } }
    }
    case 'config': {
      const text = readTextSafe(entry.meta.absPath, 2 * 1024 * 1024)
      if (text === undefined) throw new Error('配置文件不可读')
      const line = text.split(/\r?\n/)[entry.meta.line - 1] || ''
      const m = CONFIG_LITERAL_RE.exec(line)
      return { value: m ? m[2].replace(/^['"]|['"]$/g, '') : line, extra: { source: 'config-literal' } }
    }
    default:
      throw new Error('未知条目类型')
  }
}

// ── 动作 ───────────────────────────────────────────────────────────────────

/** 记一条墓碑：这条凭据被明确删除了，来源再出现也不自动复活。 */
function buryEntry(state, entry, who, reason) {
  if (!state.tombstones) state.tombstones = {}
  state.tombstones[entry.id] = {
    at: nowIso(),
    name: entry.name,
    kind: entry.kind,
    by: who || 'user',
    reason: reason || '',
  }
}

function logAccess(state, id, action, actor, reason) {
  state.access.push({ at: nowIso(), id, action, actor: actor || {}, reason: reason || '' })
  if (state.access.length > 2000) state.access = state.access.slice(-2000)
}

async function doSet(ctx, state, entries, body) {
  const entry = resolveEntry(entries, body.id || body.name)
  const value = typeof body.value === 'string' ? body.value : ''
  if (!value) throw new Error('值不能为空（要删除请用删除动作）')

  if (body.id === undefined && body.name && !entry) {
    // 新建一个 ref
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(body.name)) throw new Error('新凭据名必须是 POSIX 标识符（如 MY_API_KEY）')
    await ctx.credentials.set(body.name, value)
    delete (state.tombstones || {})['ref:' + body.name]
    state.entries['ref:' + body.name] = { ...(state.entries['ref:' + body.name] || {}), createdAt: nowIso(), updatedAt: nowIso() }
    logAccess(state, 'ref:' + body.name, 'create', body.actor, body.reason)
    saveState(state)
    return { id: 'ref:' + body.name }
  }
  if (!entry) throw new Error('找不到条目：' + String(body.id || body.name))

  switch (entry.kind) {
    case 'ref':
      await ctx.credentials.set(entry.name, value)
      if (state.tombstones) delete state.tombstones[entry.id]
      logAccess(state, entry.id, 'set', body.actor, body.reason)
      saveState(state)
      return { id: entry.id }
    case 'record':
      throw new Error('record 只能由它的宿主插件改写；这里支持删除')
    case 'env':
      throw new Error('环境变量是启动快照，无法写入；请用「收归仓储」把它存进 credential store')
    case 'envfile':
      throw new Error('.env 属于启动环境，本插件不代写；请用「收归仓储」存进 credential store')
    case 'config':
      throw new Error('明文写在配置文件里的凭据不代改；请收归仓储后从配置里改成引用名')
    case 'file': {
      const backup = backupFile(entry.meta.absPath)
      const mode = fs.statSync(entry.meta.absPath).mode & 0o777
      writeFileAtomic(entry.meta.absPath, value, mode)
      logAccess(state, entry.id, 'replace', body.actor, body.reason || 'backup=' + home(backup))
      saveState(state)
      return { id: entry.id, backup: home(backup) }
    }
    case 'json': {
      const doc = readJsonSafe(entry.meta.absPath, 2 * 1024 * 1024)
      if (!doc) throw new Error('JSON 不可读')
      setJsonPointer(doc, entry.meta.pointer, value)
      const backup = backupFile(entry.meta.absPath)
      writeFileAtomic(entry.meta.absPath, JSON.stringify(doc, null, 2) + '\n', 0o600)
      logAccess(state, entry.id, 'set-field', body.actor, body.reason || 'backup=' + home(backup))
      saveState(state)
      return { id: entry.id, backup: home(backup) }
    }
    default:
      throw new Error('不支持的类型')
  }
}

async function doDelete(ctx, state, entries, body) {
  if (body.confirm !== true) throw new Error('删除需要 confirm: true')
  const entry = resolveEntry(entries, body.id || body.name)
  if (!entry) throw new Error('找不到条目：' + String(body.id || body.name))

  switch (entry.kind) {
    case 'ref':
      await ctx.credentials.unset(entry.name)
      logAccess(state, entry.id, 'delete', body.actor, body.reason)
      buryEntry(state, entry, 'vault', body.reason)
      delete state.entries[entry.id]
      saveState(state)
      return { id: entry.id }
    case 'record':
      await ctx.credentials.deleteRecord(entry.name)
      logAccess(state, entry.id, 'delete', body.actor, body.reason)
      buryEntry(state, entry, 'vault', body.reason)
      saveState(state)
      return { id: entry.id }
    case 'env':
      throw new Error('环境变量删不掉（它不是本插件的存储）；如需停用请从启动环境移除')
    case 'envfile': {
      const abs = path.join(DSH_HOME, String(entry.meta.file || '').replace(/^~\/\.dsh\/?/, ''))
      const text = readTextSafe(abs, 1024 * 1024)
      if (text === undefined) throw new Error('.env 不可读')
      const kept = text.split(/\r?\n/).filter((line) => {
        const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
        return !(m && m[1] === entry.name)
      })
      const backup = backupFile(abs)
      writeFileAtomic(abs, kept.join('\n'), 0o600)
      logAccess(state, entry.id, 'delete', body.actor, body.reason || 'backup=' + home(backup))
      buryEntry(state, entry, 'vault', body.reason)
      saveState(state)
      return { id: entry.id, backup: home(backup) }
    }
    case 'file': {
      const backup = backupFile(entry.meta.absPath)
      fs.unlinkSync(entry.meta.absPath)
      logAccess(state, entry.id, 'delete', body.actor, body.reason || 'backup=' + home(backup))
      buryEntry(state, entry, 'vault', body.reason)
      saveState(state)
      return { id: entry.id, backup: home(backup) }
    }
    case 'json': {
      const doc = readJsonSafe(entry.meta.absPath, 2 * 1024 * 1024)
      if (!doc) throw new Error('JSON 不可读')
      const ok = deleteJsonPointer(doc, entry.meta.pointer)
      if (!ok) throw new Error('字段已不存在')
      const backup = backupFile(entry.meta.absPath)
      writeFileAtomic(entry.meta.absPath, JSON.stringify(doc, null, 2) + '\n', 0o600)
      logAccess(state, entry.id, 'delete-field', body.actor, body.reason || 'backup=' + home(backup))
      buryEntry(state, entry, 'vault', body.reason)
      saveState(state)
      return { id: entry.id, backup: home(backup) }
    }
    case 'config':
      throw new Error('明文配置项不代删；请人工改成引用名（本插件可给出建议）')
    default:
      throw new Error('不支持的类型')
  }
}

/** 收归仓储：把只读来源的值存进 credential store（之后由本插件统一管理）。 */
async function doPromote(ctx, state, entries, body) {
  const entry = resolveEntry(entries, body.id || body.name)
  if (!entry) throw new Error('找不到条目：' + String(body.id || body.name))
  const targetName = typeof body.targetName === 'string' && body.targetName
    ? body.targetName
    : (entry.kind === 'config' ? entry.meta.key : entry.name)
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(targetName)) throw new Error('目标名必须是 POSIX 标识符')
  const hit = await readEntryValue(ctx, entry)
  await ctx.credentials.set(targetName, hit.value)
  if (state.tombstones) delete state.tombstones['ref:' + targetName]
  state.entries['ref:' + targetName] = {
    ...(state.entries['ref:' + targetName] || {}),
    label: entry.label,
    note: '收归自 ' + entry.origin + '。注意：原处的值仍然存在（store 优先级最高，会盖住它）；' +
      '确认无误后请把原处改成引用名或删掉，否则等于存了两份。',
    updatedAt: nowIso(),
  }
  logAccess(state, 'ref:' + targetName, 'promote', body.actor, 'from ' + entry.id)
  saveState(state)
  return { id: 'ref:' + targetName, source: entry.id }
}

function resolveEntry(entries, key) {
  if (!key) return undefined
  return entries.find((e) => e.id === key) || entries.find((e) => e.name === key)
}

// ── 对外视图 ───────────────────────────────────────────────────────────────

/** 使用统计：平均频率 + 最近一次使用（访问日志与引用痕迹分开算，别混为一谈）。 */
function usageStats(state, entry, usage) {
  const DAY = 86400000
  const now = Date.now()
  const times = state.access
    .filter((a) => a.id === entry.id)
    .map((a) => Date.parse(a.at))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b)
  let avgIntervalDays = null
  if (times.length >= 2) {
    const span = times[times.length - 1] - times[0]
    avgIntervalDays = span > 0 ? Number((span / (times.length - 1) / DAY).toFixed(1)) : 0
  }
  const sessions = (usage && usage.sessions) || []
  const sessionTimes = sessions.map((x) => Date.parse(x.at)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  let avgSessionIntervalDays = null
  if (sessionTimes.length >= 2) {
    const span = sessionTimes[sessionTimes.length - 1] - sessionTimes[0]
    avgSessionIntervalDays = span > 0 ? Number((span / (sessionTimes.length - 1) / DAY).toFixed(1)) : 0
  }
  return {
    accessCount: times.length,
    lastAccessAt: times.length > 0 ? new Date(times[times.length - 1]).toISOString() : '',
    firstAccessAt: times.length > 0 ? new Date(times[0]).toISOString() : '',
    avgIntervalDays,
    last7: times.filter((t) => now - t <= 7 * DAY).length,
    last30: times.filter((t) => now - t <= 30 * DAY).length,
    avgSessionIntervalDays,
    sessionCount: sessions.length,
    sessionTruncated: sessions.length >= 30,
    lastSessionAt: sessionTimes.length > 0 ? new Date(sessionTimes[sessionTimes.length - 1]).toISOString() : '',
  }
}

function publicEntry(entry, state, index, opts) {
  const usage = usageFor(entry, index)
  const access = state.access.filter((a) => a.id === entry.id)
  const last = access.length > 0 ? access[access.length - 1] : undefined
  const out = {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    label: entry.label,
    note: entry.note,
    tags: entry.tags,
    pinned: entry.pinned === true,
    hidden: entry.hidden === true,
    tombstoned: entry.tombstoned === true,
    deletedAt: entry.deletedAt || '',
    configured: entry.configured !== false,
    writable: entry.writable === true,
    deletable: entry.deletable === true || entry.writable === true,
    promotable: entry.promotable === true,
    source: entry.source,
    origin: entry.origin,
    masked: entry.masked || '',
    meta: sanitizeMeta(entry.meta),
    risk: entry.risk || [],
    usage,
    stats: usageStats(state, entry, usage),
    access: { count: access.length, lastAt: last ? last.at : '', lastAction: last ? last.action : '' },
  }
  if (opts && opts.withAccess) out.accessLog = access.slice(-40).reverse()
  return out
}

function sanitizeMeta(meta) {
  if (!meta || typeof meta !== 'object') return {}
  const out = {}
  for (const [k, v] of Object.entries(meta)) {
    if (k === 'value' || k === 'secret') continue
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v)) out[k] = v
  }
  return out
}

function buildStatePayload(ctx, state, entries) {
  const kinds = {}
  for (const e of entries) kinds[e.kind] = (kinds[e.kind] || 0) + 1
  const usedPlugins = new Set()
  const usedSkills = new Set()
  const usedSessions = new Set()
  for (const e of entries) {
    const u = usageFor(e, state.index)
    for (const p of u.plugins) usedPlugins.add(p.name)
    for (const s of u.skills) usedSkills.add(s.name)
    for (const s of u.sessions) usedSessions.add(s.id)
  }
  return {
    ok: true,
    now: nowIso(),
    home: home(DSH_HOME),
    version: PLUGIN_VERSION,
    persistence: persistenceInfo(),
    storeFile: home(STATE_FILE),
    credFile: home(CRED_FILE),
    stats: {
      total: entries.length,
      configured: entries.filter((e) => e.configured).length,
      kinds,
      plugins: usedPlugins.size,
      skills: usedSkills.size,
      sessions: usedSessions.size,
      access: state.access.length,
    },
    index: state.index ? { at: state.index.at, durationMs: state.index.durationMs } : null,
    meta: {
      firstScanAt: (state.meta && state.meta.firstScanAt) || '',
      lastScan: (state.meta && state.meta.lastScan) || null,
    },
    entries: entries.map((e) => publicEntry(e, state, state.index, { withAccess: true })),
    recentAccess: state.access.slice(-30).reverse(),
  }
}

// ── HTTP ───────────────────────────────────────────────────────────────────

function resolveWebServer(ctx) {
  try {
    const viaGet = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
    if (viaGet) return viaGet
  } catch { /* 取不到就当没有 */ }
  return ctx.webServer
}

function hasRoutes(server) {
  return !!server && typeof server.register === 'function'
}

function sendJson(res, code, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(body.length),
  })
  res.end(body)
}

function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) {
        req.destroy()
        resolve('')
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

// ── 插件 ───────────────────────────────────────────────────────────────────

export function apply(ctx) {
  const webServer = resolveWebServer(ctx)
  const state = loadState()
  let scanning = null
  let entriesCache = null
  let entriesAt = 0
  let discoverPromise = null

  /** 发现结果做短缓存：一次页面加载里多次调用不必重复 describe。 */
  async function getEntries(force) {
    if (!force && entriesCache && Date.now() - entriesAt < 5000) return entriesCache
    if (discoverPromise) {
      await discoverPromise
      return entriesCache
    }
    discoverPromise = (async () => {
      const found = await discover(ctx, state)
      entriesCache = found
      entriesAt = Date.now()
    })()
    try {
      await discoverPromise
    } finally {
      discoverPromise = null
    }
    return entriesCache
  }

  /** 任何写操作之后都要让发现缓存失效，否则页面会拿回旧注记（真实 bug）。 */
  function invalidateEntries() {
    entriesCache = null
    entriesAt = 0
  }

  /** 索引过期就后台重建（页面不必等）。 */
  function ensureIndex(entries, force) {
    const fresh = state.index && state.index.at && (Date.now() - Date.parse(state.index.at) < 10 * 60 * 1000)
    if (scanning) return scanning
    if (!force && fresh) return Promise.resolve(undefined)
    const snapshot = entries || entriesCache || []
    scanning = new Promise((resolve) => {
      setImmediate(() => {
        rebuildIndex(ctx, state, snapshot)
          .catch((err) => {
            try {
              ctx.logger?.warn?.('[' + NS + '] 引用索引重建失败：' + String(err && err.message ? err.message : err))
            } catch { /* ignore */ }
          })
          .finally(() => {
            scanning = null
            resolve(undefined)
          })
      })
    })
  }

  /**
   * 首屏把索引备好；**首次安装**（没有 firstScanAt）时强制完整扫一遍已有会话，
   * 让新装用户一打开就能看到「谁用过哪把钥匙」，而不是等 10 分钟或手动点扫描。
   * 扫描在后台分片跑，不阻塞插件启动。
   */
  const firstInstall = !(state.meta && state.meta.firstScanAt)
  setTimeout(() => {
    getEntries(true)
      .then((found) => ensureIndex(found, firstInstall))
      .then(() => {
        if (!firstInstall) return
        state.meta = state.meta || {}
        state.meta.firstScanAt = nowIso()
        saveState(state)
        try {
          // 从落盘后的 state 读计数，避免时序问题打印出 0
          const fresh = readJsonSafe(STATE_FILE, 4 * 1024 * 1024) || {}
          const last = (fresh.meta && fresh.meta.lastScan) || state.meta.lastScan || {}
          const needles = fresh.index && fresh.index.needle ? Object.keys(fresh.index.needle).length : 0
          ctx.logger?.info?.('[' + NS + '] 首次安装扫描完成：会话 ' + (last.sessions || 0) +
            ' 个、跳过归档 ' + (last.archivedSkipped || 0) + ' 个、检索串 ' + needles + ' 个，索引就绪')
        } catch { /* ignore */ }
      })
      .catch(() => { /* 首次扫描失败不影响插件可用：用户可以手动点重建 */ })
  }, 1200)

  const disposers = []

  if (hasRoutes(webServer)) {
    const rejected = (req, res) => {
      try {
        const conn = (typeof ctx.get === 'function' ? ctx.get('connection') : undefined) || ctx.connection
        if (!conn || typeof conn.requestRejection !== 'function') return false
        const code = conn.requestRejection(req)
        if (code === undefined || code === null || code === false) return false
        res.statusCode = typeof code === 'number' ? code : 403
        res.end()
        return true
      } catch {
        return false
      }
    }

    const registerRoute = (route) => {
      const inner = route.handler
      return webServer.register({
        ...route,
        handler: async (req, res) => {
          if (rejected(req, res)) return
          try {
            return await inner(req, res)
          } catch (err) {
            try {
              sendJson(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
            } catch { /* 响应已发 */ }
          }
        },
      })
    }

    disposers.push(registerRoute({
      kind: 'exact',
      path: ROUTE_BASE + '/state',
      handler: async (req, res) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const entries = await getEntries(url.searchParams.get('fresh') === '1')
        ensureIndex(entries, url.searchParams.get('refresh') === '1')
        sendJson(res, 200, buildStatePayload(ctx, state, entries))
      },
    }))

    disposers.push(registerRoute({
      kind: 'exact',
      path: ROUTE_BASE + '/act',
      handler: async (req, res) => {
        if ((req.method || 'GET').toUpperCase() !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        const text = await readBody(req)
        let body = {}
        try {
          body = text ? JSON.parse(text) : {}
        } catch {
          sendJson(res, 400, { ok: false, error: 'JSON 解析失败' })
          return
        }
        const entries = await getEntries(true)
        const action = String(body.action || '')
        try {
          if (action === 'reveal') {
            const entry = resolveEntry(entries, body.id)
            if (!entry) throw new Error('找不到条目')
            const hit = await readEntryValue(ctx, entry)
            logAccess(state, entry.id, 'reveal', body.actor, body.reason)
            saveState(state)
            sendJson(res, 200, { ok: true, id: entry.id, value: hit.value, extra: hit.extra || {} })
            return
          }
          if (action === 'set') {
            const r = await doSet(ctx, state, entries, body)
            invalidateEntries()
            sendJson(res, 200, { ok: true, ...r })
            return
          }
          if (action === 'delete') {
            const r = await doDelete(ctx, state, entries, body)
            invalidateEntries()
            sendJson(res, 200, { ok: true, ...r })
            return
          }
          if (action === 'annotate') {
            const entry = resolveEntry(entries, body.id)
            if (!entry) throw new Error('找不到条目')
            const prev = state.entries[entry.id] || {}
            const next = { ...prev }
            if (typeof body.label === 'string') next.label = body.label.slice(0, 120)
            if (typeof body.note === 'string') next.note = body.note.slice(0, 2000)
            if (Array.isArray(body.tags)) next.tags = body.tags.map((t) => String(t).slice(0, 24)).slice(0, 8)
            if (typeof body.pinned === 'boolean') next.pinned = body.pinned
            if (typeof body.hidden === 'boolean') next.hidden = body.hidden
            next.updatedAt = nowIso()
            if (!next.createdAt) next.createdAt = nowIso()
            state.entries[entry.id] = next
            saveState(state)
            invalidateEntries()
            sendJson(res, 200, { ok: true })
            return
          }
          if (action === 'suppress') {
            const id = String(body.id || '')
            if (!id) throw new Error('suppress 需要 id')
            const entry = entries.find((e) => e.id === id) || { id, name: body.name || id, kind: body.kind || 'unknown' }
            buryEntry(state, entry, 'user', body.reason)
            saveState(state)
            invalidateEntries()
            sendJson(res, 200, { ok: true, tombstoned: true })
            return
          }
          if (action === 'unsuppress') {
            const entry = resolveEntry(entries, body.id)
            if (!entry) throw new Error('找不到条目')
            if (state.tombstones) delete state.tombstones[entry.id]
            const prev = state.entries[entry.id] || {}
            state.entries[entry.id] = { ...prev, hidden: false, updatedAt: nowIso(), createdAt: prev.createdAt || nowIso() }
            saveState(state)
            invalidateEntries()
            sendJson(res, 200, { ok: true, tombstoned: false })
            return
          }
          if (action === 'forget' || action === 'restore') {
            const entry = resolveEntry(entries, body.id)
            if (!entry) throw new Error('找不到条目')
            const prev = state.entries[entry.id] || {}
            state.entries[entry.id] = {
              ...prev,
              hidden: action === 'forget',
              updatedAt: nowIso(),
              createdAt: prev.createdAt || nowIso(),
            }
            saveState(state)
            invalidateEntries()
            sendJson(res, 200, { ok: true, hidden: action === 'forget' })
            return
          }
          if (action === 'promote') {
            const r = await doPromote(ctx, state, entries, body)
            invalidateEntries()
            sendJson(res, 200, { ok: true, ...r })
            return
          }
          if (action === 'scan') {
            ensureIndex(entries, true)
            sendJson(res, 200, { ok: true, started: true })
            return
          }
          if (action === 'import') {
            // 一次性把当前所有发现项登记进注记表（值不动）
            let added = 0
            for (const e of entries) {
              if (state.entries[e.id]) continue
              state.entries[e.id] = {
                label: e.label,
                note: e.note || '',
                tags: e.tags || [],
                createdAt: nowIso(),
                updatedAt: nowIso(),
              }
              added++
            }
            saveState(state)
            invalidateEntries()
            sendJson(res, 200, { ok: true, added, total: entries.length })
            return
          }
          sendJson(res, 400, { ok: false, error: '未知动作：' + action })
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String(err && err.message ? err.message : err) })
        }
      },
    }))
  } else {
    try {
      ctx.logger?.warn?.('[' + NS + '] 当前 profile 没有可用的 webServer，设置页不可用（工具仍可用）')
    } catch { /* ignore */ }
  }

  // ── 工具：以后所有取用密钥的行为都走这里 ────────────────────────────────
  const tools = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('tools') : undefined
    } catch {
      return undefined
    }
  })()

  if (tools && typeof tools.register === 'function') {
    const toolDefinition = {
      name: 'vault',
      description:
        '钥匙簿（唯一授权取用入口）。list=列出所有凭据（只给掩码，绝不给值）；' +
        'describe=单个凭据的详情与使用方（插件/技能/会话）；get=取用明文值（必须给 reason，会记入访问日志）；' +
        'set=新增或修改；delete=删除（必须 confirm）；scan=重建引用索引。' +
        '需要任何 API key / token / 密码 / 凭据时，一律用本工具 get，不要直接读 ~/.dsh/.credentials.yaml、' +
        '不要 echo 环境变量、不要在插件配置里硬编码。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'describe', 'get', 'set', 'delete', 'scan'],
            description: 'list | describe | get | set | delete | scan',
          },
          name: {
            type: 'string',
            description: '条目 id（如 ref:DEEPSEEK_API_KEY）或凭据名（如 DEEPSEEK_API_KEY）。set 时若不存在则按名字新建 ref。',
          },
          value: { type: 'string', description: 'set 时的新值' },
          reason: { type: 'string', description: '为什么需要它（写进访问日志，便于审计）' },
          confirm: { type: 'boolean', description: 'delete 必须为 true' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        const action = String(args && args.action ? args.action : '')
        const entries = await getEntries(true)
        const actor = describeActor(exec)
        if (action === 'list') {
          const lines = ['# 钥匙簿 · ' + entries.length + ' 条']
          for (const e of entries) {
            const u = usageFor(e, state.index)
            lines.push(
              '- ' + e.id + '  [' + e.kind + '] ' + e.label +
              ' 值=' + (e.masked || '(空)') +
              ' 来源=' + e.source +
              ' 使用方=' + (u.plugins.length + u.skills.length + u.sessions.length) + '个' +
              (usageStats(state, e, u).lastAccessAt ? ' 最近取用=' + usageStats(state, e, u).lastAccessAt : '')
            )
          }
          lines.push('')
          lines.push('要取值请用 action=get + name + reason。')
          return lines.join('\n')
        }
        if (action === 'describe') {
          const entry = resolveEntry(entries, args.name)
          if (!entry) throw new Error('找不到条目：' + String(args.name))
          const u = usageFor(entry, state.index)
          const st = usageStats(state, entry, u)
          const lines = [
            'id: ' + entry.id,
            '类型: ' + entry.kind + ' / 来源: ' + entry.source + ' / 位置: ' + entry.origin,
            '掩码: ' + (entry.masked || '(空)'),
            '可写: ' + (entry.writable ? '是' : '否') + ' / 可删: ' + (entry.deletable || entry.writable ? '是' : '否'),
          ]
          if (u.configs.length > 0) lines.push('配置引用: ' + u.configs.map((c) => (c.entryId || '?') + ' @' + c.file + ':' + c.line).join(', '))
          if (u.plugins.length > 0) lines.push('插件: ' + u.plugins.map((p) => p.name).join(', '))
          if (u.skills.length > 0) lines.push('技能: ' + u.skills.map((p) => p.name).join(', '))
          if (u.sessions.length > 0) lines.push('会话: ' + u.sessions.slice(0, 8).map((s) => s.id + (s.cwd ? '(' + s.cwd + ')' : '')).join(', '))
          lines.push('取用: ' + st.accessCount + ' 次' +
            (st.lastAccessAt ? '，最近 ' + st.lastAccessAt : '') +
            (st.avgIntervalDays !== null ? '，平均间隔 ' + st.avgIntervalDays + ' 天' : ''))
          lines.push('近7天: ' + st.last7 + ' 次 / 近30天: ' + st.last30 + ' 次')
          if (st.sessionCount > 0) lines.push('会话引用: ' + st.sessionCount + (st.sessionTruncated ? '+' : '') + ' 次' + (st.lastSessionAt ? '，最近 ' + st.lastSessionAt : ''))
          return lines.join('\n')
        }
        if (action === 'get') {
          const entry = resolveEntry(entries, args.name)
          if (!entry) throw new Error('找不到条目：' + String(args.name) + '（先 action=list 看看有哪些）')
          const hit = await readEntryValue(ctx, entry)
          logAccess(state, entry.id, 'get', actor, args.reason)
          saveState(state)
          return hit.value
        }
        if (action === 'set') {
          const r = await doSet(ctx, state, entries, { ...args, actor, reason: args.reason })
          return '已写入：' + r.id + (r.backup ? '（备份 ' + r.backup + '）' : '')
        }
        if (action === 'delete') {
          const r = await doDelete(ctx, state, entries, { ...args, actor, reason: args.reason, confirm: args.confirm === true })
          return '已删除：' + r.id + (r.backup ? '（备份 ' + r.backup + '）' : '')
        }
        if (action === 'scan') {
          await rebuildIndex(ctx, state, entries)
          const n = state.index && state.index.needle ? Object.keys(state.index.needle).length : 0
          return '索引已重建：' + n + ' 个检索串，耗时 ' + (state.index ? state.index.durationMs : 0) + 'ms'
        }
        throw new Error('未知 action：' + action)
      },
    }
    disposers.push(ctx.effect(() => tools.register(toolDefinition)))
  }

  // ── 系统提示：把「以后一律走保险库」写成常驻纪律 ──────────────────────
  const systemPrompt = (() => {
    try {
      return typeof ctx.get === 'function' ? ctx.get('systemPrompt') : undefined
    } catch {
      return undefined
    }
  })()

  if (systemPrompt && typeof systemPrompt.section === 'function') {
    disposers.push(ctx.effect(() => systemPrompt.section({
      name: 'dsh-key-ledger:credential-policy',
      order: 1500,
      text: [
        '## 密钥与凭据（硬性纪律）',
        '本机装有钥匙簿插件 `dsh-key-ledger`（工具名 `vault`），它是取用任何凭据的唯一授权入口。',
        '需要 API key、token、密码、cookie、SSH 私钥或任何凭据时：调用 `vault` 工具，`action: "get"`，`name` 填凭据名（如 `DEEPSEEK_API_KEY`），`reason` 写清用途。',
        '禁止：直接读 `~/.dsh/.credentials.yaml` 或其它凭据文件、`echo`/`printenv` 环境变量、把密钥写进配置文件或插件源码、在回复里回显完整密钥。',
        '不确定有哪些凭据时先 `vault` `action: "list"`；要看某个凭据被哪些插件/技能/会话用过，用 `action: "describe"`。',
        '用户可在 Settings → 钥匙簿 里查看、修改、删除全部凭据。',
      ].join('\n'),
    })))
  }

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) {
      try {
        if (typeof dispose === 'function') dispose()
      } catch { /* 卸载时尽力而为 */ }
    }
  })
}

/** 从 tool 执行上下文里尽力还原调用者身份（拿不到就如实留空）。 */
function describeActor(exec) {
  const actor = {}
  try {
    const agent = exec && exec.agent
    if (agent) {
      if (typeof agent.name === 'string') actor.agent = agent.name
      const session = agent.session
      if (session && typeof session.id === 'string') actor.sessionId = session.id
      else if (session && typeof session.sessionId === 'string') actor.sessionId = session.sessionId
      else if (typeof agent.sessionId === 'string') actor.sessionId = agent.sessionId
    }
    if (exec && typeof exec.callId === 'string') actor.callId = exec.callId
  } catch { /* ignore */ }
  actor.tool = 'vault'
  return actor
}
