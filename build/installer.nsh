; 可选组件页：使用文档与示例工程默认勾选，生产部署可取消，避免安装无关内容。
!include "MUI2.nsh"
!include "nsDialogs.nsh"

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

!macro customPageAfterChangeDir
  Page custom OptionalComponentsPage OptionalComponentsPageLeave
!macroend

Function OptionalComponentsPage
  ${If} $LANGUAGE == 2052
    StrCpy $OptTitle "可选组件"
    StrCpy $OptSubtitle "选择需要安装的附加内容；生产环境可以全部取消。"
    StrCpy $OptDocsLabel "安装使用文档（README 与执行文档）"
    StrCpy $OptSamplesLabel "安装示例工程（商城工程）"
    StrCpy $OptNote "程序本体、便携运行时和内置服务始终安装。"
  ${Else}
    StrCpy $OptTitle "Optional Components"
    StrCpy $OptSubtitle "Choose optional content to install. Production installs can clear all."
    StrCpy $OptDocsLabel "Install usage documentation (README and execution guide)"
    StrCpy $OptSamplesLabel "Install sample project (commerce project)"
    StrCpy $OptNote "The app, portable runtime and bundled services are always installed."
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "$OptTitle" "$OptSubtitle"

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
