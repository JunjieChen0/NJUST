# NJUST_AI

> [NJUST_AI](https://github.com/JunjieChen0/NJUST) 是面向倉頡開發的 AI 程式設計助手 VS Code 擴充功能，由 NJUST_AI 團隊維護。

> **Attribution**：本專案以 [Roo Code](https://github.com/RooVetGit/Roo-Code)（Apache-2.0）為基礎，由 NJUST_AI 團隊修改與擴充。

## 專案概覽

擴充功能透過 Webview 與 Extension Host 提供對話、程式碼閱讀與修改、工具審批、命令執行及語意搜尋。倉頡工具鏈包含語法、LSP、`cjpm`、格式化、靜態檢查、測試與除錯整合。

目前的開發與排障入口見[文件導覽](../../docs/README.md)，實作概覽見[根 README](../../README.md)。舊評審與覆蓋率快照只代表記錄時的狀態。

## 主要能力

- **模式**：Cloud Agent、Architect、Code、Ask、Debug、Cangjie Dev 與 Orchestrator，可透過自訂模式調整。
- **倉頡開發**：識別工程與 SDK、讀取上下文、依審批修改程式碼，再進行系統建置與相關測試；只檢查任務不會進入寫入修復流程。
- **可核對的交付**：模型宣告完成、建置結果、實際測試和使用者驗收分開記錄。程式碼或 SDK 變更後，舊驗證結果會標為過期。
- **模型接入**：支援多個服務商與 OpenAI Compatible 端點，依連線設定取得或快取模型目錄；目錄不可用不等於模型不存在。
- **Cloud Agent / MCP**：連接自建遠端推理與工具服務；REST 延期協定與 MCP 模式的執行邊界見 [AGENTS.md](../../AGENTS.md)。
- **記憶與 Skills**：保留任務驗證事實，按任務更新經驗；未知狀態或沒有驗證欄位的舊經驗不參與檢索及提煉。語言參考透過 Skills 按需載入。
- **存檔與差異**：以影子 Git 保存檢查點。`.vscode-test/` 測試快取不進入快照；其他真實巢狀 Git 儲存庫仍會觸發保護。

## 本機開發

- Node.js `>=20.19.2 <25`，CI 預設 `20.19.2`。
- pnpm `10.8.1`，以根 `package.json` 的 `packageManager` 為準。

```sh
git clone https://github.com/JunjieChen0/NJUST.git
cd NJUST
pnpm install
```

用 VS Code 開啟儲存庫，按 `F5` 啟動擴充功能開發視窗。

## 建置與安裝

```sh
pnpm vsix
# Nightly 變體，擴充功能 ID 與命令前綴不同
pnpm vsix:nightly
```

產物位於 `bin/`；將占位版本替換為實際檔名後安裝：

```sh
code --install-extension bin/njust-ai-<version>.vsix
```

`pnpm install:vsix` 會重新安裝相依套件、清理建置目錄、重新打包並執行安裝腳本。只想安裝既有套件時，使用上面的安裝命令。

安裝後執行 `Developer: Reload Window`。測試命令、覆蓋率、E2E 與真實 VSIX 冒煙見[測試指南](../../docs/development/testing.md)。存檔被停用時，先查看[存檔排障](../../docs/runbooks/007-checkpoints-disabled.md)，不要直接刪除任務、檢查點或巢狀儲存庫。

## 回報問題與貢獻

請在本儲存庫的 [GitHub Issues](https://github.com/JunjieChen0/NJUST/issues) 提供版本、重現步驟、預期結果與已脫敏的日誌。開發流程見[貢獻指南](CONTRIBUTING.md)。

## 免責聲明

**請注意**，NJUST_AI, Inc. **不**對與 NJUST_AI 相關的任何程式碼、模型或其他工具、任何相關的第三方工具或任何由此產生的輸出作出任何陳述或保證。您承擔使用任何此類工具或輸出的**所有風險**；此類工具均按**「原樣」**和**「可用」**的基礎提供。此類風險可能包括但不限於智慧財產權侵權、網路漏洞或攻擊、偏見、不準確、錯誤、缺陷、病毒、停機、財產損失或損害和/或人身傷害。您對自己使用任何此類工具或輸出負全部責任（包括但不限於其合法性、適當性和結果）。

---

## 授權

[Apache 2.0 © 2025 NJUST_AI, Inc.](../../LICENSE)
