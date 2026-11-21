; 由 tools/build-installer-i18n.js 自动生成，请勿手改。
; 语言包与语言清单来自 app/i18n/catalog.js + app/i18n/locales/*.json。

!macro SetOptionalPageStrings
  ${If} $LANGUAGE == 2052
    StrCpy $OptTitle "可选组件"
    StrCpy $OptSubtitle "选择需要安装的附加内容；生产环境可以全部取消。"
    StrCpy $OptDocsLabel "安装使用文档（README 与执行文档）"
    StrCpy $OptSamplesLabel "安装示例工程（商城工程）"
    StrCpy $OptNote "程序本体、便携运行时和内置服务始终安装。"
  ${ElseIf} $LANGUAGE == 1028
    StrCpy $OptTitle "選取元件"
    StrCpy $OptSubtitle "選取需要安裝的附加內容；生產環境可全部取消選取。"
    StrCpy $OptDocsLabel "安裝使用文件（README 與執行文件）"
    StrCpy $OptSamplesLabel "安裝範例專案（商城專案）"
    StrCpy $OptNote "程式主體、可攜式執行環境與內建服務將一律安裝。"
  ${ElseIf} $LANGUAGE == 1033
    StrCpy $OptTitle "Optional Components"
    StrCpy $OptSubtitle "Select the additional components to install; you can deselect all in a production environment."
    StrCpy $OptDocsLabel "Installation Documentation (README and Execution Guide)"
    StrCpy $OptSamplesLabel "Install Sample Project (E-commerce Project)"
    StrCpy $OptNote "The application core, portable runtime, and built-in services are always installed."
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $OptTitle "オプションコンポーネント"
    StrCpy $OptSubtitle "インストールする追加内容を選択してください。本番環境ではすべて選択解除しても構いません。"
    StrCpy $OptDocsLabel "インストール使用ドキュメント（READMEと実行ドキュメント）"
    StrCpy $OptSamplesLabel "サンプルプロジェクト（ECサイトプロジェクト）をインストール"
    StrCpy $OptNote "プログラム本体、ポータブルランタイム、および内蔵サービスは常時インストールされます。"
  ${ElseIf} $LANGUAGE == 1042
    StrCpy $OptTitle "선택적 구성 요소"
    StrCpy $OptSubtitle "설치할 추가 구성 요소를 선택하세요. 운영 환경에서는 모두 선택 해제할 수 있습니다."
    StrCpy $OptDocsLabel "설치 사용 설명서(README 및 실행 설명서)"
    StrCpy $OptSamplesLabel "샘플 프로젝트(쇼핑몰 프로젝트) 설치"
    StrCpy $OptNote "프로그램 본체, 휴대용 런타임 및 내장 서비스는 항상 설치됩니다."
  ${ElseIf} $LANGUAGE == 1036
    StrCpy $OptTitle "Composants optionnels"
    StrCpy $OptSubtitle "Sélectionnez les éléments supplémentaires à installer ; en environnement de production, vous pouvez tout désélectionner."
    StrCpy $OptDocsLabel "Documentation d’installation et d’utilisation (README et guide d’exécution)"
    StrCpy $OptSamplesLabel "Installer le projet exemple (projet de boutique)"
    StrCpy $OptNote "Le programme lui-même, le temps d’exécution portable et les services intégrés sont toujours installés."
  ${ElseIf} $LANGUAGE == 1031
    StrCpy $OptTitle "Optionale Komponenten"
    StrCpy $OptSubtitle "Wählen Sie die zu installierenden Zusatzinhalte aus; in Produktionsumgebungen können alle deaktiviert werden."
    StrCpy $OptDocsLabel "Installations- und Benutzerdokumentation (README und Ausführungsanleitung)"
    StrCpy $OptSamplesLabel "Beispielprojekt installieren (E-Commerce-Projekt)"
    StrCpy $OptNote "Das Programm selbst, der portable Laufzeitumgebung und die integrierten Dienste werden stets installiert."
  ${ElseIf} $LANGUAGE == 3082
    StrCpy $OptTitle "Componentes opcionales"
    StrCpy $OptSubtitle "Seleccione los complementos que desea instalar; en entornos de producción, puede desmarcarlos todos."
    StrCpy $OptDocsLabel "Documentación de instalación y uso (README y guía de ejecución)"
    StrCpy $OptSamplesLabel "Instalar proyecto de ejemplo (proyecto de tienda)"
    StrCpy $OptNote "El programa principal, el entorno de ejecución portátil y los servicios integrados se instalan siempre."
  ${ElseIf} $LANGUAGE == 1046
    StrCpy $OptTitle "Componentes opcionais"
    StrCpy $OptSubtitle "Selecione os conteúdos adicionais a serem instalados; em ambiente de produção, todos podem ser desmarcados."
    StrCpy $OptDocsLabel "Documentação de instalação e uso (README e documentação de execução)"
    StrCpy $OptSamplesLabel "Instalar projeto de exemplo (projeto de loja virtual)"
    StrCpy $OptNote "O programa principal, o tempo de execução portátil e os serviços integrados são sempre instalados."
  ${ElseIf} $LANGUAGE == 1040
    StrCpy $OptTitle "Componenti opzionali"
    StrCpy $OptSubtitle "Seleziona i contenuti aggiuntivi da installare; in ambiente di produzione è possibile deselezionarli tutti."
    StrCpy $OptDocsLabel "Documentazione di installazione e utilizzo (README e documentazione operativa)"
    StrCpy $OptSamplesLabel "Installa il progetto di esempio (progetto di e-commerce)"
    StrCpy $OptNote "Il programma principale, il runtime portatile e i servizi integrati vengono sempre installati."
  ${ElseIf} $LANGUAGE == 1049
    StrCpy $OptTitle "Дополнительные компоненты"
    StrCpy $OptSubtitle "Выберите дополнительные компоненты для установки; в производной среде можно отменить выбор всех компонентов."
    StrCpy $OptDocsLabel "Документация по установке и использованию (README и руководство по запуску)"
    StrCpy $OptSamplesLabel "Пример проекта для установки (проект интернет-магазина)"
    StrCpy $OptNote "Основная программа, портативная среда выполнения и встроенные службы устанавливаются всегда."
  ${ElseIf} $LANGUAGE == 1025
    StrCpy $OptTitle "المكونات الاختيارية"
    StrCpy $OptSubtitle "حدّد الإضافات المراد تثبيتها؛ يمكن إلغاء تحديد الكل في بيئة الإنتاج."
    StrCpy $OptDocsLabel "وثائق التثبيت والاستخدام (README ووثائق التشغيل)"
    StrCpy $OptSamplesLabel "تثبيت مشروع تجريبي (مشروع متجر)"
    StrCpy $OptNote "يُثبَّت دائمًا البرنامج نفسه وبيئة التشغيل المحمولة والخدمات المدمجة."
  ${ElseIf} $LANGUAGE == 1043
    StrCpy $OptTitle "Optionele componenten"
    StrCpy $OptSubtitle "Selecteer de extra onderdelen die u wilt installeren; in een productieomgeving kunt u ze allemaal deselecteren."
    StrCpy $OptDocsLabel "Installatie- en gebruiksdocumentatie (README en uitvoeringsdocumentatie)"
    StrCpy $OptSamplesLabel "Voorbeeldproject installeren (winkelproject)"
    StrCpy $OptNote "Het programma zelf, de draagbare runtime en de ingebouwde services worden altijd geïnstalleerd."
  ${ElseIf} $LANGUAGE == 1045
    StrCpy $OptTitle "Komponenty opcjonalne"
    StrCpy $OptSubtitle "Wybierz dodatkowe elementy do zainstalowania; w środowisku produkcyjnym można odznaczyć wszystkie."
    StrCpy $OptDocsLabel "Dokumentacja instalacji i użytkowania (README oraz dokumentacja wykonawcza)"
    StrCpy $OptSamplesLabel "Przykładowy projekt do instalacji (projekt sklepu)"
    StrCpy $OptNote "Główny program, przenośne środowisko uruchomieniowe i wbudowane usługi są zawsze instalowane."
  ${ElseIf} $LANGUAGE == 1055
    StrCpy $OptTitle "İsteğe bağlı bileşenler"
    StrCpy $OptSubtitle "Yüklemek istediğiniz ek içerikleri seçin; üretim ortamında hepsinin seçimi kaldırılabilir."
    StrCpy $OptDocsLabel "Kurulum ve kullanım belgeleri (README ve çalışma belgeleri)"
    StrCpy $OptSamplesLabel "Örnek proje kurulumu (e-ticaret projesi)"
    StrCpy $OptNote "Uygulama ana dosyaları, taşınabilir çalışma zamanı ve yerleşik hizmetler her zaman yüklenir."
  ${ElseIf} $LANGUAGE == 1054
    StrCpy $OptTitle "ส่วนประกอบที่เลือกได้"
    StrCpy $OptSubtitle "เลือกส่วนเสริมที่ต้องการติดตั้ง สำหรับสภาพแวดล้อมการผลิตสามารถยกเลิกการเลือกทั้งหมดได้"
    StrCpy $OptDocsLabel "เอกสารการติดตั้งและใช้งาน (README และเอกสารการดำเนินการ)"
    StrCpy $OptSamplesLabel "ติดตั้งโปรเจกต์ตัวอย่าง (โปรเจกต์ร้านค้า)"
    StrCpy $OptNote "ตัวโปรแกรม, รันไทม์แบบพกพา และบริการในตัวจะถูกติดตั้งเสมอ"
  ${ElseIf} $LANGUAGE == 1066
    StrCpy $OptTitle "Các thành phần tùy chọn"
    StrCpy $OptSubtitle "Chọn nội dung bổ sung cần cài đặt; môi trường sản xuất có thể bỏ chọn tất cả."
    StrCpy $OptDocsLabel "Tài liệu hướng dẫn cài đặt và sử dụng (README và tài liệu thực thi)"
    StrCpy $OptSamplesLabel "Cài đặt dự án mẫu (dự án cửa hàng)"
    StrCpy $OptNote "Chương trình chính, môi trường chạy di động và các dịch vụ tích hợp luôn được cài đặt."
  ${ElseIf} $LANGUAGE == 1029
    StrCpy $OptTitle "Volitelné komponenty"
    StrCpy $OptSubtitle "Vyberte doplňkový obsah, který chcete nainstalovat; v produkčním prostředí můžete odškrtnout všechny položky."
    StrCpy $OptDocsLabel "Dokumentace k instalaci a používání (README a provozní dokumentace)"
    StrCpy $OptSamplesLabel "Instalace ukázkového projektu (projekt internetového obchodu)"
    StrCpy $OptNote "Hlavní program, přenosný runtime a vestavěné služby se instalují vždy."
  ${ElseIf} $LANGUAGE == 1053
    StrCpy $OptTitle "Valfria komponenter"
    StrCpy $OptSubtitle "Välj tillägg som ska installeras; i produktionsmiljö kan alla avmarkeras."
    StrCpy $OptDocsLabel "Installations- och användardokumentation (README och körningsdokumentation)"
    StrCpy $OptSamplesLabel "Installera exempelprojekt (butikprojekt)"
    StrCpy $OptNote "Programkärnan, den bärbara körningen och de inbyggda tjänsterna installeras alltid."
  ${Else}
    StrCpy $OptTitle "Optional Components"
    StrCpy $OptSubtitle "Select the additional components to install; you can deselect all in a production environment."
    StrCpy $OptDocsLabel "Installation Documentation (README and Execution Guide)"
    StrCpy $OptSamplesLabel "Install Sample Project (E-commerce Project)"
    StrCpy $OptNote "The application core, portable runtime, and built-in services are always installed."
  ${EndIf}
!macroend

!macro SetInstallerLocale
  ${If} $LANGUAGE == 2052
    StrCpy $AppLocale "zh-CN"
  ${ElseIf} $LANGUAGE == 1028
    StrCpy $AppLocale "zh-TW"
  ${ElseIf} $LANGUAGE == 1033
    StrCpy $AppLocale "en-US"
  ${ElseIf} $LANGUAGE == 1041
    StrCpy $AppLocale "ja-JP"
  ${ElseIf} $LANGUAGE == 1042
    StrCpy $AppLocale "ko-KR"
  ${ElseIf} $LANGUAGE == 1036
    StrCpy $AppLocale "fr-FR"
  ${ElseIf} $LANGUAGE == 1031
    StrCpy $AppLocale "de-DE"
  ${ElseIf} $LANGUAGE == 3082
    StrCpy $AppLocale "es-ES"
  ${ElseIf} $LANGUAGE == 1046
    StrCpy $AppLocale "pt-BR"
  ${ElseIf} $LANGUAGE == 1040
    StrCpy $AppLocale "it-IT"
  ${ElseIf} $LANGUAGE == 1049
    StrCpy $AppLocale "ru-RU"
  ${ElseIf} $LANGUAGE == 1025
    StrCpy $AppLocale "ar-SA"
  ${ElseIf} $LANGUAGE == 1043
    StrCpy $AppLocale "nl-NL"
  ${ElseIf} $LANGUAGE == 1045
    StrCpy $AppLocale "pl-PL"
  ${ElseIf} $LANGUAGE == 1055
    StrCpy $AppLocale "tr-TR"
  ${ElseIf} $LANGUAGE == 1054
    StrCpy $AppLocale "th-TH"
  ${ElseIf} $LANGUAGE == 1066
    StrCpy $AppLocale "vi-VN"
  ${ElseIf} $LANGUAGE == 1029
    StrCpy $AppLocale "cs-CZ"
  ${ElseIf} $LANGUAGE == 1053
    StrCpy $AppLocale "sv-SE"
  ${Else}
    StrCpy $AppLocale ""
  ${EndIf}
!macroend
