; File ownership is compiled into the installer, never read from player-editable state.
; No recursive removal, shell commands, or calls to a previous uninstaller.
!include "LogicLib.nsh"

; electron-builder prepends nsis.include files before installer.nsi includes
; common.nsh. Therefore APP_EXECUTABLE_FILENAME and UNINSTALL_FILENAME are
; not defined yet at this point. PRODUCT_FILENAME and BUILD_RESOURCES_DIR are
; command-line defines and are safe to use from this early include.
!ifndef PRODUCT_FILENAME
  !error "PRODUCT_FILENAME must be defined before preserve-files.nsh is included."
!endif
!ifndef BUILD_RESOURCES_DIR
  !error "BUILD_RESOURCES_DIR must be defined before preserve-files.nsh is included."
!endif
Var coaHandle
Var coaLine
Var coaRelative
Var coaExpected
Var coaActual
Var coaCheck
Var coaParent
Var coaAttributes
Var coaSafe
Var coaBackup
Var coaDestination
Var coaHash
Var coaRemoved
Var coaInitialInstDir
Var coaFailure
Var coaPreviousOutDir

; Expanded only after common.nsh. Never kill processes by directory prefix:
; that can include the uninstaller or an unrelated nested client.
!ifmacrondef coaFindLauncherProcess
!macro coaFindLauncherProcess
  nsProcess::_FindProcess "${PRODUCT_FILENAME}.exe"
  Pop $R0
!macroend
!endif

!macro customCheckAppRunning
  coaCheckLauncherAgain:
  !insertmacro coaFindLauncherProcess
  !ifdef isUpdated
    ${If} ${isUpdated}
      ; The updater starts NSIS while its own process is winding down.
      ; Allow up to 30 seconds for all Electron processes to exit normally.
      StrCpy $R1 0
      ${DoWhile} $R0 == 0
        Sleep 250
        !insertmacro coaFindLauncherProcess
        IntOp $R1 $R1 + 1
        ${If} $R1 >= 120
          ${Break}
        ${EndIf}
      ${Loop}
    ${EndIf}
  !endif
  ${If} $R0 == 0
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "CoA Custom Races launcher is still closing or running. Wait a moment, then click Retry. If it remains open, close the launcher first. No files have been removed." /SD IDCANCEL IDRETRY coaCheckLauncherAgain
    SetErrorLevel 2
    Quit
  ${ElseIf} $R0 != 603
    MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Windows could not check whether CoA Custom Races launcher is closed (process check code: $R0). Click Retry to check again, or Cancel and restart Windows before trying again. No files have been removed." /SD IDCANCEL IDRETRY coaCheckLauncherAgain
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro coaFunctions PREFIX
Function ${PREFIX}coaTrimLine
  coaTrimAgain:
    StrCpy $coaCheck $coaLine 1 -1
    StrCmp $coaCheck "$\r" coaTrimLast
    StrCmp $coaCheck "$\n" coaTrimLast coaTrimDone
  coaTrimLast:
    StrCpy $coaLine $coaLine -1
    Goto coaTrimAgain
  coaTrimDone:
FunctionEnd

Function ${PREFIX}coaCheckPath
  StrCpy $coaSafe "1"
  StrCpy $coaCheck "$INSTDIR\$coaRelative"
  coaCheckAgain:
    System::Call 'kernel32::GetFileAttributesW(w "$coaCheck") i .r0'
    StrCpy $coaAttributes $0
    ${If} $coaAttributes != -1
      IntOp $coaAttributes $coaAttributes & 0x400
      ${If} $coaAttributes != 0
        StrCpy $coaSafe "0"
        Return
      ${EndIf}
    ${EndIf}
    ${StdUtils.GetParentPath} $coaParent "$coaCheck"
    StrCmp $coaParent "" coaCheckDone
    StrCmp $coaParent $coaCheck coaCheckDone
    StrCpy $coaCheck $coaParent
    Goto coaCheckAgain
  coaCheckDone:
FunctionEnd

!if "${PREFIX}" == "un."
Function ${PREFIX}coaCheckDeleteAccess
  ; DELETE access with all sharing flags tests locks/ACLs without deleting.
  ; The actual Delete below still checks failure in case a lock appears later.
  IfFileExists "$INSTDIR\$coaRelative" 0 coaDeleteAccessDone
  System::Call 'kernel32::CreateFileW(w "$INSTDIR\$coaRelative", i 0x10000, i 7, p 0, i 3, i 0x200000, p 0) p.r0'
  ${If} $0 == -1
    StrCpy $coaSafe "0"
  ${Else}
    System::Call 'kernel32::CloseHandle(p r0)'
  ${EndIf}
  coaDeleteAccessDone:
