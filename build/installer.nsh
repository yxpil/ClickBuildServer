; 可选组件页：使用文档与示例工程默认勾选，生产部署可取消，避免安装无关内容。
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!addincludedir "${PROJECT_DIR}\build"
!include "installer-i18n.nsh"

!ifndef BUILD_UNINSTALLER

Var OptDocsCheckbox
Var OptSamplesCheckbox
Var OptDocsState
Var OptSamplesState
Var OptTitle
Var OptSubtitle
Var OptDocsLabel
Var OptSamplesLabel
Var OptNote
Var AppLocale

!macro customPageAfterChangeDir
  Page custom OptionalComponentsPage OptionalComponentsPageLeave
!macroend

Function OptionalComponentsPage
  !insertmacro SetOptionalPageStrings

  ; 页头只显示标题，说明文字由下面的正文标签显示一次，避免同一句话重复两遍。
  !insertmacro MUI_HEADER_TEXT "$OptTitle" ""

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "$OptSubtitle"
  Pop $1

  ${NSD_CreateCheckbox} 0 34u 100% 18u "$OptDocsLabel"
  Pop $OptDocsCheckbox
  ${NSD_Check} $OptDocsCheckbox

  ${NSD_CreateCheckbox} 0 54u 100% 18u "$OptSamplesLabel"
  Pop $OptSamplesCheckbox
  ${NSD_Check} $OptSamplesCheckbox

  ${NSD_CreateLabel} 0 78u 100% 24u "$OptNote"
  Pop $2

  nsDialogs::Show
FunctionEnd

Function OptionalComponentsPageLeave
  ${NSD_GetState} $OptDocsCheckbox $OptDocsState
  ${NSD_GetState} $OptSamplesCheckbox $OptSamplesState
FunctionEnd

!macro customInstall
  ; 安装器选择的语言就是应用的首次语言；未知语言不写文件，交给应用按系统语言判断。
  !insertmacro SetInstallerLocale
  ${If} $AppLocale != ""
    CreateDirectory "$APPDATA\click-build-server\clickbuild"
    FileOpen $0 "$APPDATA\click-build-server\clickbuild\install-language.txt" w
    FileWrite $0 $AppLocale
    FileClose $0
  ${EndIf}

  ${If} $OptDocsState == 1
    CreateDirectory "$INSTDIR\docs"
    SetOutPath "$INSTDIR\docs"
    File /nonfatal /oname=README.md "${PROJECT_DIR}\README.md"
    File /nonfatal /oname=execution.md "${PROJECT_DIR}\docs\执行文档.md"
  ${EndIf}

  ${If} $OptSamplesState == 1
    CreateDirectory "$INSTDIR\samples"
    SetOutPath "$INSTDIR\samples"
    File /nonfatal /oname=commerce-project.json "${PROJECT_DIR}\samples\commerce-project.json"
  ${EndIf}

  SetOutPath "$INSTDIR"
!macroend

!endif
