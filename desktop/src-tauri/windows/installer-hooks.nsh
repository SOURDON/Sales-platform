; WebView2 GUID (Evergreen runtime) — тот же, что в NSIS-шаблоне Tauri.
!define WEBVIEW2_REG_GUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_BOOTSTRAPPER_URL "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

!macro ReadWebView2Version OUT_VAR
  ClearErrors
  ReadRegStr ${OUT_VAR} HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_REG_GUID}" "pv"
  IfErrors 0 +4
    ClearErrors
    ReadRegStr ${OUT_VAR} HKCU "Software\Microsoft\EdgeUpdate\Clients\${WEBVIEW2_REG_GUID}" "pv"
    IfErrors 0 +2
      StrCpy ${OUT_VAR} ""
!macroend

; После установки: ярлыки, имя в «Программы и компоненты», опционально WebView2 (без /silent).
; Папка установки и exe остаются латиницей (Fotografy) — так стабильнее на Windows CI.
!macro NSIS_HOOK_POSTINSTALL
  StrCpy $R9 "Фотографы"
  IfFileExists "$SMPROGRAMS\$AppStartMenuFolder\Fotografy.lnk" 0 +2
    Rename "$SMPROGRAMS\$AppStartMenuFolder\Fotografy.lnk" "$SMPROGRAMS\$AppStartMenuFolder\$R9.lnk"
  IfFileExists "$SMPROGRAMS\Fotografy.lnk" 0 +2
    Rename "$SMPROGRAMS\Fotografy.lnk" "$SMPROGRAMS\$R9.lnk"
  IfFileExists "$DESKTOP\Fotografy.lnk" 0 +2
    Rename "$DESKTOP\Fotografy.lnk" "$DESKTOP\$R9.lnk"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "$R9"

  !insertmacro ReadWebView2Version $R8
  StrCmp $R8 "" 0 webview2_done
    MessageBox MB_ICONQUESTION|MB_YESNO|MB_DEFBUTTON1 \
      "Для работы «Фотографы» нужен компонент Microsoft WebView2 (обычно уже есть в Windows 10/11).$\r$\n$\r$\nУстановить WebView2 сейчас? (откроется окно установщика Microsoft)" \
      IDNO webview2_hint
    Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    DetailPrint "Загрузка WebView2..."
    NSISdl::download "${WEBVIEW2_BOOTSTRAPPER_URL}" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
    Pop $R7
    StrCmp $R7 "success" 0 webview2_download_fail
    DetailPrint "Установка WebView2 (с окном Microsoft)..."
    ; Без /silent — иначе установка часто падает без прав администратора.
    ExecWait '"$TEMP\MicrosoftEdgeWebview2Setup.exe"' $R7
    Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
  !insertmacro ReadWebView2Version $R8
  StrCmp $R8 "" webview2_hint webview2_done
  webview2_download_fail:
    MessageBox MB_ICONEXCLAMATION|MB_OK \
      "Не удалось загрузить WebView2. «Фотографы» установлены — скачайте WebView2 вручную:$\r$\nhttps://developer.microsoft.com/microsoft-edge/webview2/"
    Goto webview2_done
  webview2_hint:
    MessageBox MB_ICONINFORMATION|MB_OK \
      "«Фотографы» установлены.$\r$\n$\r$\nЕсли приложение не запускается — установите WebView2:$\r$\nhttps://developer.microsoft.com/microsoft-edge/webview2/"
  webview2_done:
!macroend
