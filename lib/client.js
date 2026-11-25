/**
 * dsh-key-ledger — 钥匙簿（Client 半侧）
 * ---------------------------------------------------------------------------
 * 在 Settings 里注册一页「钥匙簿」：
 *   · 列出 Host 发现的全部凭据（只拿掩码，值不进列表）
 *   · 每条展开可看「谁在用它」：插件包 / 技能 / 会话 / 配置引用（带 file:line）
 *   · 显式「显示」才向 Host 取明文；修改、删除、收归仓储、注记都在这里
 *
 * 只依赖模块表里的 react，样式全部走 --dsw-alias-* 主题令牌，
 * 不引用任何 Harness Client 包，避免版本漂移把页面炸掉。
 */
window.__ModuleLoader__.load({
  id: 'dsh-key-ledger',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    var React = require('react')
    var h = React.createElement

    var API = '/dsh-key-ledger/api'

    /* ── 样式 ─────────────────────────────────────────────────────────── */
    var CSS = [
      '.__vt_root{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary);max-width:840px}',
      '.__vt_head{display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-settings-card-fill,var(--dsw-alias-bg-layer-2))}',
      '.__vt_titleRow{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}',
      '.__vt_title{font-size:15px;font-weight:650;letter-spacing:.01em}',
      '.__vt_ver{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-tertiary)}',
      '.__vt_sub{font-size:11.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.__vt_toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.__vt_search{flex:1 1 220px;min-width:160px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:9px;padding:7px 11px;font:inherit;font-size:13px;outline:none;box-sizing:border-box}',
      '.__vt_search:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.__vt_chips{display:flex;gap:6px;flex-wrap:wrap}',
      '.__vt_chip{font:inherit;font-size:11.5px;line-height:1;padding:6px 10px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.__vt_chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l3)}',
      '.__vt_chipOn{background:var(--dsw-alias-bg-multi-select,var(--dsw-alias-bg-layer-3));border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary);font-weight:600}',
      '.__vt_btn{font:inherit;font-size:12.5px;padding:6px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}',
      '.__vt_btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}',
      '.__vt_btn:disabled{opacity:.5;cursor:default}',
      '.__vt_btnPrimary{border-color:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-on-color,#fff)}',
      '.__vt_btnPrimary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}',
      '.__vt_btnDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.__vt_btnDanger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger,rgba(220,60,60,.12))}',
      '.__vt_btnGhost{border-color:transparent;background:transparent;color:var(--dsw-alias-label-secondary)}',
      '.__vt_btnGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-label-primary)}',
      '.__vt_list{display:flex;flex-direction:column;gap:8px}',
      '.__vt_table{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}',
      '.__vt_thead,.__vt_trow{display:grid;grid-template-columns:minmax(0,1fr) 84px 58px;align-items:center;gap:10px;padding:6px 10px}',
      '.__vt_thead{background:var(--dsw-alias-bg-layer-3);border-bottom:1px solid var(--dsw-alias-border-l2);font-size:10.5px;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary)}',
      '.__vt_trow{border-top:1px solid var(--dsw-alias-border-l1);font-size:12px}',
      '.__vt_trow:hover{background:var(--dsw-alias-interactive-bg-hover,transparent)}',
      '.__vt_tname{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary)}',
      '.__vt_tnum{text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.__vt_thead .__vt_tnum{color:var(--dsw-alias-label-tertiary)}',
      '.__vt_row{border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-card-fill,var(--dsw-alias-bg-layer-2));overflow:hidden;transition:border-color .12s}',
      '.__vt_rowOpen{border-color:var(--dsw-alias-border-selected,var(--dsw-alias-brand-primary))}',
      '.__vt_rowHead{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer}',
      '.__vt_rowHead:hover{background:var(--dsw-alias-interactive-bg-hover,transparent)}',
      '.__vt_dot{width:8px;height:8px;border-radius:50%;flex:none;box-shadow:0 0 0 3px rgba(0,0,0,.06)}',
      '.__vt_rowMain{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}',
      '.__vt_rowTop{display:flex;align-items:center;gap:7px;flex-wrap:wrap}',
      '.__vt_name{font-family:ui-monospace,Consolas,monospace;font-size:12.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.__vt_label{font-size:12px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.__vt_masked{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:var(--dsw-alias-label-secondary);letter-spacing:.04em}',
      '.__vt_pill{font-size:10.5px;line-height:1;padding:3px 7px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-3);white-space:nowrap}',
      '.__vt_pillWarn{border-color:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-warn-primary))}',
      '.__vt_pillDanger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}',
      '.__vt_rowRight{display:flex;align-items:center;gap:6px;flex:none}',
      '.__vt_usage{display:flex;gap:5px;flex-wrap:wrap}',
      '.__vt_detail{border-top:1px solid var(--dsw-alias-border-l1);padding:12px 14px 14px;display:flex;flex-direction:column;gap:12px;background:var(--dsw-alias-bg-layer-1)}',
      '.__vt_sec{display:flex;flex-direction:column;gap:6px}',
      '.__vt_secTitle{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.__vt_valueBox{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3)}',
      '.__vt_value{font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:.03em;word-break:break-all;flex:1 1 200px;min-width:0}',
      '.__vt_hint{font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary)}',
      '.__vt_input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:8px;padding:7px 10px;font:inherit;font-size:12.5px;outline:none}',
      '.__vt_input:focus{border-color:var(--dsw-alias-brand-primary)}',
      '.__vt_inputMono{font-family:ui-monospace,Consolas,monospace;font-size:12px}',
      '.__vt_textarea{min-height:64px;resize:vertical;line-height:1.55}',
      '.__vt_actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.__vt_item{display:flex;flex-direction:column;gap:2px;padding:7px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.__vt_itemName{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);word-break:break-all}',
      '.__vt_ev{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--dsw-alias-label-tertiary);word-break:break-all}',
      '.__vt_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:7px}',
      '.__vt_kv{display:flex;gap:8px;font-size:11.5px;line-height:1.6}',
      '.__vt_k{color:var(--dsw-alias-label-tertiary);flex:none;min-width:64px}',
      '.__vt_v{color:var(--dsw-alias-label-secondary);word-break:break-all}',
      '.__vt_empty{padding:28px 16px;text-align:center;font-size:12.5px;color:var(--dsw-alias-label-tertiary);border:1px dashed var(--dsw-alias-border-l2);border-radius:11px}',
      '.__vt_err{padding:10px 12px;border-radius:9px;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.55;background:var(--dsw-alias-interactive-bg-hover-danger,transparent)}',
      '.__vt_ok{font-size:11.5px;color:var(--dsw-alias-state-success-primary)}',
      '.__vt_warn{font-size:11.5px;color:var(--dsw-alias-state-warn-primary)}',
      '.__vt_timeline{display:flex;flex-direction:column;gap:5px;max-height:220px;overflow:auto;padding-right:4px}',
      '.__vt_ev_row{display:flex;gap:8px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.__vt_ev_time{font-family:ui-monospace,Consolas,monospace;color:var(--dsw-alias-label-tertiary);flex:none}',
      '.__vt_metaline{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:6px;flex-wrap:wrap;align-items:center}',
      '.__vt_metaline b{font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.__vt_mini{display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.__vt_miniK{font-size:10.5px;color:var(--dsw-alias-label-tertiary);letter-spacing:.03em}',
      '.__vt_miniV{font-size:13px;font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.__vt_miniS{font-size:10.5px;color:var(--dsw-alias-label-tertiary)}',
      '.__vt_footer{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:11px;color:var(--dsw-alias-label-tertiary);line-height:1.6}',
      '.__vt_addForm{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-layer-2)}',
    ].join('\n')

    /* ── 小工具 ───────────────────────────────────────────────────────── */
    var KIND_META = {
      ref: { label: '凭证引用', color: 'var(--dsw-alias-brand-primary)' },
      record: { label: '授权记录', color: 'var(--dsw-alias-chart-system,var(--dsw-alias-state-success-primary))' },
      env: { label: '环境变量', color: 'var(--dsw-alias-state-warn-primary)' },
      envfile: { label: 'env 文件', color: 'var(--dsw-alias-state-warn-secondary,var(--dsw-alias-state-warn-primary))' },
      file: { label: '文件', color: 'var(--dsw-alias-state-error-primary)' },
      json: { label: 'JSON 字段', color: 'var(--dsw-alias-chart-tools,var(--dsw-alias-state-success-primary))' },
      config: { label: '明文配置', color: 'var(--dsw-alias-state-error-primary)' },
    }
    var KIND_ORDER = ['ref', 'record', 'env', 'envfile', 'json', 'file', 'config']

    var ACTION_LABEL = {
      get: '取用',
      reveal: '显示',
      set: '修改',
      create: '新建',
      delete: '删除',
      promote: '收归仓储',
      replace: '替换文件',
      'set-field': '改字段',
      'delete-field': '删字段',
    }

    function api(path, init) {
      return fetch(API + path, init).then(function (r) {
        return r.json().then(function (j) {
          if (!j || j.ok !== true) throw new Error((j && j.error) || ('HTTP ' + r.status))
          return j
        })
      })
    }

    function post(body) {
      return api('/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    }

    function fmtTime(iso) {
      if (!iso) return ''
      var d = new Date(iso)
      if (isNaN(d.getTime())) return String(iso)
      var p = function (n) { return n < 10 ? '0' + n : String(n) }
      return (d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
    }

    function ago(iso) {
      var t = Date.parse(iso)
      if (!isFinite(t)) return ''
      var diff = Date.now() - t
      if (diff < 0) return '刚刚'
      var m = Math.floor(diff / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return m + ' 分钟前'
      var h = Math.floor(m / 60)
      if (h < 24) return h + ' 小时前'
      var d = Math.floor(h / 24)
      if (d < 30) return d + ' 天前'
      if (d < 365) return Math.floor(d / 30) + ' 个月前'
      return Math.floor(d / 365) + ' 年前'
    }

    function fmtAvg(days) {
      if (days === null || days === undefined) return '—'
      if (days === 0) return '同一时段'
      if (days < 1) return (days * 24).toFixed(1) + ' 小时/次'
      return days + ' 天/次'
    }

    function statsLine(e) {
      var st = e.stats || {}
      var parts = []
      if (st.lastAccessAt) parts.push('最近取用 ' + ago(st.lastAccessAt))
      else if (st.lastSessionAt) parts.push('最近引用 ' + ago(st.lastSessionAt))
      if (st.avgIntervalDays !== null && st.avgIntervalDays !== undefined) parts.push('平均取用 ' + fmtAvg(st.avgIntervalDays))
      else if (st.avgSessionIntervalDays !== null && st.avgSessionIntervalDays !== undefined) parts.push('引用平均 ' + fmtAvg(st.avgSessionIntervalDays))
      if (st.accessCount > 0) parts.push('共取用 ' + st.accessCount + ' 次')
      else if (st.sessionCount > 0) parts.push('会话引用 ' + st.sessionCount + ' 次')
      return parts.length > 0 ? parts.join(' · ') : '暂无使用记录'
    }

    function MiniStat(props) {
      return h('div', { className: '__vt_mini' },
        h('div', { className: '__vt_miniK' }, props.label),
        h('div', { className: '__vt_miniV' }, String(props.value)),
        props.sub ? h('div', { className: '__vt_miniS' }, props.sub) : null
      )
    }

    function fmtBytes(n) {
      if (!n) return ''
      if (n < 1024) return n + ' B'
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
      return (n / 1024 / 1024).toFixed(1) + ' MB'
    }

    /** 为什么不能删（如实说明，别让按钮凭空消失）。 */
    function deleteReason(e) {
      if (e.kind === 'env') return '启动时的环境变量，删不掉（不是本插件存的）；可「移出列表」'
      if (e.kind === 'config') return '明文配置不代删（改配置有风险）；建议收归仓储，或「移出列表」'
      return '只读条目'
    }

    function clone(o) {
      try { return JSON.parse(JSON.stringify(o)) } catch (e) { return o }
    }

    /* ── 小组件 ───────────────────────────────────────────────────────── */
    function Pill(props) {
      var cls = '__vt_pill' + (props.tone === 'warn' ? ' __vt_pillWarn' : props.tone === 'danger' ? ' __vt_pillDanger' : '')
      return h('span', { className: cls, title: props.title || '' }, props.children)
    }

    function Section(props) {
      return h('div', { className: '__vt_sec' },
        h('div', { className: '__vt_secTitle' }, props.title),
        props.children
      )
    }

    function UsageGroup(props) {
      var items = props.items || []
      if (items.length === 0) return h('div', { className: '__vt_hint' }, props.empty || '（无）')
      return h('div', { className: '__vt_grid' }, items.map(function (item, i) {
        return h('div', { className: '__vt_item', key: (item.name || item.id || i) },
          h('div', { className: '__vt_itemName' }, item.name || item.id || ''),
          (item.evidence || []).slice(0, 3).map(function (ev, j) {
            return h('div', { className: '__vt_ev', key: j }, ev.file + (ev.line ? ':' + ev.line : ''))
          }),
          item.packageDir ? h('div', { className: '__vt_ev' }, item.packageDir) : null
        )
      }))
    }

    /* ── 主面板 ───────────────────────────────────────────────────────── */
    function Panel() {
      var [data, setData] = React.useState(null)
      var [error, setError] = React.useState(null)
      var [busy, setBusy] = React.useState('')
      var [notice, setNotice] = React.useState(null)
      var [q, setQ] = React.useState('')
      var [kind, setKind] = React.useState('all')
      var [sortBy, setSortBy] = React.useState('default')
      var [showHidden, setShowHidden] = React.useState(false)
      var [openId, setOpenId] = React.useState(null)
      var [revealed, setRevealed] = React.useState({})
      var [confirmId, setConfirmId] = React.useState(null)
      var [editing, setEditing] = React.useState({})
      var [adding, setAdding] = React.useState(null)
      var [scanning, setScanning] = React.useState(false)
      var timers = React.useRef({})
      var searchRef = React.useRef(null)

      function flash(msg, isErr) {
        setNotice({ text: msg, err: !!isErr })
        if (timers.current.notice) clearTimeout(timers.current.notice)
        timers.current.notice = setTimeout(function () { setNotice(null) }, 6000)
      }

      function load(opts) {
        setError(null)
        var fresh = opts && opts.fresh ? '?fresh=1' : ''
        return api('/state' + fresh)
          .then(function (j) {
            setData(j)
          })
          .catch(function (e) {
            setError('读取失败：' + String(e && e.message ? e.message : e))
          })
      }

      React.useEffect(function () {
        load()
        return function () {
          Object.keys(timers.current).forEach(function (k) { clearTimeout(timers.current[k]) })
        }
      }, [])

      // 索引在后台重建时，稍后再拉一次（只拉两次，不做轮询）
      React.useEffect(function () {
        if (!scanning) return
        var t1 = setTimeout(function () { load() }, 6000)
        var t2 = setTimeout(function () { setScanning(false); load() }, 16000)
        return function () { clearTimeout(t1); clearTimeout(t2) }
      }, [scanning])

      function runScan() {
        setScanning(true)
        setBusy('scan')
        post({ action: 'scan' })
          .then(function () { flash('已开始重建引用索引，稍后自动刷新。') })
          .catch(function (e) { flash(String(e.message || e), true); setScanning(false) })
          .then(function () { setBusy('') })
      }

      function reveal(entry) {
        setBusy(entry.id)
        return post({ action: 'reveal', id: entry.id, reason: '在设置页查看' })
          .then(function (j) {
            setRevealed(function (prev) {
              var next = clone(prev)
              next[entry.id] = j.value
              return next
            })
            if (timers.current[entry.id]) clearTimeout(timers.current[entry.id])
            // 明文 60 秒后自动收回，避免长期挂在页面上
            timers.current[entry.id] = setTimeout(function () {
              setRevealed(function (prev) {
                var next = clone(prev)
                delete next[entry.id]
                return next
              })
            }, 60000)
            return j.value
          })
          .catch(function (e) { flash('取值失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      /** 点「修改」先取到当前值填进去，避免在空白框里盲改。 */
      function startEdit(entry) {
        var current = revealed[entry.id]
        var fill = function (value) {
          setEditing(function (prev) {
            var n = clone(prev)
            n[entry.id] = value === undefined ? '' : String(value)
            return n
          })
        }
        if (current !== undefined) {
          fill(current)
          return
        }
        reveal(entry).then(fill)
      }

      function hide(entry) {
        setRevealed(function (prev) {
          var next = clone(prev)
          delete next[entry.id]
          return next
        })
      }

      function copy(entry) {
        var value = revealed[entry.id]
        var text = value === undefined ? entry.masked : value
        var done = function () { flash('已复制到剪贴板' + (value === undefined ? '（掩码）' : '')) }
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () { flash('复制失败', true) })
            return
          }
        } catch (e) { /* 走兜底 */ }
        flash('当前环境不支持剪贴板', true)
      }

      function saveValue(entry) {
        var draft = editing[entry.id]
        if (draft === undefined || draft === '') return
        setBusy(entry.id)
        post({ action: 'set', id: entry.id, value: draft, reason: '在设置页修改' })
          .then(function (j) {
            flash('已保存' + (j.backup ? '（备份 ' + j.backup + '）' : ''))
            setEditing(function (prev) { var n = clone(prev); delete n[entry.id]; return n })
            hide(entry)
            return load()
          })
          .catch(function (e) { flash('保存失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      function doDelete(entry) {
        if (confirmId !== entry.id) {
          setConfirmId(entry.id)
          if (timers.current.confirm) clearTimeout(timers.current.confirm)
          timers.current.confirm = setTimeout(function () { setConfirmId(null) }, 6000)
          return
        }
        setConfirmId(null)
        setBusy(entry.id)
        post({ action: 'delete', id: entry.id, confirm: true, reason: '在设置页删除' })
          .then(function (j) {
            flash('已删除' + (j.backup ? '（备份 ' + j.backup + '）' : ''))
            if (openId === entry.id) setOpenId(null)
            return load()
          })
          .catch(function (e) { flash('删除失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      /** 删不掉的类型（启动环境变量 / 明文配置）不硬来：移出列表，随时可恢复。 */
      function forget(entry, on) {
        setBusy(entry.id)
        post({ action: on ? 'forget' : 'restore', id: entry.id })
          .then(function () {
            flash(on ? '已移出列表（可随时恢复显示）' : '已恢复显示')
            return load()
          })
          .catch(function (e) { flash('操作失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      /** 解除「已删除」抑制：明确表示这条要重新纳管。 */
      function unsuppress(entry) {
        setBusy(entry.id)
        post({ action: 'unsuppress', id: entry.id })
          .then(function () { flash('已恢复登记'); return load() })
          .catch(function (e) { flash('恢复失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      function promote(entry) {
        setBusy(entry.id)
        post({ action: 'promote', id: entry.id, reason: '在设置页收归仓储' })
          .then(function (j) {
            flash('已写入 credential store：' + j.id + '。原处仍是原样，记得把配置改成引用名（或删掉那一行）')
            return load()
          })
          .catch(function (e) { flash('收归失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      function annotate(entry, patch) {
        setBusy(entry.id)
        post(Object.assign({ action: 'annotate', id: entry.id }, patch))
          .then(function () { return load() })
          .catch(function (e) { flash('保存注记失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      function submitAdd() {
        if (!adding) return
        if (!adding.name || !adding.value) {
          flash('名字和值都要填', true)
          return
        }
        setBusy('add')
        post({ action: 'set', name: adding.name, value: adding.value, reason: '在设置页新增' })
          .then(function (j) {
            if (adding.label) return post({ action: 'annotate', id: j.id, label: adding.label })
            return null
          })
          .then(function () {
            flash('已新增 ' + adding.name + '（下次请求即生效，无需重启）')
            setAdding(null)
            return load()
          })
          .catch(function (e) { flash('新增失败：' + String(e.message || e), true) })
          .then(function () { setBusy('') })
      }

      if (error && !data) {
        return h('div', { className: '__vt_root' },
          h('style', null, CSS),
          h('div', { className: '__vt_err' }, error),
          h('div', { className: '__vt_actions' }, h('button', { className: '__vt_btn', onClick: function () { load() } }, '重试'))
        )
      }

      if (!data) {
        return h('div', { className: '__vt_root' },
          h('style', null, CSS),
          h('div', { className: '__vt_empty' }, '正在读取钥匙簿…')
        )
      }

      var entries = data.entries || []
      var kinds = data.stats.kinds || {}
      var query = q.trim().toLowerCase()

      var hiddenCount = entries.filter(function (e) { return e.hidden }).length

      var filtered = entries.filter(function (e) {
        if (e.hidden && !showHidden) return false
        if (kind !== 'all' && e.kind !== kind) return false
        if (!query) return true
        var hay = [e.id, e.name, e.label, e.note, e.origin, (e.tags || []).join(' ')]
        var usage = e.usage || {}
        ;(usage.plugins || []).forEach(function (p) { hay.push(p.name) })
        ;(usage.skills || []).forEach(function (s) { hay.push(s.name) })
        ;(usage.configs || []).forEach(function (c) { hay.push(c.entryId) })
        return hay.join(' ').toLowerCase().indexOf(query) >= 0
      })

      filtered.sort(function (a, b) {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
        if (sortBy === 'recent') {
          var ta = (a.stats && (a.stats.lastAccessAt || a.stats.lastSessionAt)) || ''
          var tb = (b.stats && (b.stats.lastAccessAt || b.stats.lastSessionAt)) || ''
          if (ta !== tb) return String(tb).localeCompare(String(ta))
        }
        var ka = KIND_ORDER.indexOf(a.kind)
        var kb = KIND_ORDER.indexOf(b.kind)
        if (ka !== kb) return ka - kb
        return String(a.name).localeCompare(String(b.name))
      })

      var kindChips = [['all', '全部 ' + entries.length]].concat(
        KIND_ORDER.filter(function (k) { return kinds[k] }).map(function (k) {
          return [k, (KIND_META[k] ? KIND_META[k].label : k) + ' ' + kinds[k]]
        })
      )

      function renderDetail(entry) {
        var revealedValue = revealed[entry.id]
        var valueShown = revealedValue !== undefined
        var usage = entry.usage || {}
        var meta = entry.meta || {}
        var isEditing = editing[entry.id] !== undefined
        var canReveal = true
        var canEdit = entry.writable === true
        var accessLog = entry.accessLog || []
        var st = entry.stats || {}

        return h('div', { className: '__vt_detail' },
          /* 值 */
          h(Section, { title: '凭据值' },
            h('div', { className: '__vt_valueBox' },
              h('span', { className: '__vt_value' }, valueShown ? revealedValue : (entry.masked || '（空）')),
              h('button', {
                className: '__vt_btn',
                disabled: busy === entry.id,
                onClick: function () { valueShown ? hide(entry) : reveal(entry) },
              }, busy === entry.id ? '读取中…' : valueShown ? '隐藏' : '显示'),
              h('button', { className: '__vt_btn __vt_btnGhost', onClick: function () { copy(entry) } }, '复制'),
              valueShown ? h('span', { className: '__vt_hint' }, Array.from(String(revealedValue)).length + ' 字符 · 60 秒后自动隐藏') : null
            ),
            entry.kind === 'record'
              ? h('div', { className: '__vt_hint' }, '授权记录由它的宿主插件（' + (meta.scope || '?') + '）解释，保险库只负责查看与删除。')
              : null,
            entry.tombstoned
              ? h('div', { className: '__vt_warn' },
                '这条凭据你删过一次' + (entry.deletedAt ? '（' + fmtTime(entry.deletedAt) + '）' : '') +
                '。即使它的来源（文件/配置）又出现，插件也不会自动把它当活跃凭据。',
                h('div', { style: { marginTop: '6px' } },
                  h('button', {
                    className: '__vt_btn __vt_btnGhost',
                    disabled: busy === entry.id,
                    onClick: function () { unsuppress(entry) },
                  }, '恢复登记'))
              )
              : null,
            entry.kind === 'config'
              ? h('div', { className: '__vt_warn' }, '值明文写在配置文件里 —— 建议「收归仓储」，再把配置改成引用名。')
              : null,
            entry.kind === 'env' || entry.kind === 'envfile'
              ? h('div', { className: '__vt_hint' }, entry.kind === 'env'
                ? '来自启动时的环境变量快照，本插件不改写它；需要长期管理请「收归仓储」。'
                : '来自 .env 文件，属于启动环境；需要长期管理请「收归仓储」。')
              : null,
            isEditing
              ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '4px' } },
                h('textarea', {
                  className: '__vt_input __vt_inputMono __vt_textarea',
                  value: editing[entry.id],
                  spellCheck: false,
                  onChange: function (ev) {
                    var v = ev.target.value
                    setEditing(function (prev) { var n = clone(prev); n[entry.id] = v; return n })
                  },
                }),
                h('div', { className: '__vt_actions' },
                  h('button', { className: '__vt_btn __vt_btnPrimary', disabled: busy === entry.id, onClick: function () { saveValue(entry) } }, '保存新值'),
                  h('button', {
                    className: '__vt_btn',
                    onClick: function () { setEditing(function (prev) { var n = clone(prev); delete n[entry.id]; return n }) },
                  }, '取消'),
                  h('span', { className: '__vt_hint' }, canEdit ? '写回原处；文件型会在旁边留 .bak 备份。' : '')
                )
              )
              : h('div', { className: '__vt_actions' },
                canEdit
                  ? h('button', {
                    className: '__vt_btn',
                    onClick: function () { startEdit(entry) },
                  }, '修改')
                  : null,
                entry.promotable
                  ? h('button', { className: '__vt_btn', disabled: busy === entry.id, onClick: function () { promote(entry) } }, '收归仓储')
                  : null,
                entry.deletable
                  ? h('button', {
                    className: '__vt_btn __vt_btnDanger',
                    disabled: busy === entry.id,
                    onClick: function () { doDelete(entry) },
                  }, confirmId === entry.id ? '确认删除？' : '删除')
                  : h('span', { className: '__vt_hint' }, deleteReason(entry)),
                h('button', {
                  className: '__vt_btn __vt_btnGhost',
                  disabled: busy === entry.id,
                  onClick: function () { forget(entry, !entry.hidden) },
                }, entry.hidden ? '恢复显示' : '移出列表')
              )
          ),

          /* 元信息 */
          h(Section, { title: '来源' },
            h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '类型'), h('span', { className: '__vt_v' }, (KIND_META[entry.kind] || {}).label + ' · ' + entry.source)),
            h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '位置'), h('span', { className: '__vt_v' }, entry.origin)),
            meta.file && meta.file !== entry.origin
              ? h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '文件'), h('span', { className: '__vt_v' }, meta.file))
              : null,
            meta.pointer
              ? h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '字段'), h('span', { className: '__vt_v' }, meta.keyPath || meta.pointer))
              : null,
            meta.bytes
              ? h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '大小'), h('span', { className: '__vt_v' }, fmtBytes(meta.bytes)))
              : null,
            meta.subtype
              ? h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '子类'), h('span', { className: '__vt_v' }, meta.subtype))
              : null,
            entry.risk && entry.risk.indexOf('plaintext-in-config') >= 0
              ? h('div', { className: '__vt_warn' }, '明文写在配置文件里属于泄漏风险')
              : null
          ),

          /* 使用方 */
          h(Section, { title: '谁在用它' },
            (usage.configs || []).length > 0
              ? h('div', { className: '__vt_grid' }, usage.configs.map(function (c, i) {
                return h('div', { className: '__vt_item', key: 'c' + i },
                  h('div', { className: '__vt_itemName' }, '配置 · ' + (c.entryId || '未知条目')),
                  h('div', { className: '__vt_ev' }, c.file + (c.line ? ':' + c.line : ''))
                )
              }))
              : null,
            (usage.plugins || []).length > 0
              ? h('div', null,
                h('div', { className: '__vt_hint', style: { marginBottom: '5px' } }, '插件包（在包内找到该标识）'),
                h(UsageGroup, { items: usage.plugins })
              )
              : null,
            (usage.skills || []).length > 0
              ? h('div', null,
                h('div', { className: '__vt_hint', style: { marginBottom: '5px' } }, '技能'),
                h(UsageGroup, { items: usage.skills })
              )
              : null,
            (usage.sessions || []).length > 0
              ? h('div', null,
                h('div', { className: '__vt_hint', style: { marginBottom: '5px' } }, '用过的会话'),
                h('div', { className: '__vt_table' },
                  h('div', { className: '__vt_thead' },
                    h('span', null, '会话'),
                    h('span', { className: '__vt_tnum' }, '最近'),
                    h('span', { className: '__vt_tnum' }, '次数')
                  ),
                  usage.sessions.slice(0, 8).map(function (s, i) {
                    var label = s.title && String(s.title).trim() ? String(s.title).trim() : '未命名会话'
                    return h('div', { className: '__vt_trow', key: 's' + i, title: s.id },
                      h('span', { className: '__vt_tname' }, label),
                      h('span', { className: '__vt_tnum' }, s.at ? ago(s.at) : '—'),
                      h('span', { className: '__vt_tnum' }, (s.hits || 0))
                    )
                  })
                ),
                usage.sessions.length > 8
                  ? h('div', { className: '__vt_hint', style: { marginTop: '4px' } }, '另有 ' + (usage.sessions.length - 8) + ' 个会话也用过')
                  : null
              )
              : null,
            (usage.configs || []).length + (usage.plugins || []).length + (usage.skills || []).length + (usage.sessions || []).length === 0
              ? h('div', { className: '__vt_hint' }, '没有扫描到引用痕迹。索引过期的话点上面的「重建索引」。')
              : null
          ),

          /* 使用统计 */
          h(Section, { title: '使用统计' },
            h('div', { className: '__vt_grid' },
              h(MiniStat, { label: '取用次数', value: st.accessCount, sub: st.accessCount > 0 ? '经保险库' : '还没有经手记录' }),
              h(MiniStat, { label: '最近一次取用', value: st.lastAccessAt ? ago(st.lastAccessAt) : '—', sub: st.lastAccessAt ? fmtTime(st.lastAccessAt) : '' }),
              h(MiniStat, {
                label: '平均频率',
                value: fmtAvg(st.avgIntervalDays !== null && st.avgIntervalDays !== undefined ? st.avgIntervalDays : st.avgSessionIntervalDays),
                sub: st.accessCount >= 2 ? '按取用间隔' : (st.avgSessionIntervalDays !== null && st.avgSessionIntervalDays !== undefined ? '按会话引用间隔' : '需 2 次以上记录'),
              }),
              h(MiniStat, { label: '近 7 天', value: st.last7 + ' 次' }),
              h(MiniStat, { label: '近 30 天', value: st.last30 + ' 次' }),
              h(MiniStat, { label: '会话引用', value: st.sessionCount + (st.sessionTruncated ? '+' : ''), sub: st.lastSessionAt ? '最近 ' + ago(st.lastSessionAt) : '扫描不到引用' })
            ),
            h('div', { className: '__vt_hint' },
              '「取用」= 经本保险库的真实调用（有审计）；「会话引用」= 会话记录里出现过该标识（只是痕迹，不等于调用）。两者分开看。')
          ),

          /* 注记 */
          h(Section, { title: '注记' },
            h('div', { className: '__vt_kv' }, h('span', { className: '__vt_k' }, '显示名')),
            h('input', {
              className: '__vt_input',
              value: entry.label || '',
              placeholder: '给这条凭据起个人话名字',
              onChange: function (ev) {
                var v = ev.target.value
                setData(function (prev) {
                  var next = clone(prev)
                  next.entries = next.entries.map(function (x) { return x.id === entry.id ? Object.assign({}, x, { label: v }) : x })
                  return next
                })
              },
              onBlur: function (ev) { annotate(entry, { label: ev.target.value }) },
            }),
            h('input', {
              className: '__vt_input',
              style: { marginTop: '6px' },
              value: (entry.tags || []).join(', '),
              placeholder: '标签，逗号分隔（如 llm, 生图, 微信）',
              onChange: function (ev) {
                var tags = ev.target.value.split(',').map(function (s) { return s.trim() }).filter(Boolean)
                setData(function (prev) {
                  var next = clone(prev)
                  next.entries = next.entries.map(function (x) { return x.id === entry.id ? Object.assign({}, x, { tags: tags }) : x })
                  return next
                })
              },
              onBlur: function (ev) {
                var tags = ev.target.value.split(',').map(function (s) { return s.trim() }).filter(Boolean)
                annotate(entry, { tags: tags })
              },
            }),
            h('textarea', {
              className: '__vt_input __vt_textarea',
              style: { marginTop: '6px' },
              value: entry.note || '',
              placeholder: '备注：这把钥匙用来做什么、什么时候换过',
              onChange: function (ev) {
                var v = ev.target.value
                setData(function (prev) {
                  var next = clone(prev)
                  next.entries = next.entries.map(function (x) { return x.id === entry.id ? Object.assign({}, x, { note: v }) : x })
                  return next
                })
              },
              onBlur: function (ev) { annotate(entry, { note: ev.target.value }) },
            }),
            h('div', { className: '__vt_actions', style: { marginTop: '4px' } },
              h('button', { className: '__vt_btn __vt_btnGhost', onClick: function () { annotate(entry, { pinned: !entry.pinned }) } },
                entry.pinned ? '取消置顶' : '置顶')
            )
          )
        )
      }

      var rows = filtered.map(function (entry) {
        var meta = KIND_META[entry.kind] || { label: entry.kind, color: 'var(--dsw-alias-label-tertiary)' }
        var usage = entry.usage || {}
        var open = openId === entry.id
        var chips = []
        if ((usage.configs || []).length > 0) chips.push(['配置 ' + usage.configs.length])
        if ((usage.plugins || []).length > 0) chips.push(['插件 ' + usage.plugins.length])
        if ((usage.skills || []).length > 0) chips.push(['技能 ' + usage.skills.length])
        if ((usage.sessions || []).length > 0) chips.push(['会话 ' + usage.sessions.length])
        if (entry.access && entry.access.count > 0) chips.push(['访问 ' + entry.access.count])

        return h('div', { className: '__vt_row' + (open ? ' __vt_rowOpen' : ''), key: entry.id },
          h('div', {
            className: '__vt_rowHead',
            onClick: function () { setOpenId(open ? null : entry.id) },
          },
            h('span', { className: '__vt_dot', style: { background: meta.color } }),
            h('div', { className: '__vt_rowMain' },
              h('div', { className: '__vt_rowTop' },
                entry.pinned ? h('span', { title: '已置顶', style: { fontSize: '11px' } }, '★') : null,
                entry.tombstoned ? h(Pill, { tone: 'danger' }, '已删除过') : entry.hidden ? h(Pill, { tone: 'warn' }, '已移出') : null,
                h('span', { className: '__vt_name' }, entry.name),
                h(Pill, null, meta.label),
                entry.configured ? null : h(Pill, { tone: 'warn' }, '未配置'),
                (entry.risk && entry.risk.length > 0) ? h(Pill, { tone: 'danger' }, '明文风险') : null,
                (entry.tags || []).map(function (t, i) { return h(Pill, { key: 't' + i }, t) })
              ),
              h('div', { className: '__vt_rowTop' },
                entry.label && entry.label !== entry.name ? h('span', { className: '__vt_label' }, entry.label) : null,
                h('span', { className: '__vt_masked' }, entry.masked || '（空）'),
                h('span', { className: '__vt_hint' }, entry.origin)
              ),
              statsLine(entry) ? h('div', { className: '__vt_metaline' }, statsLine(entry)) : null,
              chips.length > 0
                ? h('div', { className: '__vt_usage' }, chips.map(function (c, i) {
                  return h('span', { className: '__vt_pill', key: 'u' + i }, c[0])
                }))
                : null
            ),
            h('div', { className: '__vt_rowRight' },
              entry.writable ? h('span', { className: '__vt_hint', title: '可写' }, '可改') : null,
              h('span', { className: '__vt_hint', style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s' } }, '▶')
            )
          ),
          open ? renderDetail(entry) : null
        )
      })

      return h('div', { className: '__vt_root' },
        h('style', null, CSS),

        h('div', { className: '__vt_head' },
          h('div', { className: '__vt_titleRow' },
            h('div', { className: '__vt_title' }, '钥匙簿'),
            h('div', { className: '__vt_ver' }, 'v' + (data.version || '0.0.0')),
            h('div', { style: { flex: 1 } }),
            h('button', { className: '__vt_btn __vt_btnPrimary', disabled: busy === 'scan', onClick: runScan },
              scanning || busy === 'scan' ? '扫描中…' : '重建引用索引'),
            h('button', { className: '__vt_btn', onClick: function () { setAdding({ name: '', value: '', label: '' }) } }, '新增凭据')
          ),
          h('div', { className: '__vt_toolbar' },
            h('input', {
              ref: searchRef,
              className: '__vt_search',
              value: q,
              placeholder: '搜索：名字 / 标签 / 插件 / 技能 / 路径…',
              onChange: function (ev) { setQ(ev.target.value) },
            })
          ),
          h('div', { className: '__vt_chips' },
            h('button', {
              className: '__vt_chip' + (sortBy === 'recent' ? ' __vt_chipOn' : ''),
              onClick: function () { setSortBy(sortBy === 'recent' ? 'default' : 'recent') },
              title: '按最近使用时间排序',
            }, '最近使用优先'),
            hiddenCount > 0
              ? h('button', {
                className: '__vt_chip' + (showHidden ? ' __vt_chipOn' : ''),
                onClick: function () { setShowHidden(!showHidden) },
              }, (showHidden ? '隐藏已移出的 ' : '显示已移出的 ') + hiddenCount + ' 条')
              : null
          ),
          h('div', { className: '__vt_chips' }, kindChips.map(function (c) {
            return h('button', {
              key: c[0],
              className: '__vt_chip' + (kind === c[0] ? ' __vt_chipOn' : ''),
              onClick: function () { setKind(c[0]) },
            }, c[1])
          }))
        ),

        data.persistence && data.persistence.ephemeral
          ? h('div', { className: '__vt_err' },
            '⚠️ 持久化风险：' + data.persistence.note +
            (data.persistence.stateFile ? h('div', { className: '__vt_hint', style: { marginTop: '4px' } }, '当前登记文件：' + data.persistence.stateFile) : null))
          : null,

        notice
          ? h('div', { className: notice.err ? '__vt_err' : '__vt_ok' }, notice.text)
          : null,

        adding
          ? h('div', { className: '__vt_addForm' },
            h('div', { className: '__vt_secTitle' }, '新增凭据（写进 credential store，马上可用）'),
            h('div', { className: '__vt_grid' },
              h('input', {
                className: '__vt_input __vt_inputMono',
                placeholder: '名字，如 MY_API_KEY（POSIX 标识符）',
                value: adding.name,
                onChange: function (ev) { setAdding(Object.assign({}, adding, { name: ev.target.value })) },
              }),
              h('input', {
                className: '__vt_input',
                placeholder: '显示名（可选）',
                value: adding.label,
                onChange: function (ev) { setAdding(Object.assign({}, adding, { label: ev.target.value })) },
              })
            ),
            h('textarea', {
              className: '__vt_input __vt_inputMono __vt_textarea',
              placeholder: '值（只写到宿主侧，不回显）',
              value: adding.value,
              spellCheck: false,
              onChange: function (ev) { setAdding(Object.assign({}, adding, { value: ev.target.value })) },
            }),
            h('div', { className: '__vt_actions' },
              h('button', { className: '__vt_btn __vt_btnPrimary', disabled: busy === 'add', onClick: submitAdd }, busy === 'add' ? '保存中…' : '保存'),
              h('button', { className: '__vt_btn', onClick: function () { setAdding(null) } }, '取消')
            )
          )
          : null,

        h('div', { className: '__vt_list' },
          rows.length > 0
            ? rows
            : h('div', { className: '__vt_empty' }, entries.length === 0
              ? '还没有发现任何凭据。'
              : '没有匹配“' + q + '”的条目。')
        )
      )
    }

    /* ── 插件 ─────────────────────────────────────────────────────────── */
    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({ name: 'settings.section', id: 'key-ledger', order: 27, label: '钥匙簿' }, function () {
          return h(Panel, {})
        })
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
