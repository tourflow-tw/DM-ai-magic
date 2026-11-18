# DM-ai-magic｜旅行社 DM 字圖編輯室（PWA）

純前端圖片編輯器，可以修改旅遊 DM 上的價格，嘗試移除 `(net)` 並重新排版 `NT`，輸出 PNG。圖片只在裝置上的瀏覽器處理，不需要 API 金鑰。

## GitHub Pages 部署

1. 這份程式已放在 `tourflow-tw/DM-ai-magic` 的 `main` 分支根目錄。
2. 到儲存庫的 **Settings → Pages → Build and deployment**。
3. **Source** 選擇 `Deploy from a branch`，**Branch** 選 `main` 與 `/(root)`，然後儲存。
4. 網站網址預期為 `https://tourflow-tw.github.io/DM-ai-magic/`，等 GitHub Pages 發布完成再開啟。

所有檔案都使用相對路徑，因此可以放在 GitHub Pages 的儲存庫子路徑中。GitHub Pages 網站本身是公開的，請不要把 API 金鑰、客戶資料或其他機密檔案放進儲存庫。

## 手機安裝

- **Android Chrome / Samsung Internet**：開啟網站，從選單選「安裝應用程式」或「加到主畫面」。
- **iPhone Safari**：開啟網站，點選分享後選「加入主畫面」。

首次需連線載入程式。完成載入後，改價、上傳本機圖片與匯出 PNG 可以離線使用；整張圖片的實驗性 OCR 需下載外部辨識引擎，離線時可能無法使用。

**請在關閉網頁前先下載成品：**目前沒有把編輯中的圖片自動儲存在雲端或重新開啟後還原的功能。
