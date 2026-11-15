; Recto's setup screen adds the right-click entries and the desktop shortcut when you ask for them.
; Uninstalling takes them away again, but an update leaves them be.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\*\shell\Recto"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\Recto"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\Recto"
    Delete "$DESKTOP\Recto.lnk"
  ${endIf}
!macroend