FunctionEnd
!endif
!macroend

!macro coaPrepareUpgrade
  StrCpy $coaHandle ""
  StrCpy $coaBackup ""
  StrCpy $coaPreviousOutDir "$OUTDIR"
  StrCpy $coaFailure "Could not initialize the installer's temporary directory. TEMP: $TEMP"
  ClearErrors
  InitPluginsDir
  IfErrors coaPreserveFailed
  StrCpy $coaFailure "Could not open the installer's temporary directory: $PLUGINSDIR"
  ClearErrors
  SetOutPath "$PLUGINSDIR"
  IfErrors coaPreserveFailed
  StrCpy $coaFailure "Could not extract the embedded ownership manifest to: $PLUGINSDIR\coa-owned.txt"
  ClearErrors
  File /oname=coa-owned.txt "${BUILD_RESOURCES_DIR}\coa-owned.txt"
  IfErrors coaPreserveFailed
  StrCpy $coaFailure "Could not open the embedded ownership manifest: $PLUGINSDIR\coa-owned.txt"
  ClearErrors
  FileOpen $coaHandle "$PLUGINSDIR\coa-owned.txt" r
  IfErrors coaPreserveFailed
  ClearErrors
  FileSeek $coaHandle 2 SET
  StrCpy $coaFailure "Could not seek in the embedded ownership manifest: $PLUGINSDIR\coa-owned.txt"
  IfErrors coaPreserveFailed
  coaPreserveNext:
    ClearErrors
    FileReadUTF16LE $coaHandle $coaLine
    IfErrors coaPreserveDone
    Call coaTrimLine
    StrCpy $coaExpected $coaLine 64
    StrCpy $coaRelative $coaLine "" 65
    Call coaCheckPath
    StrCpy $coaFailure "The selected installation path passes through a linked/reparse path: $coaCheck. Choose a direct writable folder. Under Wine, use a mapped drive without symlinked parent folders."
    StrCmp $coaSafe "1" 0 coaPreserveFailed
    IfFileExists "$INSTDIR\$coaRelative" 0 coaPreserveNext
    ${StdUtils.HashFile} $coaActual "SHA2-256" "$INSTDIR\$coaRelative"
    StrCpy $coaFailure "Could not hash an existing launcher file: $INSTDIR\$coaRelative. Check that the selected partition is mounted and readable in Wine."
    StrLen $coaAttributes $coaActual
    IntCmp $coaAttributes 64 0 coaPreserveFailed coaPreserveFailed
    StrCmp $coaActual $coaExpected coaPreserveNext
    ; Back up any conflicting bytes, including modified bundled addons. Unknown
    ; files outside the new payload are left exactly where they already are.
    StrCmp $coaBackup "" 0 coaBackupReady
    Push $coaRelative
    StrCpy $coaRelative ".coa-preserved"
    Call coaCheckPath
    Pop $coaRelative
    StrCpy $coaFailure "The launcher backup directory passes through a linked/reparse path: $coaCheck"
    StrCmp $coaSafe "1" 0 coaPreserveFailed
    StrCpy $coaFailure "Could not create the launcher backup directory."
    ClearErrors
    CreateDirectory "$INSTDIR\.coa-preserved"
    IfErrors coaPreserveFailed
    ClearErrors
    GetTempFileName $coaBackup "$INSTDIR\.coa-preserved"
    IfErrors coaPreserveFailed
    ClearErrors
    Delete "$coaBackup"
    IfErrors coaPreserveFailed
    ClearErrors
    CreateDirectory "$coaBackup"
    IfErrors coaPreserveFailed
  coaBackupReady:
    StrCpy $coaDestination "$coaBackup\$coaRelative"
    ${StdUtils.GetParentPath} $coaParent "$coaDestination"
    ClearErrors
    CreateDirectory "$coaParent"
    IfErrors coaPreserveFailed
    ClearErrors
    StrCpy $coaFailure "Could not copy launcher backup: $coaRelative"
    CopyFiles /SILENT "$INSTDIR\$coaRelative" "$coaDestination"
    IfErrors coaPreserveFailed
    ${StdUtils.HashFile} $coaHash "SHA2-256" "$coaDestination"
    StrCpy $coaFailure "Could not verify launcher backup: $coaRelative"
    StrCmp $coaHash $coaActual 0 coaPreserveFailed
    Goto coaPreserveNext
  coaPreserveDone:
    FileClose $coaHandle
    Goto coaPreserveFinished
  coaPreserveFailed:
    StrCmp $coaHandle "" +2
      FileClose $coaHandle
