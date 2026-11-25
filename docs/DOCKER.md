# Docker 部署下的持久化

结论：**会持久化**，前提是下面两个 bind mount 保留。插件启动时会自检，若数据落在容器临时层，设置页顶部会直接报警。

## 数据落在哪

| 数据 | 容器内路径 | 宿主机路径（本机实测） | 丢了会怎样 |
|---|---|---|---|
| 凭据真值（refs / records） | `/root/.dsh/.credentials.yaml` | `dsh-data` 卷 | 所有密钥消失，需要重新填 |
| 保险库登记（注记/标签/访问日志/墓碑/索引） | `/root/.dsh/vault/state.json` | `dsh-data` 卷 | 备注、删除记录、使用统计丢失；凭据本身还在 |
| 删除前自动备份 | `/root/.dsh/*.bak-*`（跟随原文件） | 跟随所在卷 | 无法回滚删除 |
| 插件源码 | `/root/Desktop/dsh-key-ledger` | `dsh-workspace` 卷 | profile 里 `link:/root/Desktop/dsh-key-ledger` 悬空，插件加载失败 |
| profile 注册（依赖 + bundles + patch） | `/root/.dsh/profiles/web/` | `dsh-data` 卷 | 插件不会被装配 |

本机实测的挂载（`findmnt -T`）：

```
/               overlay
/root/.dsh      /dev/mapper/ug_...-volume1[/docker/dsh/dsh-data]      ext4
/root/Desktop   /dev/mapper/ug_...-volume1[/docker/dsh/dsh-workspace] ext4
```

根分区是 overlay（临时），`~/.dsh` 与 `~/Desktop` 是宿主机 ext4 卷——所以重建镜像、升级 DSH 版本都不会丢，只要 `docker run` 的 `-v` 参数不变。

## 自检

插件 Host 半侧启动时比较 `/` 与 `DSH_HOME` 的设备号：

- 容器内 + 同一设备 → 判定 `ephemeral`，设置页顶部红字报警，提示挂载方式；
- 容器内 + 不同设备 → 页脚显示「已挂载卷（重建不丢）」；
- 非容器 → 「本地磁盘」。

## 备份

在**宿主机**上执行（不要进容器备份到临时层）：

```bash
# 凭据 + 保险库登记 + profile 注册（含插件）
docker cp <容器>:/root/.dsh/.credentials.yaml  ./backup/.credentials.yaml
docker cp <容器>:/root/.dsh/vault              ./backup/vault
docker cp <容器>:/root/.dsh/profiles/web       ./backup/profile-web

# 直接备份宿主机卷更省事（路径以实际为准）
sudo tar czf dsh-data-$(date +%F).tgz -C /docker/dsh dsh-data
sudo tar czf dsh-workspace-$(date +%F).tgz -C /docker/dsh dsh-workspace
```

凭据文件是 `0600`，备份包也请按秘密对待。

## 升级镜像后的检查清单

1. 确认 `-v ...:/root/.dsh` 与 `-v ...:/root/Desktop` 两个挂载还在；
2. 打开 **设置 → 钥匙簿**：
   - 顶部没有红色持久化警告；
   - 条目数量与升级前一致（当前 14 条）；
3. 跑一次 `vault { action: "scan" }` 重建引用索引（插件版本可能变化）；
4. 如果 DSH 大版本升级后插件没加载：检查 `/root/Desktop/dsh-key-ledger` 是否存在、profile 的 `package.json` 里 `link:` 依赖是否还在。

## 已知风险

- **只删容器不删卷**：安全，重建后数据仍在。
- **删了卷 / 换了挂载路径**：数据一起没，只能从上面的备份恢复。
- **工作区卷被重置**：插件源码消失 → profile 里 `link:` 悬空。恢复方式二选一：
  1. 把 `dsh-key-ledger` 目录放回 `/root/Desktop/dsh-key-ledger`；
  2. 或从 profile 的 `dependencies` 与 `dsh.profile.bundles` 里移除该条目。
- **DSH 跨大版本升级**：本插件只依赖 node 内建模块与 `webServer`/`connection`/`tools`/`systemPrompt`/`credentials` 这几个公开服务，风险较低；但 client 端 slot 名若变化，设置页会不显示（数据不受影响）。
