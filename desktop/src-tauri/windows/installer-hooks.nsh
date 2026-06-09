; После установки: ярлыки и имя в «Программы и компоненты» по-русски.
; WebView2 встроен в установщик (offlineInstaller в tauri.conf.json).
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
!macroend
