@echo off
rem ============================================================
rem  NIHILPOINTZERO STUDIO - one-click backup of ALL your work
rem  Copies nihilpointzero-data (videos, scripts, settings) to
rem  Documents\NihilPointZero-Backups. It only ADDS/UPDATES -
rem  it never deletes anything, in either folder.
rem  TIP: for real safety, also copy that backup folder to a
rem  USB stick or cloud drive now and then - a backup on the
rem  same disk cannot survive a disk failure.
rem  (Run this from the studio folder, next to nihilpointzero-data.)
rem ============================================================
set SRC=%~dp0nihilpointzero-data
set DST=%USERPROFILE%\Documents\NihilPointZero-Backups\nihilpointzero-data
if not exist "%SRC%" (
  echo Could not find "%SRC%".
  echo Put this file in your NihilPointZeroStudio folder, next to nihilpointzero-data.
  echo.
  pause
  exit /b 1
)
echo Backing up your studio work...
echo   from: %SRC%
echo   to:   %DST%
robocopy "%SRC%" "%DST%" /E /R:2 /W:5 /NP
if %ERRORLEVEL% LEQ 7 (
  echo.
  echo  BACKUP OK - your work is copied to %DST%
) else (
  echo.
  echo  BACKUP HAD ERRORS - scroll up for details.
)
echo.
pause
