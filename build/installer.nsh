; Recto's setup screen adds the right-click entries and the desktop shortcut when you ask for them.
; Uninstalling takes them away again, but an update leaves them be.

; Word and PDF files get Recto in their "Open with" list, but Recto never becomes their default app.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\Recto.Read" "" "Document (Recto)"
  WriteRegStr HKCU "Software\Classes\Recto.Read\DefaultIcon" "" "$INSTDIR\${APP_EXECUTABLE_FILENAME},0"
  WriteRegStr HKCU "Software\Classes\Recto.Read\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr HKCU "Software\Classes\.docx\OpenWithProgids" "Recto.Read" ""
  WriteRegStr HKCU "Software\Classes\.pdf\OpenWithProgids" "Recto.Read" ""
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\*\shell\Recto"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\Recto"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Recto"
    DeleteRegKey HKCU "Software\Classes\Recto.Read"
    DeleteRegValue HKCU "Software\Classes\.docx\OpenWithProgids" "Recto.Read"
    DeleteRegValue HKCU "Software\Classes\.pdf\OpenWithProgids" "Recto.Read"
    Delete "$DESKTOP\Recto.lnk"
  ${endIf}
!macroend
