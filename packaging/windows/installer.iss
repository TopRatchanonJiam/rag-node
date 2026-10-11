; installer.iss — ตัวติดตั้ง 1n9 AI (Inno Setup 6)
; สร้างด้วย: ISCC.exe installer.iss /DAppVersion=1.0.0 /DSourceDir=<โฟลเดอร์ dist\1n9>
; ติดตั้งแบบรายผู้ใช้ (ไม่ต้องสิทธิ์ผู้ดูแล / ไม่มีหน้าต่าง UAC) ลงใน %LOCALAPPDATA%\Programs\1n9
; ข้อมูลของลูกค้าอยู่ที่ %LOCALAPPDATA%\1n9 แยกจากตัวโปรแกรม — ถอนการติดตั้ง/อัปเดตแล้วข้อมูลไม่หาย

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "dist\1n9"
#endif

[Setup]
AppId={{BF22B8F8-3C9A-438F-94FB-AFCB1D208AE4}
AppName=1n9 AI
AppVersion={#AppVersion}
AppPublisher=1n9 AI
DefaultDirName={localappdata}\Programs\1n9
DefaultGroupName=1n9 AI
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputBaseFilename=1n9-Setup
OutputDir=.
SetupIconFile=1n9.ico
UninstallDisplayIcon={app}\1n9.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no
RestartApplications=no

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"
Name: "autostart"; Description: "Start 1n9 automatically when I sign in to Windows (needed so LINE and live data keep working)"; GroupDescription: "Startup:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\1n9 AI"; Filename: "{app}\1n9.exe"
Name: "{autodesktop}\1n9 AI"; Filename: "{app}\1n9.exe"; Tasks: desktopicon

[Registry]
; เปิดเองตอนเข้า Windows แบบเงียบ ไม่เด้งเบราว์เซอร์ (ไอคอนที่มุมจอมีเมนูเปิดหน้าเว็บ)
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "1n9 AI"; \
    ValueData: """{app}\1n9.exe"" --no-browser"; Tasks: autostart; Flags: uninsdeletevalue

[Run]
Filename: "{app}\1n9.exe"; Description: "Open 1n9 AI now"; Flags: nowait postinstall skipifsilent

[Code]
{ ปิดโปรแกรมที่รันอยู่ก่อนเขียนทับ/ลบไฟล์ — Restart Manager ปิดแอปที่อยู่ที่มุมจอ (ไม่มีหน้าต่าง) ไม่ได้
  ปิดเฉพาะ 1n9.exe กับ qdrant.exe ที่อยู่ในโฟลเดอร์โปรแกรมนี้ ไม่แตะ Qdrant ตัวอื่นของผู้ใช้ }
procedure StopRunningApp();
var
  ResultCode: Integer;
  Ps: String;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM 1n9.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Ps := '-NoProfile -Command "Get-Process qdrant -ErrorAction SilentlyContinue | Where-Object { $_.Path -like ''' +
        ExpandConstant('{app}') + '\*'' } | Stop-Process -Force"';
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Ps, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Sleep(800);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningApp();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  StopRunningApp();
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    SuppressibleMsgBox('1n9 AI has been removed.' + #13#10 + #13#10 +
           'Your data (knowledge bases, settings) was kept in:' + #13#10 +
           ExpandConstant('{localappdata}\1n9') + #13#10 +
           'Delete that folder if you also want to remove your data.', mbInformation, MB_OK, IDOK);
end;