!ifdef COA_SMOKE_FAILURE_FILE
    FileOpen $R9 "${COA_SMOKE_FAILURE_FILE}" w
    FileWrite $R9 "$coaFailure"
    FileClose $R9
!endif
    MessageBox MB_OK|MB_ICONSTOP "The launcher could not safely preserve existing files: $coaFailure. Installation has stopped. Your existing files have not been removed." /SD IDOK
    SetErrorLevel 2
    Quit
  coaPreserveFinished:
    SetOutPath "$coaPreviousOutDir"
!macroend

!macro customRemoveFiles
  InitPluginsDir
  StrCpy $coaRemoved "0"
  StrCpy $coaFailure "Unknown uninstall safety failure."

  ; Work from TEMP so the install directory itself is not the process CWD while
  ; files/directories are being removed.
  SetOutPath $TEMP

  ; NSIS preserves the original uninstaller directory across its TEMP copy.
  ; Do not require the EXE/ASAR: a retry may follow a partial uninstall.
  StrCpy $coaFailure "The selected folder does not contain this launcher's uninstaller."
  IfFileExists "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe" 0 coaRemoveAbort
  StrCpy $coaRelative "Uninstall ${PRODUCT_FILENAME}.exe"
  Call un.coaCheckPath
  Call un.coaCheckDeleteAccess
  StrCmp $coaSafe "1" +3
    StrCpy $coaFailure "The uninstaller path is linked or locked. Close the launcher and retry."
    Goto coaRemoveAbort

  ClearErrors
  File /oname=$PLUGINSDIR\coa-owned.txt "${BUILD_RESOURCES_DIR}\coa-owned.txt"
  StrCpy $coaFailure "The embedded launcher ownership manifest could not be extracted."
  IfErrors coaRemoveAbort
  ClearErrors
  File /oname=$PLUGINSDIR\coa-dirs.txt "${BUILD_RESOURCES_DIR}\coa-dirs.txt"
  StrCpy $coaFailure "The embedded launcher directory manifest could not be extracted."
  IfErrors coaRemoveAbort

  ; First pass: validate every compiled owned-file path before deleting anything.
  ; This keeps junction/symlink/reparse protections fail-closed.
  ClearErrors
  FileOpen $coaHandle "$PLUGINSDIR\coa-owned.txt" r
  StrCpy $coaFailure "The embedded launcher ownership manifest could not be opened."
  IfErrors coaRemoveAbort
  FileSeek $coaHandle 2 SET

  coaRemovePreflightNext:
    ClearErrors
    FileReadUTF16LE $coaHandle $coaLine
    IfErrors coaRemovePreflightDone

    Call un.coaTrimLine
    StrCpy $coaRelative $coaLine "" 65
    StrCmp $coaRelative "" coaRemovePreflightNext

    Call un.coaCheckPath
    Call un.coaCheckDeleteAccess
    StrCmp $coaSafe "1" coaRemovePreflightNext

    StrCpy $coaFailure "A launcher-owned path is linked, locked or not deletable: $coaRelative"
    Goto coaRemoveAbortOpenHandle

  coaRemovePreflightDone:
    FileClose $coaHandle

  ; Validate the compiled directory allowlist too before deleting files.
  ; End-of-file sets the shared error flag; each open needs a fresh check.
  ClearErrors
  FileOpen $coaHandle "$PLUGINSDIR\coa-dirs.txt" r
  StrCpy $coaFailure "The embedded launcher directory manifest could not be opened."
  IfErrors coaRemoveAbort
  FileSeek $coaHandle 2 SET

  coaDirectoryPreflightNext:
    ClearErrors
    FileReadUTF16LE $coaHandle $coaLine
    IfErrors coaDirectoryPreflightDone

    Call un.coaTrimLine
    StrCpy $coaRelative $coaLine
    StrCmp $coaRelative "" coaDirectoryPreflightNext

    Call un.coaCheckPath
    StrCmp $coaSafe "1" coaDirectoryPreflightNext

    StrCpy $coaFailure "Unsafe linked/reparse directory detected: $coaRelative"
    Goto coaRemoveAbortOpenHandle

  coaDirectoryPreflightDone:
    FileClose $coaHandle

  ; Second pass: remove only exact paths compiled from the packaged launcher.
  ; We intentionally do NOT hash-gate uninstall. A launcher-owned file remains
  ; launcher-owned even if it was modified, and uninstall should remove it.
  ClearErrors
  FileOpen $coaHandle "$PLUGINSDIR\coa-owned.txt" r
  StrCpy $coaFailure "The embedded launcher ownership manifest could not be reopened."
  IfErrors coaRemoveAbort
  FileSeek $coaHandle 2 SET

  coaRemoveNext:
    ClearErrors
    FileReadUTF16LE $coaHandle $coaLine
    IfErrors coaRemoveDone

    Call un.coaTrimLine
    StrCpy $coaRelative $coaLine "" 65
    StrCmp $coaRelative "" coaRemoveNext

    IfFileExists "$INSTDIR\$coaRelative" 0 coaRemoveNext

    ; Launcher-owned payloads may occasionally inherit read-only attributes.
    ; Normalizing the exact owned file avoids a false uninstall failure.
    SetFileAttributes "$INSTDIR\$coaRelative" NORMAL

    ClearErrors
    Delete "$INSTDIR\$coaRelative"
    IfErrors 0 coaRemoveDeleted

    StrCpy $coaFailure "Windows could not remove launcher-owned file: $coaRelative"
    Goto coaRemoveAbortOpenHandle

  coaRemoveDeleted:
    IfFileExists "$INSTDIR\$coaRelative" 0 +3
      StrCpy $coaFailure "A launcher-owned file remains: $coaRelative"
      Goto coaRemoveAbortOpenHandle
    IntOp $coaRemoved $coaRemoved + 1
    Goto coaRemoveNext

  coaRemoveDone:
    FileClose $coaHandle

    ; The installed uninstaller itself is launcher-owned but is not part of the
    ; appOutDir ownership manifest. Remove only this exact filename.
    StrCpy $coaRelative "Uninstall ${PRODUCT_FILENAME}.exe"
    Call un.coaCheckPath
    StrCpy $coaFailure "The installed uninstaller could not be removed."
    StrCmp $coaSafe "1" 0 coaRemoveAbort
    ClearErrors
    Delete "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe"
    IfErrors coaRemoveAbort
    IfFileExists "$INSTDIR\Uninstall ${PRODUCT_FILENAME}.exe" coaRemoveAbort

    ; Remove only known directories, deepest first. RMDir is deliberately
    ; non-recursive: any unknown/player file keeps its directory intact.
    ClearErrors
    FileOpen $coaHandle "$PLUGINSDIR\coa-dirs.txt" r
    IfErrors coaRemoveFinished
    FileSeek $coaHandle 2 SET

  coaDirectoryNext:
    ClearErrors
    FileReadUTF16LE $coaHandle $coaLine
    IfErrors coaDirectoryDone

    Call un.coaTrimLine
    StrCpy $coaRelative $coaLine
    StrCmp $coaRelative "" coaDirectoryNext

    Call un.coaCheckPath
    StrCmp $coaSafe "1" 0 coaDirectoryNext

    RMDir "$INSTDIR\$coaRelative"
    Goto coaDirectoryNext

  coaDirectoryDone:
    FileClose $coaHandle
    RMDir "$INSTDIR"
    Goto coaRemoveFinished

  coaRemoveAbortOpenHandle:
    FileClose $coaHandle

  coaRemoveAbort:
!ifdef COA_SMOKE_FAILURE_FILE
    FileOpen $R9 "${COA_SMOKE_FAILURE_FILE}" w
    FileWrite $R9 "$coaFailure"
    FileClose $R9
!endif
    MessageBox MB_OK|MB_ICONSTOP \
      "The launcher could not safely uninstall.$\r$\n$\r$\n$coaFailure$\r$\n$\r$\nWindows uninstall registration was kept. Unknown files and player data were not deleted." \
      /SD IDOK
    SetErrorLevel 2
    Quit

  coaRemoveFinished:
!macroend
